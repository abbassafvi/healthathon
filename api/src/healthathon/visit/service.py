from datetime import date, timedelta
from uuid import UUID

from fastapi import HTTPException
from psycopg import Connection
from psycopg.rows import DictRow

from healthathon import clinic_time
from healthathon.audit import record_event
from healthathon.auth import CurrentUser
from healthathon.entries.models import RegimenItemRef
from healthathon.record import repository as record_repo
from healthathon.regimens import repository as regimen_repo
from healthathon.visit import compliance
from healthathon.visit import repository as repo
from healthathon.visit.models import (
    ComplianceScore,
    Period,
    TestOrder,
    VisitInfo,
    VisitSummary,
)

DEFAULT_DAYS = 28


def summary(conn: Connection[DictRow], user: CurrentUser, patient_id: UUID) -> VisitSummary:
    """
    Everything the visit page shows for the period since the last visit.
    Until pat.compliance_score exists, the score is computed here on read,
    from the same ticks the stored one will be computed from.
    """
    if record_repo.get_patient(conn, patient_id) is None:
        raise HTTPException(404, "No such patient")
    today = clinic_time.today()
    start_of_today = clinic_time.midnight(today)
    previous = repo.previous_visit(conn, patient_id, start_of_today)
    previous_day = clinic_time.local(previous).date() if previous else None
    first = (
        previous_day + timedelta(days=1)
        if previous_day
        else today - timedelta(days=DEFAULT_DAYS - 1)
    )
    nxt = repo.next_visit(conn, patient_id, start_of_today)

    record_event(conn, user, "visit.read", "core.patient", patient_id)
    return VisitSummary(
        visit=VisitInfo(
            scheduled_for=clinic_time.local(nxt["scheduled_for"]) if nxt else None,
            clinician_name=nxt["clinician_name"] if nxt else None,
        ),
        period=Period(from_=first, to=today, previous_visit=previous_day),
        orders=[TestOrder(**o) for o in repo.open_orders(conn, patient_id)],
        compliance=_score(conn, patient_id, first, today),
    )


def _score(
    conn: Connection[DictRow], patient_id: UUID, first: date, last: date
) -> ComplianceScore | None:
    """The score for the checklist in force, from the day it was activated if that is later."""
    active = regimen_repo.active_regimen(conn, patient_id)
    if active is None:
        return None
    start = max(first, clinic_time.local(active["activated_at"]).date())
    if start > last:
        return None
    rows = regimen_repo.items_of(conn, [active["id"]])
    items = [
        RegimenItemRef(
            id=r["id"], drug_text=r["drug_text"], dose_text=r["dose_text"],
            schedule_text=r["schedule_text"],
        )
        for r in rows
    ]  # fmt: skip
    ticks: compliance.Ticks = {
        (t["regimen_item_id"], t["tick_date"]): (t["ticked"], t["id"])
        for t in repo.ticks(conn, patient_id, [i.id for i in items], start, last)
    }
    return compliance.compute(active["id"], items, start, last, ticks, clinic_time.now())
