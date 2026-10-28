from datetime import UTC, date, datetime, timedelta
from typing import Any
from uuid import uuid4

import psycopg

from healthathon import clinic_time
from healthathon.entries.models import RegimenItemRef
from healthathon.visit.compliance import compute
from tests.helpers import BANNED_KEYS, decide, patient_id, queue_item_for, verify_audit_chain

TODAY = clinic_time.today()


def _visit(client: Any, pid: str) -> Any:
    res = client.get(f"/api/patients/{pid}/visit")
    assert res.status_code == 200, res.text
    return res.json()


def _cells(score: Any) -> list[dict[str, Any]]:
    return [c for r in score["rows"] for c in r["days"]]


def test_the_period_runs_from_the_day_after_the_last_visit_to_today(
    client: Any, db: psycopg.Connection[Any]
) -> None:
    body = _visit(client, patient_id(db, "DEV-0001"))
    last = TODAY - timedelta(days=29)
    assert body["period"] == {
        "from": (last + timedelta(days=1)).isoformat(),
        "to": TODAY.isoformat(),
        "previous_visit": last.isoformat(),
    }
    assert body["visit"]["scheduled_for"].startswith(f"{TODAY.isoformat()}T10:00:00")
    assert body["visit"]["clinician_name"] == "Dr. Demo Clinician"


def test_the_score_is_ticks_over_cells_from_activation_and_recounts(
    client: Any, db: psycopg.Connection[Any]
) -> None:
    score = _visit(client, patient_id(db, "DEV-0001"))["compliance"]
    activated = TODAY - timedelta(days=19)
    assert score["period_from"] == activated.isoformat()
    assert score["period_to"] == TODAY.isoformat()
    assert [r["item"]["drug_text"] for r in score["rows"]] == [
        "Tab. Metformin",
        "Tab. Glimepiride",
        "Tab. Atorvastatin",
    ]
    cells = _cells(score)
    assert all(len(r["days"]) == 20 for r in score["rows"])
    ticked = sum(1 for c in cells if c["state"] == "ticked")
    assert (score["ticked_count"], score["expected_count"]) == (ticked, len(cells))
    assert score["score_percent"] == round(ticked * 100 / len(cells))
    states = {c["state"] for c in cells}
    assert states == {"ticked", "not_ticked", "no_entry"}
    assert all((c["entry_id"] is None) == (c["state"] == "no_entry") for c in cells)


def test_every_cell_traces_to_its_tick_or_is_a_gap(
    client: Any, db: psycopg.Connection[Any]
) -> None:
    pid = patient_id(db, "DEV-0001")
    body = _visit(client, pid)
    period = body["period"]
    entries = client.get(
        f"/api/patients/{pid}/entries?from={period['from']}&to={period['to']}"
    ).json()["entries"]
    ticks = {e["id"]: e for e in entries if e["kind"] == "medication_tick"}
    for row in body["compliance"]["rows"]:
        for cell in row["days"]:
            if cell["entry_id"] is None:
                continue
            tick = ticks[cell["entry_id"]]
            assert tick["regimen_item"]["id"] == row["item"]["id"]
            assert tick["tick_date"] == cell["date"]
            assert tick["ticked"] == (cell["state"] == "ticked")


def test_a_tick_in_the_app_today_shows_on_the_visit_page(
    client: Any, db: psycopg.Connection[Any]
) -> None:
    pid = patient_id(db, "DEV-0001")
    before = _visit(client, pid)["compliance"]
    item = before["rows"][0]["item"]["id"]
    res = client.put(
        f"/api/app/patients/{pid}/ticks/{item}",
        json={"ticked": True, "capture_id": "cap-visit-0001"},
    )
    assert res.status_code == 204
    after = _visit(client, pid)["compliance"]
    assert after["rows"][0]["days"][-1]["state"] == "ticked"
    assert after["ticked_count"] == before["ticked_count"] + 1
    assert after["expected_count"] == before["expected_count"]


def test_no_checklist_means_no_score(client: Any, db: psycopg.Connection[Any]) -> None:
    for reg in ("DEV-0002", "DEV-0004"):
        assert _visit(client, patient_id(db, reg))["compliance"] is None


