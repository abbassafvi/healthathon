from typing import Any

import psycopg
import pytest

from healthathon import clinic_time, phones
from tests.helpers import BANNED_KEYS, patient_id, verify_audit_chain

ASHA = "+91 55500 00001"
KEY = {"X-Gateway-Key": "dev-only-gateway-key"}


def _sms(client: Any, body: str, sender: str = ASHA, message_id: str = "gw-0001", **h: str) -> Any:
    return client.post(
        "/api/sms/inbound",
        json={"message_id": message_id, "from": sender, "body": body},
        headers={**KEY, **h},
    )


def _today_entries(client: Any, pid: str) -> list[dict[str, Any]]:
    day = clinic_time.today().isoformat()
    page = client.get(f"/api/patients/{pid}/entries?from={day}&to={day}").json()
    return list(page["entries"])


def test_a_message_is_stored_as_the_patients_own_through_sms(
    client: Any, db: psycopg.Connection[Any]
) -> None:
    res = _sms(client, "G 142 F\nT 1 Y; T 3 N\nQ सुबह थोड़ा चक्कर आया")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["accepted"] is True and body["problems"] == []
    assert [s["kind"] for s in body["stored"]] == [
        "glucose_reading",
        "medication_tick",
        "medication_tick",
        "survey_answer",
    ]
    entries = _today_entries(client, patient_id(db, "DEV-0001"))
    assert {(e["channel"], e["entered_by"], e["language"]) for e in entries} == {
        ("sms", "patient", "hi")
    }
    reading = next(e for e in entries if e["kind"] == "glucose_reading")
    assert (reading["value_text"], reading["context"]) == ("142", "fasting")
    ticks = sorted(
        (e["regimen_item"]["drug_text"], e["ticked"])
        for e in entries
        if e["kind"] == "medication_tick"
    )
    assert ticks == [("Tab. Atorvastatin", False), ("Tab. Metformin", True)]
    answer = next(e for e in entries if e["kind"] == "survey_answer")
    assert (answer["answer_text"], answer["set"]) == ("सुबह थोड़ा चक्कर आया", "daily")


def test_medicine_numbers_are_the_checklist_s_order_as_the_sms_card_prints_them(
    client: Any, db: psycopg.Connection[Any]
) -> None:
    pid = patient_id(db, "DEV-0001")
    items = client.get(f"/api/patients/{pid}/checklist").json()["active"]["items"]
    assert len(items) > 1
    seen: set[str] = set()
    for n, item in enumerate(items, start=1):
        assert _sms(client, f"T {n} Y", message_id=f"gw-card-{n}").json()["problems"] == []
        ticked = {e["regimen_item"]["id"] for e in _today_entries(client, pid)
                  if e["kind"] == "medication_tick"}  # fmt: skip
        assert ticked - seen == {item["id"]}, n
        seen = ticked


def test_a_message_sent_again_is_stored_once(client: Any, db: psycopg.Connection[Any]) -> None:
    assert _sms(client, "G 150 A").json()["duplicate"] is False
    assert _sms(client, "G 150 A").json()["duplicate"] is True
    assert len(_today_entries(client, patient_id(db, "DEV-0001"))) == 1
    assert db.execute("SELECT count(*) AS n FROM core.message_log").fetchone()["n"] == 1


def test_refused_lines_are_named_and_the_rest_kept(
    client: Any, db: psycopg.Connection[Any]
) -> None:
    body = _sms(client, "G 142\nG 133 B\nT 9 Y\nhello").json()
    assert [s["kind"] for s in body["stored"]] == ["glucose_reading"]
    assert body["problems"] == [
        {"line": "G 142", "reason": "no_context"},
        {"line": "hello", "reason": "unknown"},
        {"line": "T 9 Y", "reason": "no_such_medicine"},
    ]


