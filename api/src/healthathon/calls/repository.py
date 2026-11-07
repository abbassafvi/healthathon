from datetime import datetime
from typing import Any
from uuid import UUID

from psycopg import Connection
from psycopg.rows import DictRow

_SELECT = """
SELECT sc.id, sc.patient_id, sc.scheduled_for, sc.placed_at, sc.cancelled_at,
       sc.failure, p.full_name AS patient_name, p.registration_no,
       u.full_name AS scheduled_by_name
FROM core.scheduled_call sc
JOIN core.patient p ON p.id = sc.patient_id
JOIN core.clinic_user u ON u.id = sc.scheduled_by
"""


def insert(
    conn: Connection[DictRow], patient_id: UUID, when: datetime, by: UUID
) -> dict[str, Any] | None:
    row = conn.execute(
        "INSERT INTO core.scheduled_call (patient_id, scheduled_for, scheduled_by)"
        " VALUES (%s, %s, %s) RETURNING id",
        (patient_id, when, by),
    ).fetchone()
    return one(conn, UUID(str(row["id"]))) if row else None


def one(conn: Connection[DictRow], call_id: UUID) -> dict[str, Any] | None:
    return conn.execute(f"{_SELECT} WHERE sc.id = %s", (call_id,)).fetchone()


def for_patient(conn: Connection[DictRow], patient_id: UUID) -> list[dict[str, Any]]:
    """Soonest first. Never ordered by anything about the patient."""
    return conn.execute(
        f"{_SELECT} WHERE sc.patient_id = %s ORDER BY sc.scheduled_for", (patient_id,)
    ).fetchall()


def due(conn: Connection[DictRow], now: datetime, limit: int = 20) -> list[dict[str, Any]]:
    """
    Calls whose time has come and which nothing has dealt with yet.

    Locked while the runner holds them, and skipped if another runner
    already has one, so two runners never ring the same patient twice.
    """
    return conn.execute(
        """
        SELECT sc.id, sc.patient_id FROM core.scheduled_call sc
        WHERE sc.scheduled_for <= %s AND sc.placed_at IS NULL
          AND sc.cancelled_at IS NULL AND sc.failure IS NULL
        ORDER BY sc.scheduled_for
        LIMIT %s
        FOR UPDATE SKIP LOCKED
        """,
        (now, limit),
    ).fetchall()


def sealed_number(conn: Connection[DictRow], patient_id: UUID) -> bytes | None:
    row = conn.execute(
        "SELECT phone_sealed FROM core.patient_phone"
        " WHERE patient_id = %s AND phone_sealed IS NOT NULL"
        " ORDER BY is_primary DESC, id LIMIT 1",
        (patient_id,),
    ).fetchone()
    return bytes(row["phone_sealed"]) if row and row["phone_sealed"] else None


def mark_placed(conn: Connection[DictRow], call_id: UUID, provider_call_id: str) -> None:
    conn.execute(
        "UPDATE core.scheduled_call SET placed_at = now(), provider_call_id = %s WHERE id = %s",
        (provider_call_id, call_id),
    )


def mark_failed(conn: Connection[DictRow], call_id: UUID, why: str) -> None:
    conn.execute("UPDATE core.scheduled_call SET failure = %s WHERE id = %s", (why, call_id))


def cancel(conn: Connection[DictRow], call_id: UUID, by: UUID) -> bool:
    """A call nobody has placed yet can be called off. One that went cannot."""
    row = conn.execute(
        "UPDATE core.scheduled_call SET cancelled_at = now(), cancelled_by = %s"
        " WHERE id = %s AND placed_at IS NULL AND cancelled_at IS NULL RETURNING id",
        (by, call_id),
    ).fetchone()
    return row is not None
