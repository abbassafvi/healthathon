from typing import Any
from uuid import UUID

from psycopg import Connection
from psycopg.rows import DictRow

from healthathon import clinic_time

# Every clinical value read here comes from proj.renderable_value, the only
# view the clinician API may read values from. A value in the confirm queue,
# discarded or superseded cannot reach these queries.


def list_patients(conn: Connection[DictRow]) -> list[dict[str, Any]]:
    """
    Every enrolled patient, with what their record holds now: visits, the
    checklist, what waits for a person, documents and the latest entry.
    Counts of the record only; nothing here ranks or judges a patient.
    """
    return conn.execute(
        """
        SELECT p.id, p.registration_no, p.full_name, p.year_of_birth, p.sex,
               p.preferred_language, p.enrolled_at,
               cg.full_name AS caregiver_name, cg.relationship AS caregiver_relationship,
               (SELECT max(v.started_at) FROM proj.visit v
                 WHERE v.patient_id = p.id AND v.started_at IS NOT NULL) AS last_visit,
               (SELECT min(v.scheduled_for) FROM proj.visit v
                 WHERE v.patient_id = p.id AND v.started_at IS NULL
                   AND v.scheduled_for >= %(today)s) AS next_visit,
               r.activated_at AS checklist_since,
               (SELECT count(*) FROM core.regimen_item ri
                 WHERE ri.regimen_id = r.id) AS checklist_medicines,
               (SELECT count(*) FROM core.confirm_queue_item q
                 JOIN core.extracted_value ev ON ev.id = q.extracted_value_id
                 WHERE ev.patient_id = p.id AND q.resolved_at IS NULL) AS waiting_values,
               (SELECT count(*) FROM core.regimen pr
                 JOIN core.regimen_item ri ON ri.regimen_id = pr.id
                 WHERE pr.patient_id = p.id AND pr.activated_at IS NULL
                   AND ri.confirmed_at IS NULL) AS waiting_lines,
               (SELECT count(*) FROM core.document d WHERE d.patient_id = p.id) AS documents,
               (SELECT max(e.occurred_at) FROM pat.entry e
                 WHERE e.patient_id = p.id) AS last_entry_at
        FROM core.patient p
        LEFT JOIN LATERAL (
            SELECT full_name, relationship FROM core.caregiver c
            WHERE c.patient_id = p.id AND c.revoked_at IS NULL
            ORDER BY c.nominated_at DESC LIMIT 1
        ) cg ON true
        LEFT JOIN core.regimen r
               ON r.patient_id = p.id AND r.activated_at IS NOT NULL AND r.superseded_at IS NULL
        WHERE p.exited_at IS NULL
        ORDER BY p.registration_no
        """,
        {"today": clinic_time.midnight(clinic_time.today())},
    ).fetchall()


def get_patient(conn: Connection[DictRow], patient_id: UUID) -> dict[str, Any] | None:
    return conn.execute(
        "SELECT id, registration_no, full_name, year_of_birth, sex, preferred_language"
        " FROM core.patient WHERE id = %s",
        (patient_id,),
    ).fetchone()


def record_values(conn: Connection[DictRow], patient_id: UUID) -> list[dict[str, Any]]:
    """Renderable values with their documents, newest document first, page order within."""
    return conn.execute(
        """
        SELECT d.id AS document_id, d.doc_type::text AS doc_type, d.document_date,
               d.issuing_source, rv.id, rv.analyte_code, a.display_name AS analyte_name,
               rv.value_text, rv.unit_text, rv.observed_at
        FROM proj.renderable_value rv
        JOIN core.document d ON d.id = rv.document_id
        JOIN core.analyte a ON a.code = rv.analyte_code
        JOIN core.provenance p ON p.id = rv.provenance_id
        WHERE rv.patient_id = %s
        ORDER BY d.document_date DESC NULLS LAST, d.created_at DESC, d.id,
                 p.bbox_y NULLS LAST, p.char_start NULLS LAST, rv.created_at
        """,
        (patient_id,),
    ).fetchall()


def trace_row(conn: Connection[DictRow], value_id: UUID) -> dict[str, Any] | None:
    return conn.execute(
        """
        SELECT rv.id, rv.analyte_code, a.display_name AS analyte_name, rv.value_text,
               rv.unit_text, rv.observed_at, rv.patient_id, rv.state::text AS state,
               d.id AS document_id, d.doc_type::text AS doc_type, d.document_date,
               d.issuing_source, d.page_count,
               p.kind::text AS provenance_kind, p.bbox_x, p.bbox_y, p.bbox_w, p.bbox_h,
               p.char_start, eu.full_name AS entered_by_name,
               pg.storage_key AS page_key, pg.page_no, pg.width_px, pg.height_px,
               er.reader_name, er.reader_version
        FROM proj.renderable_value rv
        JOIN core.analyte a ON a.code = rv.analyte_code
        JOIN core.document d ON d.id = rv.document_id
        JOIN core.provenance p ON p.id = rv.provenance_id
        LEFT JOIN core.document_page pg ON pg.id = p.page_id
        LEFT JOIN core.clinic_user eu ON eu.id = p.entered_by_id
        LEFT JOIN core.extraction_run er ON er.id = rv.extraction_run_id
        WHERE rv.id = %s
        """,
        (value_id,),
    ).fetchone()


def correction_into(conn: Connection[DictRow], value_id: UUID) -> dict[str, Any] | None:
    """The correction that produced this value, if a person typed it."""
    return conn.execute(
        """
        SELECT c.corrected_at AS at, u.full_name AS actor_name,
               o.value_text AS original_value_text, o.unit_text AS original_unit_text
        FROM core.value_correction c
        JOIN core.clinic_user u ON u.id = c.actor_id
        JOIN core.extracted_value o ON o.id = c.original_value_id
        WHERE c.replacement_value_id = %s
        """,
        (value_id,),
    ).fetchone()


def confirmation_of(conn: Connection[DictRow], value_id: UUID) -> dict[str, Any] | None:
    """The audit event of a person confirming this value as read, if any."""
    return conn.execute(
        """
        SELECT e.occurred_at AS at, u.full_name AS actor_name
        FROM audit.event e LEFT JOIN core.clinic_user u ON u.id = e.actor_id
        WHERE e.entity_table = 'core.extracted_value' AND e.entity_id = %s
          AND e.action = 'value.confirm'
        ORDER BY e.id DESC LIMIT 1
        """,
        (value_id,),
    ).fetchone()