def test_sms_cannot_change_a_tick_already_recorded(
    client: Any, db: psycopg.Connection[Any]
) -> None:
    pid = patient_id(db, "DEV-0001")
    item = client.get(f"/api/app/patients/{pid}/today").json()["items"][0]["id"]
    client.put(
        f"/api/app/patients/{pid}/ticks/{item}", json={"ticked": True, "capture_id": "cap-app-0001"}
    )
    body = _sms(client, "T 1 N").json()
    assert body["stored"] == [] and body["problems"] == [
        {"line": "T 1 N", "reason": "already_recorded"}
    ]
    assert client.get(f"/api/app/patients/{pid}/today").json()["ticks"] == {item: True}


def test_a_patient_without_a_checklist_has_no_medicine_to_tick(
    client: Any, db: psycopg.Connection[Any]
) -> None:
    body = _sms(client, "T 1 Y", sender="+91 55500 00002").json()
    assert body["problems"] == [{"line": "T 1 Y", "reason": "no_such_medicine"}]


@pytest.mark.parametrize("sender", ["+91 55500 00009", "not a number", "+91 55500 00004"])
def test_nothing_is_stored_from_an_unknown_number_or_without_consent(
    client: Any, db: psycopg.Connection[Any], sender: str
) -> None:
    body = _sms(client, "G 142 F", sender=sender).json()
    assert body == {"accepted": False, "duplicate": False, "stored": [], "problems": []}
    recent = db.execute(
        "SELECT count(*) AS n FROM pat.entry WHERE channel = 'sms'"
        " AND recorded_at > now() - interval '1 minute'"
    ).fetchone()
    assert recent["n"] == 0
    assert [r["action"] for r in verify_audit_chain(db)] == ["sms.refuse"]


def test_a_withdrawn_consent_stops_sms(client: Any, db: psycopg.Connection[Any]) -> None:
    db.execute(
        "UPDATE core.consent SET withdrawn_at = now() WHERE item = 'sms' AND patient_id = %s",
        (patient_id(db, "DEV-0001"),),
    )
    assert _sms(client, "G 142 F").json()["accepted"] is False


def test_the_number_and_the_words_are_never_stored(
    client: Any, db: psycopg.Connection[Any]
) -> None:
    _sms(client, "G 142 F")
    log = db.execute("SELECT * FROM core.message_log").fetchone()
    assert log["direction"] == "inbound" and log["channel"] == "sms"
    assert bytes(log["body_sha256"]) and "G 142 F" not in str(dict(log))
    phone = db.execute("SELECT * FROM core.patient_phone LIMIT 1").fetchone()
    assert "55500" not in str(dict(phone))
    assert phone["phone_last4"] == "0001"


def test_every_message_is_audited_without_an_actor(
    client: Any, db: psycopg.Connection[Any]
) -> None:
    _sms(client, "G 142 F\nhello")
    [event] = verify_audit_chain(db)
    assert (event["action"], event["actor_id"]) == ("sms.receive", None)
    assert event["new_value"] == {"stored": 1, "refused": 1}


def test_only_the_gateway_may_call(client: Any) -> None:
    res = client.post(
        "/api/sms/inbound", json={"message_id": "gw-0001", "from": ASHA, "body": "G 142 F"}
    )
    assert res.status_code == 401
    assert _sms(client, "G 142 F", **{"X-Gateway-Key": "wrong"}).status_code == 401


def test_the_result_carries_no_judgement(client: Any) -> None:
    body = _sms(client, "G 410 F").json()
    keys = set(body) | {k for s in body["stored"] for k in s}
    assert not [k for k in keys if any(b in k for b in BANNED_KEYS)]


@pytest.mark.parametrize(
    ("raw", "expected"),
    [("+91 55500 00001", "915550000001"), ("5550000001", "915550000001"),
     ("05550000001", "915550000001"), ("0091-555-000-0001", "915550000001"),
     ("hello", None), ("123", None)],
)  # fmt: skip
def test_phone_numbers_are_normalised_before_matching(raw: str, expected: str | None) -> None:
    assert phones.normalise(raw) == expected
