"""
A patient asking the clinic to ring them back.

The other direction from a scheduled call: that is a clinician deciding
to telephone someone, this is a patient asking to be telephoned. It
needs no KYC and no dialler, because the patient made the call; the
clinic only has to know they asked.

Nothing sorts these by anything about the patient. They come back oldest
first, and the only thing a clinic user can do to one is say they have
seen it. What happens next is a conversation, not a field.
"""

from typing import Any
from uuid import UUID

from fastapi import HTTPException
from psycopg import Connection
from psycopg.rows import DictRow

from healthathon import clinic_time
from healthathon.audit import record_event
from healthathon.auth import CurrentUser
from healthathon.calls.models import CallbackRequest, CallbackRequests

_SELECT = """
SELECT cr.id, cr.patient_id, cr.requested_at, cr.channel::text AS channel,
       cr.seen_at, p.full_name AS patient_name, p.registration_no,
       p.preferred_language, u.full_name AS seen_by_name
FROM core.callback_request cr
JOIN core.patient p ON p.id = cr.patient_id
LEFT JOIN core.clinic_user u ON u.id = cr.seen_by
"""


def _shown(row: dict[str, Any]) -> CallbackRequest:
    return CallbackRequest(
        id=row["id"],
        patient_id=row["patient_id"],
        patient_name=row["patient_name"],
        registration_no=row["registration_no"],
        preferred_language=row["preferred_language"],
        requested_at=clinic_time.local(row["requested_at"]),
        channel=row["channel"],
        seen_at=clinic_time.local(row["seen_at"]) if row["seen_at"] else None,
        seen_by_name=row["seen_by_name"],
    )


def record(
    conn: Connection[DictRow], patient_id: UUID, capture_id: str, channel: str = "voice_call"
) -> bool:
    """
    Write down that this patient asked to be rung back.

    False when the same call asked twice: a redelivered webhook records
    one request, not a queue of them.
    """
    row = conn.execute(
        "INSERT INTO core.callback_request (patient_id, channel, client_capture_id)"
        " VALUES (%s, %s, %s) ON CONFLICT (client_capture_id) DO NOTHING RETURNING id",
        (patient_id, channel, capture_id),
    ).fetchone()
    if row is None:
        return False
    record_event(conn, None, "callback.request", "core.patient", patient_id)
    return True


def waiting(conn: Connection[DictRow], include_seen: bool = False) -> CallbackRequests:
    """Who has asked to be rung, oldest first. Never ordered by anything else."""
    where = "" if include_seen else " WHERE cr.seen_at IS NULL"
    rows = conn.execute(f"{_SELECT}{where} ORDER BY cr.requested_at").fetchall()
    return CallbackRequests(requests=[_shown(r) for r in rows])


def for_patient(conn: Connection[DictRow], patient_id: UUID) -> CallbackRequests:
    rows = conn.execute(
        f"{_SELECT} WHERE cr.patient_id = %s ORDER BY cr.requested_at DESC", (patient_id,)
    ).fetchall()
    return CallbackRequests(requests=[_shown(r) for r in rows])


def mark_seen(conn: Connection[DictRow], user: CurrentUser, request_id: UUID) -> CallbackRequest:
    """A clinic user says they have seen it. Saying so twice changes nothing."""
    row = conn.execute(
        "UPDATE core.callback_request SET seen_at = now(), seen_by = %s"
        " WHERE id = %s AND seen_at IS NULL RETURNING id",
        (user.id, request_id),
    ).fetchone()
    if (
        row is None
        and conn.execute(
            "SELECT 1 FROM core.callback_request WHERE id = %s", (request_id,)
        ).fetchone()
        is None
    ):
        raise HTTPException(404, "No such callback request")
    if row is not None:
        record_event(conn, user, "callback.seen", "core.callback_request", request_id)
    found = conn.execute(f"{_SELECT} WHERE cr.id = %s", (request_id,)).fetchone()
    assert found is not None
    return _shown(found)
