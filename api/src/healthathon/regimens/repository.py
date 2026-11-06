from typing import Any
from uuid import UUID

from psycopg import Connection
from psycopg.rows import DictRow

_REGIMEN = """
SELECT r.id, r.patient_id, r.activated_at, r.superseded_at,
       u.full_name AS activated_by_name,
       d.id AS document_id, d.document_date, d.issuing_source
FROM core.regimen r
LEFT JOIN core.clinic_user u ON u.id = r.activated_by
LEFT JOIN core.document d ON d.id = r.source_document_id
"""

_ITEMS = """
SELECT ri.id, ri.regimen_id, ri.drug_text, ri.dose_text, ri.schedule_text, ri.confirmed_at,
       ri.accepted_at,
       u.full_name AS confirmed_by_name,
       -- What the deterministic layer decided about this line, so the
       -- review can put a clinician's attention where it is needed.
       (SELECT count(*) FROM core.check_result c
         WHERE c.regimen_item_id = ri.id AND c.outcome = 'pass') AS checks_passed,
       (SELECT count(*) FROM core.check_result c
         WHERE c.regimen_item_id = ri.id AND c.outcome <> 'not_applicable') AS checks_ran,
       (SELECT c.check_code::text FROM core.check_result c
         WHERE c.regimen_item_id = ri.id AND c.outcome = 'fail'
         ORDER BY c.check_code LIMIT 1) AS failed_check,
       p.bbox_x, p.bbox_y, p.bbox_w, p.bbox_h,
       pg.storage_key AS page_key, pg.width_px, pg.height_px
FROM core.regimen_item ri
JOIN core.provenance p ON p.id = ri.provenance_id
LEFT JOIN core.document_page pg ON pg.id = p.page_id
LEFT JOIN core.clinic_user u ON u.id = ri.confirmed_by
"""


def regimens_of(conn: Connection[DictRow], patient_id: UUID) -> list[dict[str, Any]]:
    return conn.execute(
        _REGIMEN + " WHERE r.patient_id = %s ORDER BY d.document_date, r.id", (patient_id,)
    ).fetchall()


def regimen(
    conn: Connection[DictRow], regimen_id: UUID, lock: bool = False
) -> dict[str, Any] | None:
    sql = _REGIMEN + " WHERE r.id = %s" + (" FOR UPDATE OF r" if lock else "")
    return conn.execute(sql, (regimen_id,)).fetchone()


def items_of(conn: Connection[DictRow], regimen_ids: list[UUID]) -> list[dict[str, Any]]:
    """Items in the order they are written on the page."""
    return conn.execute(
        _ITEMS + " WHERE ri.regimen_id = ANY(%s) ORDER BY p.bbox_y NULLS LAST, ri.id",
        (regimen_ids,),
    ).fetchall()


def item(conn: Connection[DictRow], item_id: UUID) -> dict[str, Any] | None:
    return conn.execute(_ITEMS + " WHERE ri.id = %s", (item_id,)).fetchone()


def lock_patient(conn: Connection[DictRow], patient_id: UUID) -> None:
    """Serialise activations for one patient, so two cannot both become active."""
    conn.execute("SELECT 1 FROM core.patient WHERE id = %s FOR UPDATE", (patient_id,))


def confirm_item(
    conn: Connection[DictRow],
    item_id: UUID,
    actor_id: UUID,
    drug_text: str,
    dose_text: str,
    schedule_text: str | None,
) -> None:
    conn.execute(
        """
        UPDATE core.regimen_item SET drug_text = %s, dose_text = %s, schedule_text = %s,
            confirmed_by = %s, confirmed_at = now()
        WHERE id = %s
        """,
        (drug_text, dose_text, schedule_text, actor_id, item_id),
    )


def delete_item(conn: Connection[DictRow], item_id: UUID) -> None:
    conn.execute("DELETE FROM core.regimen_item WHERE id = %s", (item_id,))


def active_regimen(conn: Connection[DictRow], patient_id: UUID) -> dict[str, Any] | None:
    return conn.execute(
        _REGIMEN + " WHERE r.patient_id = %s AND r.activated_at IS NOT NULL"
        " AND r.superseded_at IS NULL ORDER BY r.activated_at DESC LIMIT 1",
        (patient_id,),
    ).fetchone()


def supersede(conn: Connection[DictRow], regimen_id: UUID) -> None:
    conn.execute("UPDATE core.regimen SET superseded_at = now() WHERE id = %s", (regimen_id,))


def activate(conn: Connection[DictRow], regimen_id: UUID, actor_id: UUID) -> Any:
    row = conn.execute(
        "UPDATE core.regimen SET activated_at = now(), activated_by = %s WHERE id = %s"
        " RETURNING activated_at",
        (actor_id, regimen_id),
    ).fetchone()
    assert row is not None
    return row["activated_at"]