def test_orders_match_only_a_report_that_can_be_shown(
    client: Any, db: psycopg.Connection[Any]
) -> None:
    orders = _visit(client, patient_id(db, "DEV-0001"))["orders"]
    rx_day = (TODAY - timedelta(days=19)).isoformat()
    assert [(o["analyte_name"], o["ordered_on"]) for o in orders] == [
        ("HbA1c", rx_day),
        ("Urine albumin/creatinine ratio", rx_day),
    ]
    assert orders[0]["matched_value_id"] is not None
    assert orders[1]["matched_value_id"] is None
    # Creatinine for DEV-0003 is still in the confirm queue: not a match yet.
    pid = patient_id(db, "DEV-0003")
    [order] = _visit(client, pid)["orders"]
    assert order["matched_value_id"] is None
    decide(client, queue_item_for(client, "DEV-0003", "creatinine")["id"], action="confirm")
    [order] = _visit(client, pid)["orders"]
    assert order["matched_value_id"] is not None
    trace = client.get(f"/api/values/{order['matched_value_id']}/trace")
    assert trace.status_code == 200


def test_the_visit_page_carries_no_judgement_fields(
    client: Any, db: psycopg.Connection[Any]
) -> None:
    body = _visit(client, patient_id(db, "DEV-0001"))
    keys = set(body) | set(body["period"]) | {k for o in body["orders"] for k in o}
    keys |= {k for c in _cells(body["compliance"]) for k in c}
    # The one approved score is named "compliance" and is clinician-facing only.
    assert not [k for k in keys if any(b in k for b in BANNED_KEYS)]
    assert (
        not client.get(f"/api/app/patients/{patient_id(db, 'DEV-0001')}/today")
        .json()
        .get("compliance")
    )


def test_reading_the_visit_page_is_audited(client: Any, db: psycopg.Connection[Any]) -> None:
    pid = patient_id(db, "DEV-0004")
    _visit(client, pid)
    assert [(r["action"], str(r["entity_id"])) for r in verify_audit_chain(db)] == [
        ("visit.read", pid)
    ]


def test_unknown_patient_is_404(client: Any) -> None:
    assert client.get("/api/patients/00000000-0000-0000-0000-000000000000/visit").status_code == 404


def _item(name: str) -> RegimenItemRef:
    return RegimenItemRef(id=uuid4(), drug_text=name, dose_text="1 mg", schedule_text=None)


def test_compute_counts_cells_and_rounds_half_up() -> None:
    a, b = _item("A"), _item("B")
    d0 = date(2026, 10, 1)
    days = [d0 + timedelta(days=n) for n in range(4)]
    ticks = {
        (a.id, days[0]): (True, uuid4()),
        (a.id, days[1]): (False, uuid4()),
        (b.id, days[0]): (True, uuid4()),
        (b.id, days[3]): (True, uuid4()),
        (b.id, days[2]): (True, uuid4()),
    }
    s = compute(uuid4(), [a, b], d0, days[-1], ticks, datetime.now(UTC))
    assert (s.ticked_count, s.expected_count) == (4, 8)
    assert s.score_percent == 50
    assert [c.state for c in s.rows[0].days] == ["ticked", "not_ticked", "no_entry", "no_entry"]
    # 1 of 8 is 12.5%, which rounds half up to 13, as the page's recount does.
    one = compute(uuid4(), [a, b], d0, days[-1], {(a.id, d0): (True, uuid4())}, datetime.now(UTC))
    assert one.score_percent == 13
    # 2 of 3 is 66.67%: 67.
    two = compute(uuid4(), [a], d0, days[2], dict(list(ticks.items())[:1]) | {
        (a.id, days[2]): (True, uuid4())}, datetime.now(UTC))  # fmt: skip
    assert two.score_percent == 67


def test_compute_ignores_ticks_outside_its_items_and_days() -> None:
    a = _item("A")
    d0 = date(2026, 10, 1)
    stray = {(uuid4(), d0): (True, uuid4()), (a.id, d0 - timedelta(days=1)): (True, uuid4())}
    s = compute(uuid4(), [a], d0, d0, stray, datetime.now(UTC))
    assert (s.ticked_count, s.expected_count, s.score_percent) == (0, 1, 0)
