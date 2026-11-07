from datetime import date, datetime
from typing import Any
from uuid import UUID

from psycopg import Connection
from psycopg.rows import DictRow

# The question asked every day. The schema has no column that says whether a
# bank question is the daily one or part of the weekly survey (HANDOFF.md,
# schema question 7), so the daily one is named here. A survey answer carries
# the patient's question set; a daily answer does not.
DAILY_QUESTION_KEYS = ("felt_unwell_today",)

_ENTRY_SELECT = """
SELECT e.id, e.kind::text AS kind, e.channel::text AS channel,
       e.entered_by::text AS entered_by, e.language, e.occurred_at, e.recorded_at,
       c.full_name AS caregiver_name, c.relationship AS caregiver_relationship,
       g.value_text, g.context::text AS context, g.insulin_units,
       t.tick_date, t.ticked, ri.id AS item_id, ri.drug_text, ri.dose_text, ri.schedule_text,
       sa.answer_text, sa.audio_key, rt.transcript_text, sa.set_id, qb.question_key,
       qen.text AS question_text, COALESCE(qshown.text, qen.text) AS question_text_shown,
       m.storage_key, m.meal::text AS meal, m.calories_text
FROM pat.entry e
LEFT JOIN core.caregiver c ON c.id = e.caregiver_id
LEFT JOIN pat.glucose_reading g ON g.entry_id = e.id
LEFT JOIN pat.medication_tick t ON t.entry_id = e.id
LEFT JOIN core.regimen_item ri ON ri.id = t.regimen_item_id
LEFT JOIN pat.survey_answer sa ON sa.entry_id = e.id
LEFT JOIN pat.recording_transcript rt ON rt.audio_key = sa.audio_key
LEFT JOIN pat.question_bank_item qb ON qb.id = sa.question_id
LEFT JOIN pat.question_text qen ON qen.question_id = qb.id AND qen.language = 'en'
LEFT JOIN pat.question_text qshown ON qshown.question_id = qb.id AND qshown.language = e.language
LEFT JOIN pat.meal_photo m ON m.entry_id = e.id
"""


def entries_between(
    conn: Connection[DictRow],
    patient_id: UUID,
    first: date,
    last: date,
    start: datetime,
    end: datetime,
) -> list[dict[str, Any]]:
    """
    A patient's entries in a range, in time order. A tick belongs to the day
    it is for, even if it was recorded later; everything else to the moment
    it happened.
    """
    return conn.execute(
        _ENTRY_SELECT
        + """
        WHERE e.patient_id = %(pid)s
          AND e.kind IN ('glucose_reading', 'medication_tick', 'survey_answer', 'meal_photo')
          AND CASE WHEN t.entry_id IS NOT NULL THEN t.tick_date BETWEEN %(first)s AND %(last)s
                   ELSE e.occurred_at >= %(start)s AND e.occurred_at < %(end)s END
        ORDER BY e.occurred_at, e.id
        """,
        {"pid": patient_id, "first": first, "last": last, "start": start, "end": end},
    ).fetchall()


def regimen_items_between(
    conn: Connection[DictRow], patient_id: UUID, start: datetime, end: datetime
) -> list[dict[str, Any]]:
    """Items of every activated regimen that was in force at some point in [start, end)."""
    return conn.execute(
        """
        SELECT ri.id, ri.drug_text, ri.dose_text, ri.schedule_text,
               r.activated_at, r.superseded_at
        FROM core.regimen r
        JOIN core.regimen_item ri ON ri.regimen_id = r.id
        JOIN core.provenance p ON p.id = ri.provenance_id
        WHERE r.patient_id = %s AND r.activated_at IS NOT NULL
          AND r.activated_at < %s AND (r.superseded_at IS NULL OR r.superseded_at >= %s)
        ORDER BY r.activated_at, p.bbox_y NULLS LAST, ri.id
        """,
        (patient_id, end, start),
    ).fetchall()


def regimen_item(
    conn: Connection[DictRow], patient_id: UUID, item_id: UUID
) -> dict[str, Any] | None:
    """An item of one of this patient's activated regimens, with when it was in force."""
    return conn.execute(
        """
        SELECT ri.id, ri.drug_text, ri.dose_text, ri.schedule_text,
               r.activated_at, r.superseded_at
        FROM core.regimen_item ri JOIN core.regimen r ON r.id = ri.regimen_id
        WHERE ri.id = %s AND r.patient_id = %s AND r.activated_at IS NOT NULL
        """,
        (item_id, patient_id),
    ).fetchone()


