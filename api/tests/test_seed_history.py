from collections import Counter
from typing import Any

import psycopg

from dev_seed.history import seed_history
from healthathon.audit_chain import verify
from tests.helpers import verify_audit_chain


def _history(db: psycopg.Connection[Any]) -> list[dict[str, Any]]:
    clinician = db.execute("SELECT id FROM core.clinic_user").fetchone()["id"]
    with db.transaction():
        seed_history(db, clinician)
    return verify_audit_chain(db)


def test_the_history_is_one_intact_chain_in_time_order(db: psycopg.Connection[Any]) -> None:
    rows = _history(db)
    assert len(rows) > 100
    times = [r["occurred_at"] for r in rows]
    assert times == sorted(times)
    latest = db.execute("SELECT max(occurred_at) <= now() AS past FROM audit.event").fetchone()
    assert latest["past"]
    assert verify(db) == {"checked": len(rows), "intact": True, "first_broken_id": None}


def test_every_seeded_decision_and_entry_has_its_event(db: psycopg.Connection[Any]) -> None:
    rows = _history(db)
    actions = Counter(r["action"] for r in rows)
    confirmed = db.execute(
        "SELECT count(*) AS n FROM core.regimen_item WHERE confirmed_at IS NOT NULL"
    ).fetchone()["n"]
    activated = db.execute(
        "SELECT count(*) AS n FROM core.regimen WHERE activated_at IS NOT NULL"
    ).fetchone()["n"]
    app_ticks = db.execute(
        "SELECT count(*) AS n FROM pat.entry"
        " WHERE kind = 'medication_tick' AND channel = 'patient_app'"
    ).fetchone()["n"]
    meals = db.execute("SELECT count(*) AS n FROM pat.entry WHERE kind = 'meal_photo'").fetchone()
    assert actions["regimen_item.confirm"] == confirmed > 0
    assert actions["regimen.activate"] == activated > 0
    assert actions["tick.record"] == app_ticks > 0
    assert actions["meal.record"] == meals["n"] > 0
    for action in ("reading.record", "answer.record", "survey.submit", "sms.receive",
                   "paper_form.enter", "visit.read", "record.read"):  # fmt: skip
        assert actions[action] > 0, action


def test_a_line_is_confirmed_before_its_checklist_is_activated(
    db: psycopg.Connection[Any],
) -> None:
    rows = _history(db)
    for r in rows:
        if r["action"] != "regimen.activate":
            continue
        lines = [
            x for x in rows
            if x["action"] == "regimen_item.confirm"
            and db.execute("SELECT regimen_id FROM core.regimen_item WHERE id = %s",
                           (x["entity_id"],)).fetchone()["regimen_id"] == r["entity_id"]
        ]  # fmt: skip
        assert lines and all(x["id"] < r["id"] for x in lines)
        assert all(x["actor_id"] == r["actor_id"] for x in lines)
        assert all(x["new_value"]["decision_latency_ms"] > 0 for x in lines)


def test_the_audit_log_lists_the_history_by_kind(db: psycopg.Connection[Any], client: Any) -> None:
    _history(db)
    decisions = client.get("/api/audit-log", params={"kind": "decision", "limit": 200}).json()
    assert decisions["entries"]
    assert all(e["actor_name"] == "Dr. Demo Clinician" for e in decisions["entries"])
    assert all(e["patient"] is not None for e in decisions["entries"])
    patient = client.get("/api/audit-log", params={"kind": "patient", "limit": 200}).json()
    assert patient["entries"] and all(e["patient"] for e in patient["entries"])
    assert patient["chain"]["intact"]


def test_tests_seed_without_history(db: psycopg.Connection[Any]) -> None:
    assert db.execute("SELECT count(*) AS n FROM audit.event").fetchone()["n"] == 0
