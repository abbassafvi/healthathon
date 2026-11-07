"""
An inbound call, and what it does to the record.

The keypad carries the same instructions an SMS carries, so these cover
the door rather than the storing: who is allowed to be heard, that a
step delivered twice stores once, and that nothing interpretive goes
back down the line.
"""

from typing import Any

import psycopg
import pytest

from healthathon import clinic_time
from tests.helpers import BANNED_KEYS, patient_id, verify_audit_chain

ASHA = "+91 55500 00001"
# The seed gives her SMS but not voice, so she is the one who proves a
# separately refusable item is actually separate.
MEERA_SMS_ONLY = "+91 55500 00003"
# Neither SMS nor voice.
RAKESH_NO_CONSENT = "+91 55500 00004"
KEY = {"X-Gateway-Key": "dev-only-voice-key"}


@pytest.fixture
def pid(db: psycopg.Connection[Any]) -> str:
    return patient_id(db, "DEV-0001")


@pytest.fixture
def agreed(db: psycopg.Connection[Any], pid: str) -> None:
    """The patient agreed to be heard by voice. Nothing happens without it."""
    db.execute(
        "INSERT INTO core.consent (patient_id, item, granted, language, captured_by)"
        " SELECT %s, 'voice', true, 'hi', id FROM core.clinic_user LIMIT 1",
        (pid,),
    )


def step(client: Any, kind: str, n: int = 1, call: str = "call-0001", **over: Any) -> Any:
    body: dict[str, Any] = {
        "call_id": call,
        "step": n,
        "from": over.pop("sender", ASHA),
        "kind": kind,
    }
    body.update(over)
    return client.post("/api/voice/inbound", json=body, headers={**KEY, **over.pop("h", {})})


def _today_entries(client: Any, pid: str) -> list[dict[str, Any]]:
    day = clinic_time.today().isoformat()
    return list(client.get(f"/api/patients/{pid}/entries?from={day}&to={day}").json()["entries"])


def test_a_reading_entered_on_the_keypad_reaches_the_record(
    client: Any, db: psycopg.Connection[Any], pid: str, agreed: None
) -> None:
    res = step(client, "reading", digits="142", context="fasting")
    assert res.status_code == 200, res.text
    assert res.json()["accepted"] is True
    glucose = [e for e in _today_entries(client, pid) if e["kind"] == "glucose_reading"]
    assert [(g["value_text"], g["context"], g["channel"]) for g in glucose] == [
        ("142", "fasting", "voice_call")
    ]


def test_the_call_repeats_the_digits_and_says_nothing_else_about_them(
    client: Any, pid: str, agreed: None
) -> None:
    """
    "142 recorded" and no more. A reading is never called high, low, or
    anything else by voice, which is the same rule the app is held to.
    """
    body = step(client, "reading", digits="142", context="fasting").json()
    assert body["confirm"] == "142"
    keys = set(body)
    assert not [k for k in keys if any(b in k for b in BANNED_KEYS)], sorted(keys)


def test_a_tick_by_card_number_reaches_the_record(
    client: Any, db: psycopg.Connection[Any], pid: str, agreed: None
) -> None:
    """A medicine is its number on the SMS card, so no recording says a drug name."""
    res = step(client, "tick", item_number=1, digits="1")
    assert res.json()["stored"] == ["medication_tick"], res.text
    ticks = [e for e in _today_entries(client, pid) if e["kind"] == "medication_tick"]
    assert [(t["ticked"], t["channel"]) for t in ticks] == [(True, "voice_call")]


def test_pressing_two_records_a_medicine_as_not_taken(client: Any, pid: str, agreed: None) -> None:
    step(client, "tick", item_number=1, digits="2")
    ticks = [e for e in _today_entries(client, pid) if e["kind"] == "medication_tick"]
    assert [t["ticked"] for t in ticks] == [False]


def test_a_spoken_answer_is_kept_as_recorded_and_not_transcribed(
    client: Any, db: psycopg.Connection[Any], pid: str, agreed: None
) -> None:
    key = f"voice/{pid}/answer-01.m4a"
    res = step(client, "answer", audio_key=key)
    assert res.json()["stored"] == ["survey_answer"], res.text
    # By capture id, not by row order: the seed already gave her answers.
    row = db.execute(
        "SELECT sa.answer_text, sa.audio_key FROM pat.survey_answer sa"
        " JOIN pat.entry e ON e.id = sa.entry_id"
        " WHERE e.client_capture_id = 'voice-call-0001:1:1'",
    ).fetchone()
    assert row is not None
    # The recording is the answer. No text was invented from the audio.
    assert (row["answer_text"], row["audio_key"]) == (None, key)


