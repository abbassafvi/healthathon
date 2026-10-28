from datetime import datetime
from typing import Any
from uuid import UUID

from psycopg import Connection
from psycopg.rows import DictRow


def patients(conn: Connection[DictRow]) -> list[dict[str, Any]]:
    return conn.execute(
        "SELECT id, registration_no, full_name, preferred_language FROM core.patient"
        " WHERE exited_at IS NULL ORDER BY registration_no"
    ).fetchall()


def patient(conn: Connection[DictRow], patient_id: UUID) -> dict[str, Any] | None:
    return conn.execute(
        "SELECT id, registration_no, full_name, preferred_language FROM core.patient"
        " WHERE id = %s AND exited_at IS NULL",
        (patient_id,),
    ).fetchone()


def active_items(conn: Connection[DictRow], patient_id: UUID) -> list[dict[str, Any]]:
    """The items of the regimen in force now, in the order they are written on the page."""
    return conn.execute(
        """
        SELECT ri.id, ri.drug_text, ri.dose_text, ri.schedule_text
        FROM core.regimen r
        JOIN core.regimen_item ri ON ri.regimen_id = r.id
        JOIN core.provenance p ON p.id = ri.provenance_id
        WHERE r.patient_id = %s AND r.activated_at IS NOT NULL AND r.activated_at <= now()
          AND (r.superseded_at IS NULL OR r.superseded_at > now())
        ORDER BY r.activated_at DESC, p.bbox_y NULLS LAST, ri.id
        """,
        (patient_id,),
    ).fetchall()


def checklist_items(conn: Connection[DictRow], patient_id: UUID) -> list[dict[str, Any]]:
    """
    Every item of every checklist the patient has had, with when its
    checklist came into force and ended, in the order written on the page.
    """
    return conn.execute(
        """
        SELECT ri.id, ri.drug_text, ri.dose_text, ri.schedule_text,
               r.activated_at, r.superseded_at
        FROM core.regimen r
        JOIN core.regimen_item ri ON ri.regimen_id = r.id
        JOIN core.provenance p ON p.id = ri.provenance_id
        WHERE r.patient_id = %s AND r.activated_at IS NOT NULL
        ORDER BY r.activated_at DESC, p.bbox_y NULLS LAST, ri.id
        """,
        (patient_id,),
    ).fetchall()


def question_set(conn: Connection[DictRow], patient_id: UUID) -> dict[str, Any] | None:
    """The patient's current survey: the latest set the clinician chose, still in force."""
    return conn.execute(
        """
        SELECT id FROM pat.patient_question_set
        WHERE patient_id = %s AND (active_until IS NULL OR active_until > now())
        ORDER BY chosen_at DESC LIMIT 1
        """,
        (patient_id,),
    ).fetchone()


def set_questions(conn: Connection[DictRow], set_id: UUID) -> list[dict[str, Any]]:
    return conn.execute(
        """
        SELECT qb.id, qb.question_key,
               (SELECT jsonb_object_agg(qt.language, qt.text) FROM pat.question_text qt
                 WHERE qt.question_id = qb.id) AS texts
        FROM pat.patient_question_set_item si
        JOIN pat.question_bank_item qb ON qb.id = si.question_id
        WHERE si.set_id = %s
        ORDER BY qb.display_order, qb.question_key
        """,
        (set_id,),
    ).fetchall()


def answered_in_set(conn: Connection[DictRow], set_id: UUID, since: datetime) -> int:
    """How many of the set's questions have an answer since a moment. Not a score."""
    row = conn.execute(
        """
        SELECT count(DISTINCT sa.question_id) AS n
        FROM pat.survey_answer sa JOIN pat.entry e ON e.id = sa.entry_id
        WHERE sa.set_id = %s AND e.occurred_at >= %s
        """,
        (set_id, since),
    ).fetchone()
    return int(row["n"]) if row else 0


def set_tick(conn: Connection[DictRow], entry_id: UUID, ticked: bool) -> None:
    conn.execute(
        "UPDATE pat.medication_tick SET ticked = %s WHERE entry_id = %s", (ticked, entry_id)
    )


def delete_entry(conn: Connection[DictRow], entry_id: UUID) -> None:
    conn.execute("DELETE FROM pat.entry WHERE id = %s", (entry_id,))


def reading(conn: Connection[DictRow], entry_id: UUID) -> dict[str, Any] | None:
    return conn.execute(
        """
        SELECT e.id, e.occurred_at, g.value_text, g.context::text AS context
        FROM pat.entry e JOIN pat.glucose_reading g ON g.entry_id = e.id WHERE e.id = %s
        """,
        (entry_id,),
    ).fetchone()


def meal(conn: Connection[DictRow], entry_id: UUID) -> dict[str, Any] | None:
    return conn.execute(
        """
        SELECT e.id, e.occurred_at, m.storage_key
        FROM pat.entry e JOIN pat.meal_photo m ON m.entry_id = e.id WHERE e.id = %s
        """,
        (entry_id,),
    ).fetchone()


def insert_meal(
    conn: Connection[DictRow], entry_id: UUID, storage_key: str, taken_at: datetime
) -> None:
    conn.execute(
        "INSERT INTO pat.meal_photo (entry_id, storage_key, taken_at) VALUES (%s, %s, %s)",
        (entry_id, storage_key, taken_at),
    )
