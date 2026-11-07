from typing import Any
from uuid import UUID

from psycopg import Connection
from psycopg.rows import DictRow


def document(conn: Connection[DictRow], document_id: UUID) -> dict[str, Any] | None:
    return conn.execute(
        """
        SELECT d.id, d.doc_type::text AS doc_type, d.document_date, d.issuing_source,
               d.created_at, d.page_count, i.channel::text AS sent_from,
               p.id AS patient_id, p.registration_no, p.full_name
        FROM core.document d
        JOIN core.patient p ON p.id = d.patient_id
        JOIN core.intake i ON i.id = d.intake_id
        WHERE d.id = %s
        """,
        (document_id,),
    ).fetchone()


def pages(conn: Connection[DictRow], document_id: UUID) -> list[dict[str, Any]]:
    return conn.execute(
        "SELECT id, page_no, storage_key, width_px, height_px FROM core.document_page"
        " WHERE document_id = %s ORDER BY page_no",
        (document_id,),
    ).fetchall()


def latest_run(conn: Connection[DictRow], document_id: UUID) -> dict[str, Any] | None:
    return conn.execute(
        "SELECT reader_name, reader_version, profile_version, code_commit, started_at,"
        " finished_at FROM core.extraction_run WHERE document_id = %s"
        " ORDER BY started_at DESC LIMIT 1",
        (document_id,),
    ).fetchone()


def read_values(conn: Connection[DictRow], document_id: UUID) -> list[dict[str, Any]]:
    """
    The values the reader produced for this document, in page order. A
    person's correction is a new row that keeps the original's run and
    region, so it is left out here and reached through superseded_by.
    """
    return conn.execute(
        """
        SELECT ev.id, ev.state::text AS state, ev.superseded_by, a.display_name AS analyte_name,
               pg.page_no, pr.bbox_x, pr.bbox_y, pr.bbox_w, pr.bbox_h,
               q.reason::text AS reason, q.resolved_at, q.id AS queue_item_id
        FROM core.extracted_value ev
        JOIN core.analyte a ON a.code = ev.analyte_code
        JOIN core.provenance pr ON pr.id = ev.provenance_id
        LEFT JOIN core.document_page pg ON pg.id = pr.page_id
        LEFT JOIN core.confirm_queue_item q ON q.extracted_value_id = ev.id
        WHERE ev.document_id = %s AND ev.extraction_run_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM core.extracted_value o WHERE o.superseded_by = ev.id)
        ORDER BY pg.page_no NULLS LAST, pr.bbox_y NULLS LAST, ev.id
        """,
        (document_id,),
    ).fetchall()


def renderable(conn: Connection[DictRow], value_ids: list[UUID]) -> dict[UUID, dict[str, Any]]:
    """Value text only through proj.renderable_value, the one view that may be shown."""
    rows = conn.execute(
        "SELECT id, value_text, unit_text FROM proj.renderable_value WHERE id = ANY(%s)",
        (value_ids,),
    ).fetchall()
    return {r["id"]: r for r in rows}


def checks(conn: Connection[DictRow], value_ids: list[UUID]) -> dict[UUID, list[dict[str, Any]]]:
    rows = conn.execute(
        "SELECT extracted_value_id, check_code::text AS code, outcome::text AS outcome"
        " FROM core.check_result WHERE extracted_value_id = ANY(%s)",
        (value_ids,),
    ).fetchall()
    out: dict[UUID, list[dict[str, Any]]] = {}
    for r in rows:
        out.setdefault(r["extracted_value_id"], []).append(r)
    return out


def decisions(conn: Connection[DictRow], value_ids: list[UUID]) -> dict[UUID, dict[str, Any]]:
    """The decision a person made on each value, from the audit chain."""
    rows = conn.execute(
        """
        SELECT DISTINCT ON (e.entity_id) e.entity_id, e.action, e.occurred_at,
               e.old_value, e.new_value, u.full_name AS by_name
        FROM audit.event e LEFT JOIN core.clinic_user u ON u.id = e.actor_id
        WHERE e.entity_table = 'core.extracted_value' AND e.entity_id = ANY(%s)
          AND e.action IN ('value.confirm', 'value.correct', 'value.discard')
        ORDER BY e.entity_id, e.id DESC
        """,
        (value_ids,),
    ).fetchall()
    return {r["entity_id"]: r for r in rows}


def lines(conn: Connection[DictRow], document_id: UUID) -> list[dict[str, Any]]:
    """Prescription lines read from this document, in the order they are written."""
    return conn.execute(
        """
        SELECT ri.id, ri.regimen_id, ri.drug_text, ri.dose_text, ri.schedule_text,
               ri.confirmed_at, ri.accepted_at, u.full_name AS confirmed_by_name,
               pg.page_no, p.bbox_x, p.bbox_y, p.bbox_w, p.bbox_h,
               (SELECT e.old_value FROM audit.event e
                WHERE e.entity_table = 'core.regimen_item' AND e.entity_id = ri.id
                  AND e.action = 'regimen_item.correct'
                ORDER BY e.id LIMIT 1) AS original
        FROM core.regimen_item ri
        JOIN core.regimen r ON r.id = ri.regimen_id
        JOIN core.provenance p ON p.id = ri.provenance_id
        LEFT JOIN core.document_page pg ON pg.id = p.page_id
        LEFT JOIN core.clinic_user u ON u.id = ri.confirmed_by
        WHERE r.source_document_id = %s
        ORDER BY pg.page_no NULLS LAST, p.bbox_y NULLS LAST, ri.id
        """,
        (document_id,),
    ).fetchall()
