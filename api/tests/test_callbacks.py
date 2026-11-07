"""
A patient asking the clinic to ring them back.

The other direction from a scheduled call, and the one that needs no
dialler: the patient made the call, so the clinic only has to know they
asked.
"""

from typing import Any

import psycopg
import pytest

from tests.helpers import patient_id, verify_audit_chain

ASHA = "+91 55500 00001"
SECRET = "dev-only-voice-key"


@pytest.fixture
def pid(db: psycopg.Connection[Any]) -> str:
    return patient_id(db, "DEV-0001")


@pytest.fixture
def agreed(db: psycopg.Connection[Any], pid: str) -> None:
    db.execute(
        "INSERT INTO core.consent (patient_id, item, granted, language, captured_by)"
        " SELECT %s, 'voice', true, 'hi', id FROM core.clinic_user LIMIT 1",
        (pid,),
    )


def ask(client: Any, call: str = "cb-call-1", sender: str = ASHA) -> Any:
    """Press the key that asks for a call back."""
    return client.get(
        f"/api/voice/exotel/{SECRET}/callback",
        params={"CallSid": call, "CallFrom": sender},
        follow_redirects=False,
    )


def waiting(client: Any) -> list[dict[str, Any]]:
    return list(client.get("/api/callback-requests").json()["requests"])


def test_a_patient_asks_to_be_rung_back(client: Any, pid: str, agreed: None) -> None:
    assert ask(client).status_code == 200
    reqs = waiting(client)
    assert [(r["registration_no"], r["channel"]) for r in reqs] == [("DEV-0001", "voice_call")]
    assert reqs[0]["seen_at"] is None


def test_the_clinic_is_told_which_language_to_speak(client: Any, pid: str, agreed: None) -> None:
    """Whoever rings back needs to know, and it is on the patient's record."""
    ask(client)
    assert waiting(client)[0]["preferred_language"] == "hi"


def test_asking_twice_on_one_call_is_one_request(client: Any, pid: str, agreed: None) -> None:
    """A redelivered webhook records one request, not a queue of them."""
    ask(client)
    ask(client)
    assert len(waiting(client)) == 1


def test_asking_on_a_later_call_is_a_second_request(client: Any, pid: str, agreed: None) -> None:
    ask(client, call="cb-call-1")
    ask(client, call="cb-call-2")
    assert len(waiting(client)) == 2


def test_a_caller_who_did_not_agree_to_voice_is_not_added(
    client: Any, db: psycopg.Connection[Any]
) -> None:
    """
    302 so the flow says something else, rather than promising a call
    back the clinic has no record of.
    """
    patient_id(db, "DEV-0003")
    assert ask(client, sender="+91 55500 00003").status_code == 302
    assert waiting(client) == []


def test_an_unknown_caller_is_not_added(client: Any, pid: str, agreed: None) -> None:
    assert ask(client, sender="+91 99999 99999").status_code == 302
    assert waiting(client) == []


def test_a_clinic_user_says_they_have_seen_it(client: Any, pid: str, agreed: None) -> None:
    ask(client)
    one = waiting(client)[0]
    res = client.post(f"/api/callback-requests/{one['id']}/seen")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["seen_at"] is not None
    assert body["seen_by_name"]
    # Gone from the waiting list, still there when asked for everything.
    assert waiting(client) == []
    assert len(client.get("/api/callback-requests?include_seen=true").json()["requests"]) == 1


def test_saying_it_twice_changes_nothing(client: Any, pid: str, agreed: None) -> None:
    ask(client)
    one = waiting(client)[0]
    first = client.post(f"/api/callback-requests/{one['id']}/seen").json()
    second = client.post(f"/api/callback-requests/{one['id']}/seen").json()
    assert first["seen_at"] == second["seen_at"]


def test_a_request_that_does_not_exist_is_not_found(client: Any) -> None:
    missing = "00000000-0000-0000-0000-000000000000"
    assert client.post(f"/api/callback-requests/{missing}/seen").status_code == 404


def test_the_list_carries_nothing_that_ranks_a_patient(client: Any, pid: str, agreed: None) -> None:
    """Oldest first, and no field says one patient matters more."""
    from tests.helpers import BANNED_KEYS

    ask(client)
    keys = set(waiting(client)[0])
    assert not [k for k in keys if any(b in k for b in BANNED_KEYS)], sorted(keys)


def test_a_patients_own_requests_are_listed_for_the_clinician(
    client: Any, pid: str, agreed: None
) -> None:
    ask(client)
    reqs = client.get(f"/api/patients/{pid}/callback-requests").json()["requests"]
    assert len(reqs) == 1


def test_asking_is_audited(
    client: Any, db: psycopg.Connection[Any], pid: str, agreed: None
) -> None:
    ask(client)
    one = waiting(client)[0]
    client.post(f"/api/callback-requests/{one['id']}/seen")
    actions = [r["action"] for r in verify_audit_chain(db)]
    assert "callback.request" in actions
    assert "callback.seen" in actions


def test_asking_stores_no_entry_in_the_record(
    client: Any, db: psycopg.Connection[Any], pid: str, agreed: None
) -> None:
    """
    Asking to be rung is a request to the clinic, not something the
    patient reported about themselves, so it stays off their record.
    """
    before = db.execute(
        "SELECT count(*) AS n FROM pat.entry WHERE patient_id = %s", (pid,)
    ).fetchone()
    ask(client)
    after = db.execute(
        "SELECT count(*) AS n FROM pat.entry WHERE patient_id = %s", (pid,)
    ).fetchone()
    assert before is not None and after is not None
    assert before["n"] == after["n"]
