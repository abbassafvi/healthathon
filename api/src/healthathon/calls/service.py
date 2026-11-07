"""
Scheduling a survey call, and placing the ones that are due.

A clinician picks a patient and a time. Nothing else decides who is
rung: there is no rule that picks patients out, because a system that
chose whom to telephone would be making a judgement about them, and this
one does not make judgements.

Placing is separate from scheduling on purpose. The schedule is a
clinician's intent and survives anything; the placing is a side effect
that can fail, and when it does it says so in words on the row rather
than retrying forever.
"""

from datetime import datetime
from typing import Any
from uuid import UUID

import httpx
from fastapi import HTTPException
from psycopg import Connection
from psycopg.rows import DictRow

from healthathon import clinic_time
from healthathon.audit import record_event
from healthathon.auth import CurrentUser
from healthathon.calls import repository as repo
from healthathon.calls.models import ScheduledCall, ScheduledCalls
from healthathon.config import Settings
from healthathon.voice import outbound


def _state(row: dict[str, Any]) -> str:
    if row["cancelled_at"]:
        return "cancelled"
    if row["placed_at"]:
        return "placed"
    return "failed" if row["failure"] else "waiting"


def _shown(row: dict[str, Any]) -> ScheduledCall:
    return ScheduledCall(
        id=row["id"],
        patient_id=row["patient_id"],
        patient_name=row["patient_name"],
        registration_no=row["registration_no"],
        scheduled_for=clinic_time.local(row["scheduled_for"]),
        scheduled_by_name=row["scheduled_by_name"],
        placed_at=clinic_time.local(row["placed_at"]) if row["placed_at"] else None,
        cancelled_at=clinic_time.local(row["cancelled_at"]) if row["cancelled_at"] else None,
        failure=row["failure"],
        state=_state(row),
    )


def schedule(
    conn: Connection[DictRow], user: CurrentUser, patient_id: UUID, when: datetime
) -> ScheduledCall:
    """
    Write down that a clinician wants this patient rung at this time.

    Refused if the patient cannot be rung, because a schedule full of
    calls that can never be placed tells a clinician nothing. Refused
    too without a voice consent: the clinic does not telephone someone
    who did not agree to be telephoned.
    """
    patient = conn.execute(
        "SELECT id FROM core.patient WHERE id = %s AND exited_at IS NULL", (patient_id,)
    ).fetchone()
    if patient is None:
        raise HTTPException(404, "No such patient")
    from healthathon.inbound import store

    if not store.consented(conn, patient_id, store.VOICE.consent_item):
        raise HTTPException(409, "This patient has not agreed to be telephoned")
    if repo.sealed_number(conn, patient_id) is None:
        raise HTTPException(409, "The clinic has no number it can dial for this patient")
    if when < clinic_time.now():
        raise HTTPException(422, "That time has already passed")

    row = repo.insert(conn, patient_id, when, user.id)
    assert row is not None
    record_event(
        conn,
        user,
        "call.schedule",
        "core.scheduled_call",
        row["id"],
        new_value={"scheduled_for": when.isoformat()},
    )
    return _shown(row)


def for_patient(conn: Connection[DictRow], patient_id: UUID) -> ScheduledCalls:
    return ScheduledCalls(calls=[_shown(r) for r in repo.for_patient(conn, patient_id)])


def cancel(conn: Connection[DictRow], user: CurrentUser, call_id: UUID) -> ScheduledCall:
    """Call off a call nobody has placed. One already rung cannot be undone."""
    if repo.one(conn, call_id) is None:
        raise HTTPException(404, "No such scheduled call")
    if not repo.cancel(conn, call_id, user.id):
        raise HTTPException(409, "That call has already been placed or called off")
    record_event(conn, user, "call.cancel", "core.scheduled_call", call_id)
    row = repo.one(conn, call_id)
    assert row is not None
    return _shown(row)


def place_due(
    conn: Connection[DictRow],
    now: datetime | None = None,
    client: httpx.Client | None = None,
    settings: Settings | None = None,
) -> int:
    """
    Ring everyone whose call is due. Returns how many were placed.

    Each row is locked while it is dealt with and skipped if another
    runner has it, so nobody is rung twice. A failure is written on the
    row and the call is not tried again: a patient telephoned over and
    over by a retry loop is the thing to avoid most.
    """
    placed = 0
    for row in repo.due(conn, now or clinic_time.now()):
        call_id = UUID(str(row["id"]))
        sealed = repo.sealed_number(conn, UUID(str(row["patient_id"])))
        answer = outbound.place(sealed, call_id, client, settings)
        if answer.ok and answer.call_id:
            repo.mark_placed(conn, call_id, answer.call_id)
            record_event(conn, None, "call.place", "core.scheduled_call", call_id)
            placed += 1
        else:
            repo.mark_failed(conn, call_id, answer.failure or "The call could not be placed.")
            record_event(
                conn,
                None,
                "call.fail",
                "core.scheduled_call",
                call_id,
                new_value={"failure": answer.failure},
            )
    return placed
