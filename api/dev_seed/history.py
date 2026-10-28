"""
The audit history of what the stand-in seed wrote, so a demonstration's
audit log holds the decisions and patient entries the other pages show.
Each event is written through record_event at the time the thing it
records happened, oldest first, so the chain checks out end to end.

Tests seed without it: they start from an empty chain and count the
events their own requests write.
"""

from datetime import date, datetime, timedelta
from typing import Any
from uuid import UUID

import psycopg

from healthathon import clinic_time
from healthathon.audit import record_event
from healthathon.auth import CurrentUser

# Seconds a reviewer took over each prescription line, in turn.
LATENCIES_MS = [4200, 2900, 6100, 3500, 5200, 3800]

Event = tuple[datetime, CurrentUser | None, str, str, UUID | None, dict[str, Any] | None]


def seed_history(conn: psycopg.Connection[Any], clinician: UUID) -> int:
    """Write the history, oldest first. Returns how many events were written."""
    user_row = conn.execute(
        "SELECT id, full_name, role::text AS role FROM core.clinic_user WHERE id = %s",
        (clinician,),
    ).fetchone()
    user = CurrentUser(**user_row)
    events = [*_prescriptions(conn, user), *_visits(conn, user), *_entries(conn, user)]
    events.sort(key=lambda e: e[0])
    for at, actor, action, table, entity, new_value in events:
        record_event(conn, actor, action, table, entity, new_value=new_value, occurred_at=at)
    return len(events)


def _prescriptions(conn: psycopg.Connection[Any], user: CurrentUser) -> list[Event]:
    """Each line confirmed in turn, a few seconds apart, then the checklist activated."""
    events: list[Event] = []
    regimens = conn.execute(
        """
        SELECT r.id, r.patient_id, r.activated_at,
               (SELECT prev.id FROM core.regimen prev
                 WHERE prev.patient_id = r.patient_id AND prev.activated_at < r.activated_at
                 ORDER BY prev.activated_at DESC LIMIT 1) AS supersedes
        FROM core.regimen r WHERE r.activated_at IS NOT NULL
        ORDER BY r.activated_at
        """
    ).fetchall()
    for r in regimens:
        items = conn.execute(
            """
            SELECT ri.id FROM core.regimen_item ri
            LEFT JOIN core.provenance p ON p.id = ri.provenance_id
            WHERE ri.regimen_id = %s AND ri.confirmed_at IS NOT NULL
            ORDER BY p.bbox_y NULLS LAST, ri.id
            """,
            (r["id"],),
        ).fetchall()
        at = r["activated_at"] - timedelta(seconds=10)
        for k, item in reversed(list(enumerate(items))):
            latency = LATENCIES_MS[k % len(LATENCIES_MS)]
            events.append((at, user, "regimen_item.confirm", "core.regimen_item", item["id"],
                           {"decision_latency_ms": latency}))  # fmt: skip
            at -= timedelta(milliseconds=latency + 1500)
        events.append((r["activated_at"], user, "regimen.activate", "core.regimen", r["id"], {
            "items": len(items),
            "supersedes": str(r["supersedes"]) if r["supersedes"] else None,
        }))  # fmt: skip
    return events


def _visits(conn: psycopg.Connection[Any], user: CurrentUser) -> list[Event]:
    """At each past visit, the clinician opened the visit page and then the documents."""
    events: list[Event] = []
    for v in conn.execute(
        "SELECT patient_id, started_at FROM proj.visit WHERE started_at IS NOT NULL"
    ).fetchall():
        at = v["started_at"] + timedelta(minutes=1)
        events.append((at, user, "visit.read", "core.patient", v["patient_id"], None))
        events.append((at + timedelta(minutes=3), user, "record.read", "core.patient",
                       v["patient_id"], None))  # fmt: skip
    return events


def _entries(conn: psycopg.Connection[Any], user: CurrentUser) -> list[Event]:
    """
    What the app sends is one event per entry, and the weekly answers one
    event per set. Entries by SMS arrive a sitting at a time, and a paper
    form is entered by clinic staff a week at a time.
    """
    rows = conn.execute(
        """
        SELECT e.id, e.patient_id, e.kind::text AS kind, e.channel::text AS channel,
               e.occurred_at, e.recorded_at, t.ticked, g.value_text, g.context::text AS context,
               a.set_id
        FROM pat.entry e
        LEFT JOIN pat.medication_tick t ON t.entry_id = e.id
        LEFT JOIN pat.glucose_reading g ON g.entry_id = e.id
        LEFT JOIN pat.survey_answer a ON a.entry_id = e.id
        ORDER BY e.recorded_at, e.id
        """
    ).fetchall()
    events: list[Event] = []
    surveys: dict[tuple[UUID, date], list[dict[str, Any]]] = {}
    sittings: dict[tuple[UUID, date, int], list[dict[str, Any]]] = {}
    forms: dict[tuple[UUID, date], list[dict[str, Any]]] = {}
    for r in rows:
        local = clinic_time.local(r["recorded_at"])
        if r["channel"] == "sms":
            sittings.setdefault((r["patient_id"], local.date(), local.hour), []).append(r)
        elif r["channel"] == "paper_form":
            day = clinic_time.local(r["occurred_at"]).date()
            forms.setdefault((r["patient_id"], day - timedelta(days=day.weekday())), []).append(r)
        elif r["kind"] == "medication_tick":
            events.append((r["recorded_at"], None, "tick.record", "pat.entry", r["id"],
                           {"ticked": r["ticked"]}))  # fmt: skip
        elif r["kind"] == "glucose_reading":
            events.append((r["recorded_at"], None, "reading.record", "pat.entry", r["id"],
                           {"value_text": r["value_text"], "context": r["context"]}))  # fmt: skip
        elif r["kind"] == "survey_answer" and r["set_id"]:
            surveys.setdefault((r["set_id"], local.date()), []).append(r)
        elif r["kind"] == "survey_answer":
            events.append((r["recorded_at"], None, "answer.record", "pat.entry", r["id"], None))
        elif r["kind"] == "meal_photo":
            events.append((r["recorded_at"], None, "meal.record", "pat.entry", r["id"], None))

    for (set_id, _), answers in surveys.items():
        events.append((answers[-1]["recorded_at"], None, "survey.submit",
                       "pat.patient_question_set", set_id, {"answers": len(answers)}))  # fmt: skip
    for sitting in sittings.values():
        # The message log is not seeded, so the event leads to the first entry stored.
        events.append((sitting[-1]["recorded_at"], None, "sms.receive", "pat.entry",
                       sitting[0]["id"], {"stored": len(sitting), "refused": 0}))  # fmt: skip
    for n, ((patient, monday), entries) in enumerate(sorted(forms.items(), key=lambda f: f[0][1])):
        count = {k: sum(1 for e in entries if e["kind"] == k)
                 for k in ("medication_tick", "glucose_reading", "survey_answer")}  # fmt: skip
        events.append((max(e["recorded_at"] for e in entries), user, "paper_form.enter",
                       "core.patient", patient, {
            "client_capture_id": f"dev-seed-paper-{n}",
            "week_from": monday.isoformat(),
            "week_to": (monday + timedelta(days=6)).isoformat(),
            "ticks": count["medication_tick"],
            "readings": count["glucose_reading"],
            "answers": count["survey_answer"],
        }))  # fmt: skip
    return events
