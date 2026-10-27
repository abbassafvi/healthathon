from datetime import date, datetime
from typing import Any
from uuid import UUID

from psycopg import Connection
from psycopg.rows import DictRow


def visits_between(
    conn: Connection[DictRow], start: datetime, end: datetime
) -> list[dict[str, Any]]:
    """Visits booked in a range, in time order and by nothing else."""
    return conn.execute(
        """
        SELECT v.id, v.patient_id, v.scheduled_for, v.started_at, u.full_name AS clinician_name,
               p.registration_no, p.full_name, p.year_of_birth, p.sex::text AS sex
        FROM proj.visit v
        JOIN core.patient p ON p.id = v.patient_id
        LEFT JOIN core.clinic_user u ON u.id = v.clinician_id
        WHERE v.scheduled_for >= %s AND v.scheduled_for < %s AND p.exited_at IS NULL
        ORDER BY v.scheduled_for, p.registration_no
        """,
        (start, end),
    ).fetchall()


def document_counts(
    conn: Connection[DictRow], patient_id: UUID, first: date, last: date
) -> dict[str, int]:
    """Documents dated in the period, by type, as the visit page counts them."""
    rows = conn.execute(
        """
        SELECT doc_type::text AS doc_type, count(*) AS n FROM core.document
        WHERE patient_id = %s AND document_date BETWEEN %s AND %s
        GROUP BY doc_type
        """,
        (patient_id, first, last),
    ).fetchall()
    return {r["doc_type"]: r["n"] for r in rows}


def open_queue_items(conn: Connection[DictRow], patient_id: UUID) -> int:
    row = conn.execute(
        """
        SELECT count(*) AS n FROM core.confirm_queue_item q
        JOIN core.extracted_value v ON v.id = q.extracted_value_id
        WHERE v.patient_id = %s AND q.resolved_at IS NULL
        """,
        (patient_id,),
    ).fetchone()
    return int(row["n"]) if row else 0