def questions(conn: Connection[DictRow], keys: tuple[str, ...]) -> list[dict[str, Any]]:
    """The current version of each named question, with its text in every language."""
    return conn.execute(
        """
        SELECT DISTINCT ON (qb.question_key) qb.id, qb.question_key, qb.display_order,
               (SELECT jsonb_object_agg(qt.language, qt.text) FROM pat.question_text qt
                 WHERE qt.question_id = qb.id) AS texts
        FROM pat.question_bank_item qb
        WHERE qb.question_key = ANY(%s)
        ORDER BY qb.question_key, qb.version DESC
        """,
        (list(keys),),
    ).fetchall()


def tick_for(
    conn: Connection[DictRow], patient_id: UUID, item_id: UUID, day: date
) -> dict[str, Any] | None:
    """The tick recorded for one item on one day, if any, locked for update."""
    return conn.execute(
        """
        SELECT e.id, e.channel::text AS channel, t.ticked
        FROM pat.medication_tick t JOIN pat.entry e ON e.id = t.entry_id
        WHERE e.patient_id = %s AND t.regimen_item_id = %s AND t.tick_date = %s
        FOR UPDATE OF e, t
        """,
        (patient_id, item_id, day),
    ).fetchone()


def insert_entry(
    conn: Connection[DictRow],
    patient_id: UUID,
    kind: str,
    channel: str,
    entered_by: str,
    language: str,
    capture_id: str,
    occurred_at: datetime,
) -> UUID | None:
    """One pat.entry row. None when the capture id was already used: a retry."""
    row = conn.execute(
        """
        INSERT INTO pat.entry (patient_id, kind, channel, entered_by, language,
            client_capture_id, occurred_at)
        VALUES (%s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (client_capture_id) DO NOTHING
        RETURNING id
        """,
        (patient_id, kind, channel, entered_by, language, capture_id, occurred_at),
    ).fetchone()
    return row["id"] if row else None


def insert_tick(
    conn: Connection[DictRow], entry_id: UUID, item_id: UUID, day: date, ticked: bool
) -> None:
    conn.execute(
        "INSERT INTO pat.medication_tick (entry_id, regimen_item_id, tick_date, ticked)"
        " VALUES (%s, %s, %s, %s)",
        (entry_id, item_id, day, ticked),
    )


def insert_glucose(
    conn: Connection[DictRow],
    entry_id: UUID,
    value_text: str,
    context: str,
    insulin_units: float | None,
) -> None:
    conn.execute(
        "INSERT INTO pat.glucose_reading (entry_id, value_text, context, insulin_units)"
        " VALUES (%s, %s, %s, %s)",
        (entry_id, value_text, context, insulin_units),
    )


def insert_answer(
    conn: Connection[DictRow],
    entry_id: UUID,
    question_id: UUID,
    answer_text: str | None,
    set_id: UUID | None,
    audio_key: str | None = None,
) -> None:
    conn.execute(
        "INSERT INTO pat.survey_answer (entry_id, question_id, answer_text, set_id, audio_key)"
        " VALUES (%s, %s, %s, %s, %s)",
        (entry_id, question_id, answer_text, set_id, audio_key),
    )


def entry_by_capture_id(conn: Connection[DictRow], capture_id: str) -> dict[str, Any] | None:
    return conn.execute(
        "SELECT id, patient_id, kind::text AS kind FROM pat.entry WHERE client_capture_id = %s",
        (capture_id,),
    ).fetchone()


def lock_capture_id(conn: Connection[DictRow], capture_id: str) -> None:
    """Serialise two submissions of the same form until the first commits."""
    conn.execute("SELECT pg_advisory_xact_lock(hashtext(%s))", (capture_id,))


def count_with_capture_prefix(conn: Connection[DictRow], capture_id: str) -> int:
    row = conn.execute(
        "SELECT count(*) AS n FROM pat.entry WHERE client_capture_id LIKE %s",
        (capture_id + ":%",),
    ).fetchone()
    return int(row["n"]) if row else 0
