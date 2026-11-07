from datetime import date, datetime, timedelta
from typing import Any
from uuid import UUID

from psycopg import Connection
from psycopg.rows import DictRow
from pydantic import BaseModel

from healthathon import clinic_time, storage
from healthathon.entries import repository as entries_repo
from healthathon.patient_app import repository as repo
from healthathon.patient_app.models import AppChecklistItem, AppMeal, AppQuestion, AppReading
from healthathon.patient_app.service import require_patient

# Earlier days in the app, exactly as the patient recorded them. Nothing is
# added up, compared or averaged, and a day with no entries says so.


class AppPastTick(BaseModel):
    item: AppChecklistItem
    # None when the medicine was on the checklist that day and nothing was marked.
    ticked: bool | None


class AppPastAnswer(BaseModel):
    question: AppQuestion
    answer_text: str | None
    # The patient's own recording, when the answer was spoken.
    audio_uri: str | None
    # What a speech recogniser heard in it, when transcription is on.
    transcript: str | None = None
    occurred_at: datetime


class AppDay(BaseModel):
    date: date
    ticks: list[AppPastTick]
    readings: list[AppReading]
    answers: list[AppPastAnswer]
    meals: list[AppMeal]


class PastDays(BaseModel):
    days: list[AppDay]
    # Pass as `before` for the next, earlier days; None once there are none.
    next_before: date | None


def past_days(
    conn: Connection[DictRow], patient_id: UUID, before: date | None, count: int
) -> PastDays:
    """
    `count` days before `before` (today by default), newest first, from the
    patient's first entry on. Only days before today: today has its own screen.
    """
    require_patient(conn, patient_id)
    today = clinic_time.today()
    end = min(before or today, today)
    first_entry = _first_entry_day(conn, patient_id)
    if first_entry is None or end <= first_entry:
        return PastDays(days=[], next_before=None)
    start = max(end - timedelta(days=count), first_entry)
    t0, t1 = clinic_time.day_bounds(start, end - timedelta(days=1))
    rows = entries_repo.entries_between(conn, patient_id, start, end - timedelta(days=1), t0, t1)
    questions = {
        q["question_key"]: AppQuestion(key=q["question_key"], text=q["texts"])
        for q in entries_repo.questions(
            conn, tuple({r["question_key"] for r in rows if r["question_key"]})
        )
    }
    items = repo.checklist_items(conn, patient_id)
    days = [
        _day(start + timedelta(days=i), rows, questions, items) for i in range((end - start).days)
    ][::-1]
    return PastDays(days=days, next_before=start if start > first_entry else None)


def _day(
    day: date,
    rows: list[dict[str, Any]],
    questions: dict[str, AppQuestion],
    items: list[dict[str, Any]],
) -> AppDay:
    ticks: dict[UUID, dict[str, Any]] = {}
    for r in rows:
        if r["kind"] == "medication_tick" and r["tick_date"] == day:
            ticks[r["item_id"]] = r  # in time order, so a later change wins
    on_day = [
        r
        for r in rows
        if r["kind"] != "medication_tick" and clinic_time.local(r["occurred_at"]).date() == day
    ]
    return AppDay(
        date=day,
        ticks=_ticks(day, ticks, items),
        readings=[
            AppReading(
                id=r["id"], value_text=r["value_text"], context=r["context"],
                occurred_at=clinic_time.local(r["occurred_at"]),
                channel=r["channel"],
            )
            for r in on_day
            if r["kind"] == "glucose_reading"
        ],
        answers=[
            AppPastAnswer(
                question=questions[r["question_key"]],
                answer_text=r["answer_text"],
                audio_uri=storage.url_for(r["audio_key"]) if r["audio_key"] else None,
                transcript=r["transcript_text"],
                occurred_at=clinic_time.local(r["occurred_at"]),
            )
            for r in on_day
            if r["kind"] == "survey_answer" and r["question_key"] in questions
        ],
        meals=[
            AppMeal(
                id=r["id"], uri=storage.url_for(r["storage_key"]),
                occurred_at=clinic_time.local(r["occurred_at"]),
                meal=r["meal"], calories_text=r["calories_text"],
            )
            for r in on_day
            if r["kind"] == "meal_photo"
        ],
    )  # fmt: skip


def _ticks(
    day: date, ticks: dict[UUID, dict[str, Any]], items: list[dict[str, Any]]
) -> list[AppPastTick]:
    """
    The checklist in force at the end of the day, in its own order, each
    medicine with what was marked or None; then anything marked against a
    checklist that ended that day.
    """
    _, end = clinic_time.day_bounds(day, day)
    listed = [
        i for i in items
        if i["activated_at"] < end and (i["superseded_at"] is None or i["superseded_at"] >= end)
    ]  # fmt: skip
    ids = {i["id"] for i in listed}
    listed += [i for i in items if i["id"] in ticks and i["id"] not in ids]
    return [
        AppPastTick(
            item=AppChecklistItem(id=i["id"], drug_text=i["drug_text"], dose_text=i["dose_text"],
                                  schedule_text=i["schedule_text"]),
            ticked=ticks[i["id"]]["ticked"] if i["id"] in ticks else None,
        )
        for i in listed
    ]  # fmt: skip


def _first_entry_day(conn: Connection[DictRow], patient_id: UUID) -> date | None:
    row = conn.execute(
        """
        SELECT min(COALESCE(t.tick_date, (e.occurred_at AT TIME ZONE %s)::date)) AS first
        FROM pat.entry e LEFT JOIN pat.medication_tick t ON t.entry_id = e.id
        WHERE e.patient_id = %s
        """,
        (str(clinic_time.zone()), patient_id),
    ).fetchone()
    return row["first"] if row else None
