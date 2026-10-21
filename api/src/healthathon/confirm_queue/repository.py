from typing import Any
from uuid import UUID

from psycopg import Connection
from psycopg.rows import DictRow

_ITEM_SELECT = """
SELECT q.id, q.reason::text AS reason, q.created_at, q.resolved_at, q.crop_storage_key,
       COALESCE(q.candidate_readings, '[]'::jsonb) AS candidate_readings,
       ev.id AS value_id, ev.state::text AS value_state,
       ev.analyte_code, a.display_name AS analyte_name, ev.value_text, ev.unit_text,
       p.id AS patient_id, p.registration_no, p.full_name,
       d.id AS document_id, d.doc_type::text AS doc_type, d.document_date
FROM core.confirm_queue_item q
JOIN core.extracted_value ev ON ev.id = q.extracted_value_id
JOIN core.analyte a ON a.code = ev.analyte_code
JOIN core.patient p ON p.id = ev.patient_id
JOIN core.document d ON d.id = ev.document_id
"""


def list_open(conn: Connection[DictRow], limit: int) -> list[dict[str, Any]]:
    # Arrival order only. The queue is never sorted by clinical importance.
    return conn.execute(
        _ITEM_SELECT + " WHERE q.resolved_at IS NULL ORDER BY q.created_at, q.id LIMIT %s",
        (limit,),
    ).fetchall()


def count_open(conn: Connection[DictRow]) -> int:
    row = conn.execute(
        "SELECT count(*) AS n FROM core.confirm_queue_item WHERE resolved_at IS NULL"
    ).fetchone()
    return int(row["n"]) if row else 0


def lock_item(conn: Connection[DictRow], item_id: UUID) -> dict[str, Any] | None:
    """Fetch an item and lock its row, so two reviewers cannot both resolve it."""
    return conn.execute(
        _ITEM_SELECT + " WHERE q.id = %s FOR UPDATE OF q, ev", (item_id,)
    ).fetchone()


def set_value_state(conn: Connection[DictRow], value_id: UUID, state: str) -> None:
    conn.execute(
        "UPDATE core.extracted_value SET state = %s::core.value_state WHERE id = %s",
        (state, value_id),
    )


def insert_replacement(
    conn: Connection[DictRow], original_id: UUID, value_text: str, unit_text: str | None
) -> UUID:
    """
    A correction is a new row (R4). It keeps the original's provenance,
    because the reviewer read the same region of the same page.
    """
    row = conn.execute(
        """
        INSERT INTO core.extracted_value (patient_id, document_id, extraction_run_id,
            provenance_id, analyte_code, value_text, unit_text, observed_at, state)
        SELECT patient_id, document_id, extraction_run_id, provenance_id, analyte_code,
               %s, %s, observed_at, 'confirmed'
        FROM core.extracted_value WHERE id = %s
        RETURNING id
        """,
        (value_text, unit_text, original_id),
    ).fetchone()
    assert row is not None
    new_id: UUID = row["id"]
    conn.execute(
        "UPDATE core.extracted_value SET state = 'superseded', superseded_by = %s WHERE id = %s",
        (new_id, original_id),
    )
    return new_id


def insert_correction(
    conn: Connection[DictRow],
    original_id: UUID,
    replacement_id: UUID | None,
    actor_id: UUID,
    reason_code: str,
    crop_sha256: bytes | None,
    latency_ms: int,
) -> None:
    conn.execute(
        """
        INSERT INTO core.value_correction (original_value_id, replacement_value_id,
            actor_id, reason_code, crop_sha256, decision_latency_ms)
        VALUES (%s, %s, %s, %s, %s, %s)
        """,
        (original_id, replacement_id, actor_id, reason_code, crop_sha256, latency_ms),
    )


def resolve_item(conn: Connection[DictRow], item_id: UUID, actor_id: UUID) -> None:
    conn.execute(
        "UPDATE core.confirm_queue_item SET resolved_at = now(), resolved_by = %s WHERE id = %s",
        (actor_id, item_id),
    )
