import re
from datetime import datetime, timedelta
from typing import Any
from uuid import UUID

from fastapi import HTTPException
from psycopg import Connection
from psycopg.rows import DictRow

from healthathon import clinic_time, storage
from healthathon.audit import record_event
from healthathon.entries import repository as entries_repo
from healthathon.entries.models import READING
from healthathon.patient_app import repository as repo
from healthathon.patient_app.models import (
    AnswerRequest,
    AppMeal,
    AppReading,
    ReadingRequest,
    SurveyRequest,
    TickRequest,
)
from healthathon.patient_app.service import require_patient

# Every write here is the patient's own, through the app. Each one carries a
# capture id made on the device, and sending it again changes nothing.
# Audit events have no clinic user as their actor (see audit.record_event).

MAX_PHOTO_BYTES = 8 * 1024 * 1024
_IMAGE_TYPES = {b"\xff\xd8\xff": "jpg", b"\x89PNG\r\n\x1a\n": "png"}


def set_tick(conn: Connection[DictRow], patient_id: UUID, item_id: UUID, req: TickRequest) -> None:
    """
    Record today's tick for one checklist item, change it, or clear it.
    A tick recorded through another route (a paper form) is not the app's
    to change.
    """
    require_patient(conn, patient_id)
    if not any(i["id"] == item_id for i in repo.active_items(conn, patient_id)):
        raise HTTPException(404, "That medicine is not on the current checklist")
    day = clinic_time.today()
    existing = entries_repo.tick_for(conn, patient_id, item_id, day)
    if existing and existing["channel"] != "patient_app":
        raise HTTPException(409, "Today's tick for that medicine was recorded by the clinic")

    old = {"ticked": existing["ticked"]} if existing else None
    if req.ticked is None:
        if existing:
            repo.delete_entry(conn, existing["id"])
            record_event(conn, None, "tick.clear", "pat.entry", existing["id"], old_value=old)
        return
    if existing:
        if existing["ticked"] != req.ticked:
            repo.set_tick(conn, existing["id"], req.ticked)
            record_event(conn, None, "tick.change", "pat.entry", existing["id"], old_value=old,
                         new_value={"ticked": req.ticked})  # fmt: skip
        return
    lang = _language(conn, patient_id, None)
    eid = _entry(conn, patient_id, "medication_tick", lang, req.capture_id)
    if eid is None:
        return  # this exact write was already made
    entries_repo.insert_tick(conn, eid, item_id, day, req.ticked)
    record_event(conn, None, "tick.record", "pat.entry", eid, new_value={"ticked": req.ticked})


def add_reading(conn: Connection[DictRow], patient_id: UUID, req: ReadingRequest) -> AppReading:
    """A glucose reading with its context, stored exactly as typed. No range is applied."""
    require_patient(conn, patient_id)
    value = req.value_text.strip()
    if not re.fullmatch(READING, value):
        raise HTTPException(422, "A reading must be a number")
    eid = _entry(conn, patient_id, "glucose_reading", _language(conn, patient_id, req.language),
                 req.capture_id)  # fmt: skip
    if eid is None:
        eid = _retried(conn, patient_id, "glucose_reading", req.capture_id)
    else:
        entries_repo.insert_glucose(conn, eid, value, req.context, None)
        record_event(conn, None, "reading.record", "pat.entry", eid,
                     new_value={"value_text": value, "context": req.context})  # fmt: skip
    row = repo.reading(conn, eid)
    assert row is not None
    return AppReading(
        id=row["id"],
        value_text=row["value_text"],
        context=row["context"],
        occurred_at=clinic_time.local(row["occurred_at"]),
    )


def answer(conn: Connection[DictRow], patient_id: UUID, req: AnswerRequest) -> None:
    """The day's question. The answer is the patient's own words, kept as given."""
    require_patient(conn, patient_id)
    text = req.answer_text.strip()
    if not text:
        raise HTTPException(422, "An answer cannot be empty")
    if req.question_key not in entries_repo.DAILY_QUESTION_KEYS:
        raise HTTPException(422, "Unknown question")
    q = entries_repo.questions(conn, (req.question_key,))
    if not q:
        raise HTTPException(422, "Unknown question")
    lang = _language(conn, patient_id, req.language)
    eid = _entry(conn, patient_id, "survey_answer", lang, req.capture_id)
    if eid is None:
        _retried(conn, patient_id, "survey_answer", req.capture_id)
        return
    entries_repo.insert_answer(conn, eid, q[0]["id"], text, None)
    record_event(conn, None, "answer.record", "pat.entry", eid)


