from typing import Any

from psycopg import Connection
from psycopg.rows import DictRow

# Which actions belong to which kind. An action not listed is shown under all.
KINDS: dict[str, tuple[str, ...]] = {
    "decision": (
        "value.confirm", "value.correct", "value.discard", "regimen.activate",
        "regimen_item.confirm", "regimen_item.correct", "regimen_item.remove", "paper_form.enter",
    ),
    "read": (
        "record.read", "entries.read", "visit.read", "value.trace", "clinic_day.read",
        "document.reading_read", "audit.read",
    ),
    "patient": (
        "tick.record", "tick.change", "tick.clear", "reading.record", "answer.record",
        "survey.submit", "meal.record", "sms.receive", "sms.refuse", "patient.sign_in",
    ),
}  # fmt: skip


def entries(
    conn: Connection[DictRow], actions: tuple[str, ...] | None, before: int | None, limit: int
) -> list[dict[str, Any]]:
    """
    Newest first. The patient is found through whatever the event points at;
    a line removed from a prescription no longer leads anywhere.
    """
    return conn.execute(
        """
        SELECT e.id, e.occurred_at, e.action, e.actor_role::text AS actor_role, e.reason_code,
               (e.new_value ->> 'decision_latency_ms')::int AS decision_latency_ms,
               u.full_name AS actor_name,
               p.id AS patient_id, p.registration_no, p.full_name AS patient_name
        FROM audit.event e
        LEFT JOIN core.clinic_user u ON u.id = e.actor_id
        LEFT JOIN core.extracted_value ev
               ON e.entity_table = 'core.extracted_value' AND ev.id = e.entity_id
        LEFT JOIN pat.entry pe ON e.entity_table = 'pat.entry' AND pe.id = e.entity_id
        LEFT JOIN core.document d ON e.entity_table = 'core.document' AND d.id = e.entity_id
        LEFT JOIN core.regimen r ON e.entity_table = 'core.regimen' AND r.id = e.entity_id
        LEFT JOIN core.regimen_item ri
               ON e.entity_table = 'core.regimen_item' AND ri.id = e.entity_id
        LEFT JOIN core.regimen rr ON rr.id = ri.regimen_id
        LEFT JOIN core.message_log m ON e.entity_table = 'core.message_log' AND m.id = e.entity_id
        LEFT JOIN pat.patient_question_set qs
               ON e.entity_table = 'pat.patient_question_set' AND qs.id = e.entity_id
        LEFT JOIN core.patient p ON p.id = COALESCE(
            CASE WHEN e.entity_table = 'core.patient' THEN e.entity_id END,
            ev.patient_id, pe.patient_id, d.patient_id, r.patient_id, rr.patient_id,
            m.patient_id, qs.patient_id)
        WHERE (%(actions)s::text[] IS NULL OR e.action = ANY(%(actions)s))
          AND (%(before)s::bigint IS NULL OR e.id < %(before)s)
        ORDER BY e.id DESC
        LIMIT %(limit)s
        """,
        {"actions": list(actions) if actions else None, "before": before, "limit": limit},
    ).fetchall()
