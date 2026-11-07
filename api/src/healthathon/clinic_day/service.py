from collections import Counter
from datetime import date, timedelta
from typing import Any

from psycopg import Connection
from psycopg.rows import DictRow

from healthathon import clinic_time
from healthathon.audit import record_event
from healthathon.auth import CurrentUser
from healthathon.clinic_day import repository as repo
from healthathon.clinic_day.models import (
    ChecklistState,
    ClinicDay,
    DayPatient,
    DayVisit,
    DocumentsSince,
    EntriesSince,
    Waiting,
)
from healthathon.entries import repository as entries_repo
from healthathon.regimens import service as regimens
from healthathon.visit import repository as visit_repo
from healthathon.visit.service import DEFAULT_DAYS


def clinic_day(conn: Connection[DictRow], user: CurrentUser, day: date) -> ClinicDay:
    """
    Every visit booked on a day, with what each patient's record holds for
    the period the visit page will cover. The same period and the same
    counting as the visit page, so the two never disagree.
    """
    start, end = clinic_time.day_bounds(day, day)
    visits = [_visit(conn, v, day) for v in repo.visits_between(conn, start, end)]
    record_event(conn, user, "clinic_day.read", "proj.visit", None, new_value={"date": day})
    return ClinicDay(date=day, visits=visits)


def _visit(conn: Connection[DictRow], v: dict[str, Any], day: date) -> DayVisit:
    pid = v["patient_id"]
    previous = visit_repo.previous_visit(conn, pid, clinic_time.midnight(day))
    previous_day = clinic_time.local(previous).date() if previous else None
    first = (
        previous_day + timedelta(days=1) if previous_day else day - timedelta(days=DEFAULT_DAYS - 1)
    )
    docs = repo.document_counts(conn, pid, first, day)
    start, end = clinic_time.day_bounds(first, day)
    entries = entries_repo.entries_between(conn, pid, first, day, start, end)
    kinds = Counter(e["kind"] for e in entries)
    checklist = regimens.checklist(conn, pid)
    # Settled, not confirmed: a line every check passed needs nobody,
    # and counting it as waiting put today's list one ahead of itself.
    waiting = [r for r in checklist.awaiting_review if r.settled_count < r.item_count]
    return DayVisit(
        visit_id=v["id"],
        scheduled_for=clinic_time.local(v["scheduled_for"]),
        started_at=clinic_time.local(v["started_at"]) if v["started_at"] else None,
        clinician_name=v["clinician_name"],
        patient=DayPatient(
            id=pid,
            registration_no=v["registration_no"],
            full_name=v["full_name"],
            year_of_birth=v["year_of_birth"],
            sex=v["sex"],
        ),
        period_from=first,
        previous_visit=previous_day,
        documents=DocumentsSince(
            lab_reports=docs.get("lab_report", 0), prescriptions=docs.get("prescription", 0)
        ),
        waiting=Waiting(
            values=repo.open_queue_items(conn, pid),
            prescription_lines=sum(r.item_count - r.settled_count for r in waiting),
            review_regimen_id=waiting[0].regimen_id if waiting else None,
        ),
        checklist=ChecklistState(
            active_since=checklist.active.activated_at.date() if checklist.active else None,
            medicines=len(checklist.active.items) if checklist.active else 0,
        ),
        entries=EntriesSince(
            medicine_ticks=kinds["medication_tick"],
            glucose_readings=kinds["glucose_reading"],
            answers=kinds["survey_answer"],
            meal_photos=kinds["meal_photo"],
            last_at=clinic_time.local(max(e["occurred_at"] for e in entries)) if entries else None,
        ),
    )
