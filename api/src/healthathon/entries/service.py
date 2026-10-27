import re
from datetime import date, time, timedelta
from typing import Any
from uuid import UUID

from fastapi import HTTPException
from psycopg import Connection
from psycopg.rows import DictRow

from healthathon import clinic_time, storage
from healthathon.audit import record_event
from healthathon.auth import CurrentUser
from healthathon.entries import repository as repo
from healthathon.entries.models import (
    READING,
    AnswerEntry,
    EntriesPage,
    GlucoseEntry,
    MealPhotoEntry,
    PaperFormQuestion,
    PaperFormResult,
    PaperFormSubmission,
    PatientEntry,
    RegimenItemRef,
    RegimenItemSpan,
    TickEntry,
)
from healthathon.record import repository as record_repo

DEFAULT_DAYS = 28
MAX_DAYS = 366
# The time a paper form entry is filed under when the form gives none.
TICK_TIME, ANSWER_TIME, READING_TIME = time(21, 0), time(20, 0), time(12, 0)


def require_patient(conn: Connection[DictRow], patient_id: UUID) -> dict[str, Any]:
    patient = record_repo.get_patient(conn, patient_id)
    if patient is None:
        raise HTTPException(404, "No such patient")
    return patient


def entries_page(
    conn: Connection[DictRow],
    user: CurrentUser,
    patient_id: UUID,
    first: date | None,
    last: date | None,
) -> EntriesPage:
    require_patient(conn, patient_id)
    last = last or clinic_time.today()
    first = first or last - timedelta(days=DEFAULT_DAYS - 1)
    if first > last:
        raise HTTPException(422, "from must be on or before to")
    if (last - first).days >= MAX_DAYS:
        raise HTTPException(422, "A range is at most a year")
    start, end = clinic_time.day_bounds(first, last)
    rows = repo.entries_between(conn, patient_id, first, last, start, end)
    items = repo.regimen_items_between(conn, patient_id, start, end)
    record_event(conn, user, "entries.read", "core.patient", patient_id)
    return EntriesPage(
        entries=[to_entry(r) for r in rows],
        regimen_items=[
            RegimenItemSpan(
                id=i["id"],
                drug_text=i["drug_text"],
                dose_text=i["dose_text"],
                schedule_text=i["schedule_text"],
                active_from=clinic_time.local(i["activated_at"]).date(),
                active_until=(
                    clinic_time.local(i["superseded_at"]).date() if i["superseded_at"] else None
                ),
            )
            for i in items
        ],
        from_=first,
        to=last,
    )


def to_entry(r: dict[str, Any]) -> PatientEntry:
    carer = r["caregiver_name"]
    if carer and r["caregiver_relationship"]:
        carer = f"{carer} ({r['caregiver_relationship']})"
    base: dict[str, Any] = {
        "id": r["id"],
        "channel": r["channel"],
        "entered_by": r["entered_by"],
        "caregiver_name": carer,
        "language": r["language"],
        "occurred_at": clinic_time.local(r["occurred_at"]),
        "recorded_at": clinic_time.local(r["recorded_at"]),
    }
    kind = r["kind"]
    if kind == "glucose_reading":
        units = r["insulin_units"]
        return GlucoseEntry(
            **base,
            kind=kind,
            value_text=r["value_text"],
            context=r["context"],
            insulin_units=float(units) if units is not None else None,
        )
    if kind == "medication_tick":
        return TickEntry(
            **base,
            kind=kind,
            regimen_item=RegimenItemRef(
                id=r["item_id"],
                drug_text=r["drug_text"],
                dose_text=r["dose_text"],
                schedule_text=r["schedule_text"],
            ),
            tick_date=r["tick_date"],
            ticked=r["ticked"],
        )
    if kind == "survey_answer":
        return AnswerEntry(
            **base,
            kind=kind,
            set="survey" if r["set_id"] else "daily",
            question_key=r["question_key"],
            question_text=r["question_text"],
            question_text_shown=r["question_text_shown"],
            answer_text=r["answer_text"],
        )
    return MealPhotoEntry(**base, kind="meal_photo", photo_url=storage.url_for(r["storage_key"]))