def test_a_medicine_the_patient_is_not_on_is_refused_not_repaired(
    client: Any, pid: str, agreed: None
) -> None:
    body = step(client, "tick", item_number=99, digits="1").json()
    assert body["stored"] == []
    assert [p["reason"] for p in body["problems"]] == ["no_such_medicine"]


def test_an_unrecognised_press_is_asked_again_never_guessed(
    client: Any, pid: str, agreed: None
) -> None:
    body = step(client, "tick", item_number=1, digits="7").json()
    assert body["stored"] == []
    assert body["prompt"] == "voice.not_recognised"


def test_nothing_is_stored_without_voice_consent(client: Any, db: psycopg.Connection[Any]) -> None:
    """No consent row at all is a no. Processing fails closed."""
    other = patient_id(db, "DEV-0004")
    body = step(client, "reading", digits="142", context="fasting", sender=RAKESH_NO_CONSENT).json()
    assert body["accepted"] is False
    assert body["prompt"] is None
    assert not _today_entries(client, other)


def test_a_withdrawn_voice_consent_stops_the_call(
    client: Any, db: psycopg.Connection[Any], pid: str, agreed: None
) -> None:
    db.execute(
        "UPDATE core.consent SET withdrawn_at = now() WHERE item = 'voice' AND patient_id = %s",
        (pid,),
    )
    assert step(client, "reading", digits="142", context="fasting").json()["accepted"] is False


def test_sms_consent_alone_does_not_let_a_call_through(
    client: Any, db: psycopg.Connection[Any]
) -> None:
    """
    She agreed to SMS and not to voice. Under the DPDP Act each item is
    separately refusable, so the one does not imply the other.
    """
    her = patient_id(db, "DEV-0003")
    body = step(client, "reading", digits="142", context="fasting", sender=MEERA_SMS_ONLY).json()
    assert body["accepted"] is False
    assert not _today_entries(client, her)


def test_a_call_from_an_unknown_number_stores_nothing(client: Any, pid: str, agreed: None) -> None:
    body = step(client, "reading", digits="142", context="fasting", sender="+91 99999 99999").json()
    assert body["accepted"] is False


def test_a_step_delivered_twice_is_stored_once(
    client: Any, db: psycopg.Connection[Any], pid: str, agreed: None
) -> None:
    step(client, "reading", digits="142", context="fasting")
    again = step(client, "reading", digits="142", context="fasting").json()
    assert again["duplicate"] is True
    glucose = [e for e in _today_entries(client, pid) if e["kind"] == "glucose_reading"]
    assert len(glucose) == 1


def test_two_steps_of_one_call_are_both_stored(
    client: Any, db: psycopg.Connection[Any], pid: str, agreed: None
) -> None:
    step(client, "reading", n=1, digits="142", context="fasting")
    step(client, "tick", n=2, item_number=1, digits="1")
    kinds = sorted(e["kind"] for e in _today_entries(client, pid))
    assert kinds == ["glucose_reading", "medication_tick"]


def test_the_menu_stores_nothing_and_leads_to_the_right_prompt(
    client: Any, pid: str, agreed: None
) -> None:
    assert step(client, "menu", digits="1").json()["prompt"] == "voice.which_medicine"
    assert step(client, "menu", n=2, digits="2").json()["prompt"] == "voice.reading"
    spoken = step(client, "menu", n=3, digits="3").json()
    assert (spoken["prompt"], spoken["expect"]) == ("voice.todays_question", "recording")
    assert step(client, "menu", n=4, digits="9").json()["prompt"] == "voice.not_recognised"


def test_only_the_voice_provider_may_call(client: Any) -> None:
    res = client.post(
        "/api/voice/inbound",
        json={"call_id": "call-0001", "step": 1, "from": ASHA, "kind": "menu", "digits": "1"},
        headers={"X-Gateway-Key": "wrong"},
    )
    assert res.status_code == 401


def test_the_sms_key_does_not_open_the_voice_endpoint(client: Any) -> None:
    """A leaked SMS key must not let anyone post call steps."""
    res = client.post(
        "/api/voice/inbound",
        json={"call_id": "call-0001", "step": 1, "from": ASHA, "kind": "menu", "digits": "1"},
        headers={"X-Gateway-Key": "dev-only-gateway-key"},
    )
    assert res.status_code == 401


def test_a_call_is_audited(
    client: Any, db: psycopg.Connection[Any], pid: str, agreed: None
) -> None:
    step(client, "reading", digits="142", context="fasting")
    # verify_audit_chain asserts every hash links to the one before it and
    # hands back the events, so a broken chain raises inside it.
    actions = [r["action"] for r in verify_audit_chain(db)]
    assert "voice.receive" in actions, actions