def submit_survey(conn: Connection[DictRow], patient_id: UUID, req: SurveyRequest) -> None:
    """
    The weekly survey, all or nothing. Every question in the patient's set
    needs an answer. The answers are stored one per question and never added up.
    """
    require_patient(conn, patient_id)
    qs = repo.question_set(conn, patient_id)
    questions = repo.set_questions(conn, qs["id"]) if qs else []
    if not qs or not questions:
        raise HTTPException(409, "There is no survey for this patient")
    if set(req.answers) != {q["question_key"] for q in questions}:
        raise HTTPException(422, "Answer exactly the questions in the survey")
    if any(not v.strip() for v in req.answers.values()):
        raise HTTPException(422, "Every question needs an answer")
    entries_repo.lock_capture_id(conn, req.capture_id)
    if entries_repo.count_with_capture_prefix(conn, req.capture_id):
        return
    lang = _language(conn, patient_id, req.language)
    for q in questions:
        eid = _entry(conn, patient_id, "survey_answer", lang,
                     f"{req.capture_id}:{q['question_key']}")  # fmt: skip
        assert eid is not None
        entries_repo.insert_answer(conn, eid, q["id"], req.answers[q["question_key"]].strip(),
                                   qs["id"])  # fmt: skip
    record_event(conn, None, "survey.submit", "pat.patient_question_set", qs["id"],
                 new_value={"answers": len(questions)})  # fmt: skip


# A photograph sent later than this after it was taken belongs to no day the app shows.
MEAL_PHOTO_AGE = timedelta(days=3)
CLOCK_SKEW = timedelta(minutes=5)


def add_meal(
    conn: Connection[DictRow],
    patient_id: UUID,
    capture_id: str,
    body: bytes,
    meal: str,
    taken_at: datetime | None,
    calories_text: str | None,
) -> AppMeal:
    """
    Store a meal photograph inside the clinic boundary, with the meal the
    patient chose and when the photograph was taken; the entry happened
    then, not when it was sent. Calories are stored only as the patient
    typed them. Nothing is computed from the photograph: no portion,
    calories or macronutrients.
    """
    require_patient(conn, patient_id)
    existing = entries_repo.entry_by_capture_id(conn, capture_id)
    if existing:
        eid = _retried(conn, patient_id, "meal_photo", capture_id)
    else:
        if len(body) > MAX_PHOTO_BYTES:
            raise HTTPException(413, "The photograph is too large")
        ext = next((e for magic, e in _IMAGE_TYPES.items() if body.startswith(magic)), None)
        if ext is None:
            raise HTTPException(415, "Send a JPEG or PNG photograph")
        now = clinic_time.now()
        # A time without an offset is the clinic's wall time, as the phone shows it.
        when = (
            now
            if taken_at is None
            else taken_at.replace(tzinfo=taken_at.tzinfo or clinic_time.zone())
        )
        if when > now + CLOCK_SKEW or when < now - MEAL_PHOTO_AGE:
            raise HTTPException(422, "taken_at must be within the last three days")
        lang = _language(conn, patient_id, None)
        new = _entry(conn, patient_id, "meal_photo", lang, capture_id, when)
        assert new is not None
        eid = new
        key = f"meals/{patient_id}/{eid}.{ext}"
        storage.save(key, body)
        repo.insert_meal(conn, eid, key, when, meal, calories_text)
        record_event(conn, None, "meal.record", "pat.entry", eid)
    row = repo.meal(conn, eid)
    assert row is not None
    return AppMeal(
        id=row["id"],
        uri=storage.url_for(row["storage_key"]),
        occurred_at=clinic_time.local(row["occurred_at"]),
        meal=row["meal"],
        calories_text=row["calories_text"],
    )


def _entry(
    conn: Connection[DictRow],
    patient_id: UUID,
    kind: str,
    language: str,
    capture_id: str,
    occurred_at: datetime | None = None,
) -> UUID | None:
    return entries_repo.insert_entry(
        conn, patient_id, kind, "patient_app", "patient", language, capture_id,
        occurred_at or clinic_time.now(),
    )  # fmt: skip


def _retried(conn: Connection[DictRow], patient_id: UUID, kind: str, capture_id: str) -> UUID:
    """The entry an earlier send of this capture id made. It must be the same kind of write."""
    row: dict[str, Any] | None = entries_repo.entry_by_capture_id(conn, capture_id)
    if row is None or row["patient_id"] != patient_id or row["kind"] != kind:
        raise HTTPException(409, "That capture id was used for something else")
    eid: UUID = row["id"]
    return eid


def _language(conn: Connection[DictRow], patient_id: UUID, lang: str | None) -> str:
    if lang:
        return lang
    patient = repo.patient(conn, patient_id)
    assert patient is not None
    return str(patient["preferred_language"])
