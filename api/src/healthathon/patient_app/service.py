from typing import Any
from uuid import UUID

from fastapi import HTTPException
from psycopg import Connection
from psycopg.rows import DictRow

from healthathon import clinic_time, storage
from healthathon.entries import repository as entries_repo
from healthathon.patient_app import repository as repo
from healthathon.patient_app.models import (
    AppChecklistItem,
    AppMeal,
    AppPatient,
    AppQuestion,
    AppReading,
    SurveyState,
    Today,
)


def require_patient(conn: Connection[DictRow], patient_id: UUID) -> dict[str, Any]:
    p = repo.patient(conn, patient_id)
    if p is None:
        raise HTTPException(404, "No such patient")
    return p


def today(conn: Connection[DictRow], patient_id: UUID) -> Today:
    """
    One day in the app: the checklist and what has been recorded today, by
    the clinic's calendar. Stored values come back as they were entered.
    """
    patient = require_patient(conn, patient_id)
    day = clinic_time.today()
    start, end = clinic_time.day_bounds(day, day)
    rows = entries_repo.entries_between(conn, patient_id, day, day, start, end)

    ticks = {str(r["item_id"]): r["ticked"] for r in rows if r["kind"] == "medication_tick"}
    readings = [
        AppReading(
            id=r["id"],
            value_text=r["value_text"],
            context=r["context"],
            occurred_at=clinic_time.local(r["occurred_at"]),
        )
        for r in rows
        if r["kind"] == "glucose_reading"
    ]
    daily = [
        r
        for r in rows
        if r["kind"] == "survey_answer" and r["question_key"] in entries_repo.DAILY_QUESTION_KEYS
    ]
    meals = [
        AppMeal(
            id=r["id"],
            uri=storage.url_for(r["storage_key"]),
            occurred_at=clinic_time.local(r["occurred_at"]),
            meal=r["meal"],
            calories_text=r["calories_text"],
        )
        for r in rows
        if r["kind"] == "meal_photo"
    ]
    return Today(
        date=day,
        patient=AppPatient(**patient),
        items=[AppChecklistItem(**i) for i in repo.active_items(conn, patient_id)],
        ticks=ticks,
        readings=readings,
        question=daily_question(conn),
        answer=daily[-1]["answer_text"] if daily else None,
        answer_audio_uri=storage.url_for(daily[-1]["audio_key"])
        if daily and daily[-1]["audio_key"]
        else None,
        answer_transcript=daily[-1]["transcript_text"] if daily else None,
        meals=meals,
        survey=survey_state(conn, patient_id),
    )


def daily_question(conn: Connection[DictRow]) -> AppQuestion | None:
    rows = entries_repo.questions(conn, entries_repo.DAILY_QUESTION_KEYS)
    if not rows:
        return None
    first = min(rows, key=lambda q: q["display_order"])
    return AppQuestion(key=first["question_key"], text=first["texts"])


def survey_state(conn: Connection[DictRow], patient_id: UUID) -> SurveyState:
    """Open when the clinician chose questions; done once each has an answer this week."""
    qs = repo.question_set(conn, patient_id)
    questions = repo.set_questions(conn, qs["id"]) if qs else []
    if not qs or not questions:
        return SurveyState(open=False, done=False)
    since = clinic_time.midnight(clinic_time.week_start(clinic_time.today()))
    return SurveyState(
        open=True, done=repo.answered_in_set(conn, qs["id"], since) >= len(questions)
    )


def survey_questions(conn: Connection[DictRow], patient_id: UUID) -> list[AppQuestion]:
    require_patient(conn, patient_id)
    qs = repo.question_set(conn, patient_id)
    if qs is None:
        return []
    return [
        AppQuestion(key=q["question_key"], text=q["texts"])
        for q in repo.set_questions(conn, qs["id"])
    ]
