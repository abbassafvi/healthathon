from datetime import date, datetime
from typing import Any
from uuid import UUID

from psycopg import Connection
from psycopg.rows import DictRow


def next_visit(
    conn: Connection[DictRow], patient_id: UUID, since: datetime
) -> dict[str, Any] | None:
    """The visit this page is for: the first one scheduled from today on."""
    return conn.execute(
        """
        SELECT v.scheduled_for, u.full_name AS clinician_name
        FROM proj.visit v LEFT JOIN core.clinic_user u ON u.id = v.clinician_id
        WHERE v.patient_id = %s AND v.scheduled_for >= %s
        ORDER BY v.scheduled_for LIMIT 1
        """,
        (patient_id, since),
    ).fetchone()


def previous_visit(conn: Connection[DictRow], patient_id: UUID, before: datetime) -> Any:
    """When the last visit that took place started, or None."""
    row = conn.execute(
        """
        SELECT started_at FROM proj.visit
        WHERE patient_id = %s AND started_at IS NOT NULL AND started_at < %s
        ORDER BY started_at DESC LIMIT 1
        """,
        (patient_id, before),
    ).fetchone()
    return row["started_at"] if row else None


def open_orders(conn: Connection[DictRow], patient_id: UUID) -> list[dict[str, Any]]:
    """
    Tests ordered and not closed. A match counts only once the value can be
    shown: a value still in the confirm queue is not a matching report yet.
    """
    return conn.execute(
        """
        SELECT o.id, a.display_name AS analyte_name, o.ordered_on, rv.id AS matched_value_id
        FROM core.test_order o
        JOIN core.analyte a ON a.code = o.analyte_code
        LEFT JOIN proj.renderable_value rv ON rv.id = o.matched_value_id
        WHERE o.patient_id = %s AND o.closed_by IS NULL
        ORDER BY o.ordered_on, a.display_name
        """,
        (patient_id,),
    ).fetchall()


def ticks(
    conn: Connection[DictRow], patient_id: UUID, item_ids: list[UUID], first: date, last: date
) -> list[dict[str, Any]]:
    """Every tick for these items in the range, oldest first, so a later one wins."""
    return conn.execute(
        """
        SELECT e.id, t.regimen_item_id, t.tick_date, t.ticked
        FROM pat.medication_tick t JOIN pat.entry e ON e.id = t.entry_id
        WHERE e.patient_id = %s AND t.regimen_item_id = ANY(%s)
          AND t.tick_date BETWEEN %s AND %s
        ORDER BY e.occurred_at, e.id
        """,
        (patient_id, item_ids, first, last),
    ).fetchall()