def paper_form_questions(conn: Connection[DictRow]) -> list[PaperFormQuestion]:
    rows = sorted(repo.questions(conn, repo.DAILY_QUESTION_KEYS), key=lambda q: q["display_order"])
    return [PaperFormQuestion(key=q["question_key"], text=q["texts"]["en"]) for q in rows]


def submit_paper_form(
    conn: Connection[DictRow], user: CurrentUser, patient_id: UUID, form: PaperFormSubmission
) -> PaperFormResult:
    """
    Store one transcribed paper form, all or nothing, marked paper_form and
    clinic_staff. Each entry's capture id is the form's plus its position, so
    a form saved twice is recognised and stored once.
    """
    require_patient(conn, patient_id)
    repo.lock_capture_id(conn, form.client_capture_id)
    already = repo.count_with_capture_prefix(conn, form.client_capture_id)
    if already:
        return PaperFormResult(created=already, duplicate=True)
    _check_form(form)

    questions = {q["question_key"]: q for q in repo.questions(conn, repo.DAILY_QUESTION_KEYS)}
    n = 0

    def entry(kind: str, day: date, wall: time) -> UUID:
        nonlocal n
        n += 1
        eid = repo.insert_entry(
            conn,
            patient_id,
            kind,
            "paper_form",
            "clinic_staff",
            form.language,
            f"{form.client_capture_id}:{n}",
            clinic_time.at(day, wall),
        )
        assert eid is not None  # the capture id lock makes a clash impossible
        return eid

    for t in form.ticks:
        item = repo.regimen_item(conn, patient_id, t.regimen_item_id)
        if item is None:
            raise HTTPException(422, "A tick is for a medicine not on the checklist")
        if not _in_force(item, t.date):
            raise HTTPException(422, "A tick is for a day the medicine was not on the checklist")
        if repo.tick_for(conn, patient_id, t.regimen_item_id, t.date):
            raise HTTPException(409, "A tick for that medicine and day is already recorded")
        repo.insert_tick(conn, entry("medication_tick", t.date, TICK_TIME), item["id"], t.date,
                         t.ticked)  # fmt: skip
    for g in form.glucose:
        wall = time.fromisoformat(g.time) if g.time else READING_TIME
        repo.insert_glucose(
            conn, entry("glucose_reading", g.date, wall), g.value_text.strip(), g.context,
            g.insulin_units,
        )  # fmt: skip
    for a in form.answers:
        q = questions.get(a.question_key)
        if q is None:
            raise HTTPException(422, "Unknown question")
        repo.insert_answer(
            conn, entry("survey_answer", a.date, ANSWER_TIME), q["id"], a.answer_text.strip(), None
        )

    record_event(
        conn,
        user,
        "paper_form.enter",
        "core.patient",
        patient_id,
        new_value={
            "client_capture_id": form.client_capture_id,
            "week_from": form.week_from.isoformat(),
            "week_to": form.week_to.isoformat(),
            "ticks": len(form.ticks),
            "readings": len(form.glucose),
            "answers": len(form.answers),
        },
    )
    return PaperFormResult(created=n, duplicate=False)


def _check_form(form: PaperFormSubmission) -> None:
    if form.week_from > form.week_to or (form.week_to - form.week_from).days > 6:
        raise HTTPException(422, "The form week is not valid")
    today = clinic_time.today()

    def in_week(d: date) -> bool:
        # A form can be copied mid-week, but nothing on it is dated after today.
        return form.week_from <= d <= form.week_to and d <= today

    if not all(in_week(t.date) for t in form.ticks):
        raise HTTPException(422, "A tick is outside the form week")
    if len({(t.regimen_item_id, t.date) for t in form.ticks}) != len(form.ticks):
        raise HTTPException(422, "A medicine has two ticks for one day")
    for g in form.glucose:
        if not in_week(g.date):
            raise HTTPException(422, "A reading is outside the form week")
        if not re.fullmatch(READING, g.value_text.strip()):
            raise HTTPException(422, "A reading must be a number as written")
    for a in form.answers:
        if not in_week(a.date) or not a.answer_text.strip():
            raise HTTPException(422, "An answer is empty or outside the form week")


def _in_force(item: dict[str, Any], day: date) -> bool:
    start = clinic_time.local(item["activated_at"]).date()
    end = clinic_time.local(item["superseded_at"]).date() if item["superseded_at"] else None
    return start <= day and (end is None or day <= end)
