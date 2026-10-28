from datetime import datetime
from typing import Any

import psycopg

from healthathon import clinic_time
from tests.helpers import BANNED_KEYS


def _list(client: Any) -> dict[str, dict[str, Any]]:
    res = client.get("/api/patients")
    assert res.status_code == 200, res.text
    return {p["registration_no"]: p for p in res.json()}


def test_each_patient_carries_what_their_record_holds_now(
    client: Any, db: psycopg.Connection[Any]
) -> None:
    asha = _list(client)["DEV-0001"]
    assert asha["caregiver"] == {"full_name": "Priya Verma", "relationship": "daughter"}
    assert asha["checklist_medicines"] == 3 and asha["checklist_since"]
    assert (
        asha["waiting_values"]
        == db.execute(
            "SELECT count(*) AS n FROM core.confirm_queue_item q"
            " JOIN core.extracted_value v ON v.id = q.extracted_value_id"
            " JOIN core.patient p ON p.id = v.patient_id"
            " WHERE p.registration_no = 'DEV-0001' AND q.resolved_at IS NULL"
        ).fetchone()["n"]
    )
    assert asha["waiting_lines"] > 0
    assert asha["documents"] == 3
    last_entry = datetime.fromisoformat(asha["last_entry_at"])
    assert last_entry.date() < clinic_time.today()


def test_visits_are_the_last_one_held_and_the_next_one_booked(client: Any) -> None:
    for p in _list(client).values():
        last, upcoming = p["last_visit"], p["next_visit"]
        assert last and upcoming
        assert datetime.fromisoformat(last) < datetime.fromisoformat(upcoming)
        assert datetime.fromisoformat(upcoming).date() >= clinic_time.today()


def test_a_patient_with_no_checklist_or_caregiver_says_so_with_nulls(client: Any) -> None:
    imran = _list(client)["DEV-0002"]
    assert imran["caregiver"] is None
    assert imran["checklist_since"] is None and imran["checklist_medicines"] == 0


def test_settling_a_value_takes_it_off_the_patient_s_waiting_count(client: Any) -> None:
    before = _list(client)["DEV-0001"]["waiting_values"]
    item = next(
        i for i in client.get("/api/confirm-queue").json()["items"]
        if i["patient"]["registration_no"] == "DEV-0001"
    )  # fmt: skip
    client.post(f"/api/confirm-queue/{item['id']}/decision",
                json={"action": "confirm", "decision_latency_ms": 900})  # fmt: skip
    assert _list(client)["DEV-0001"]["waiting_values"] == before - 1


def test_the_list_judges_no_one(client: Any) -> None:
    keys = {k for p in _list(client).values() for k in p}
    assert not [k for k in keys if any(b in k for b in BANNED_KEYS)]


def test_the_sms_phone_is_named_only_while_the_patient_agrees(
    client: Any, db: psycopg.Connection[Any]
) -> None:
    patients = _list(client)
    assert patients["DEV-0001"]["sms_phone_last4"] == "0001"
    assert patients["DEV-0004"]["sms_phone_last4"] is None
    db.execute(
        "UPDATE core.consent SET withdrawn_at = now() WHERE item = 'sms' AND patient_id ="
        " (SELECT id FROM core.patient WHERE registration_no = 'DEV-0001')"
    )
    assert _list(client)["DEV-0001"]["sms_phone_last4"] is None
