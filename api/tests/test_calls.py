"""
Scheduling a survey call, and placing the ones that are due.

The provider is a stand-in: these cover who may be rung, what is
refused, and that nobody is rung twice. No real number is used and no
call leaves this machine.
"""

from datetime import timedelta
from typing import Any
from uuid import UUID

import httpx
import psycopg
import pytest

from healthathon import clinic_time, phones
from healthathon.calls import service
from healthathon.config import get_settings
from tests.helpers import patient_id, verify_audit_chain

NUMBER = "919000000001"


@pytest.fixture
def pid(db: psycopg.Connection[Any]) -> str:
    return patient_id(db, "DEV-0001")


@pytest.fixture
def dialable(db: psycopg.Connection[Any], pid: str) -> Any:
    """One patient the clinic can ring: consented, with a sealed number."""
    settings = get_settings()
    was = settings.phone_encryption_key
    settings.phone_encryption_key = "Zm9ydHktdHdvLWJ5dGVzLW9mLXRlc3Qta2V5LW9rISE="
    db.execute(
        "INSERT INTO core.consent (patient_id, item, granted, language, captured_by)"
        " SELECT %s, 'voice', true, 'hi', id FROM core.clinic_user LIMIT 1",
        (pid,),
    )
    db.execute(
        "UPDATE core.patient_phone SET phone_sealed = %s WHERE patient_id = %s",
        (phones.seal(NUMBER), pid),
    )
    yield
    settings.phone_encryption_key = was


@pytest.fixture
def exotel(dialable: None) -> Any:
    """Exotel configured, so a due call is actually placed."""
    s = get_settings()
    was = (
        s.exotel_account_sid,
        s.exotel_api_key,
        s.exotel_api_token,
        s.exotel_from,
        s.exotel_flow_id,
    )
    s.exotel_account_sid, s.exotel_api_key = "acct", "key"
    s.exotel_api_token, s.exotel_from, s.exotel_flow_id = "token", "+918000000000", "999"
    yield
    (
        s.exotel_account_sid,
        s.exotel_api_key,
        s.exotel_api_token,
        s.exotel_from,
        s.exotel_flow_id,
    ) = was


def soon() -> str:
    return (clinic_time.now() + timedelta(hours=1)).isoformat()


def schedule(client: Any, pid: str, when: str | None = None) -> Any:
    return client.post(
        "/api/scheduled-calls", json={"patient_id": pid, "scheduled_for": when or soon()}
    )


def provider(status: int = 200, body: Any = None) -> httpx.Client:
    sent: list[httpx.Request] = []

    def handle(request: httpx.Request) -> httpx.Response:
        sent.append(request)
        return httpx.Response(status, json=body if body is not None else {"Call": {"Sid": "exo-1"}})

    c = httpx.Client(transport=httpx.MockTransport(handle))
    c.sent = sent  # type: ignore[attr-defined]
    return c


def test_a_clinician_schedules_a_call(client: Any, pid: str, dialable: None) -> None:
    res = schedule(client, pid)
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["state"] == "waiting"
    assert body["registration_no"] == "DEV-0001"


def test_a_patient_who_did_not_agree_to_be_telephoned_is_refused(
    client: Any, db: psycopg.Connection[Any]
) -> None:
    """The clinic does not ring someone who did not agree to be rung."""
    other = patient_id(db, "DEV-0004")
    assert schedule(client, other).status_code == 409


def test_a_patient_with_no_dialable_number_is_refused(
    client: Any, db: psycopg.Connection[Any], pid: str, dialable: None
) -> None:
    """A schedule full of calls that can never be placed tells nobody anything."""
    db.execute("UPDATE core.patient_phone SET phone_sealed = NULL WHERE patient_id = %s", (pid,))
    assert schedule(client, pid).status_code == 409


def test_a_time_already_past_is_refused(client: Any, pid: str, dialable: None) -> None:
    gone = (clinic_time.now() - timedelta(hours=1)).isoformat()
    assert schedule(client, pid, gone).status_code == 422


def test_a_due_call_is_placed_and_says_who_it_rang(
    client: Any, db: psycopg.Connection[Any], pid: str, exotel: None
) -> None:
    schedule(client, pid)
    p = provider()
    assert service.place_due(db, clinic_time.now() + timedelta(days=1), p) == 1
    assert len(p.sent) == 1  # type: ignore[attr-defined]
    body = p.sent[0].content.decode()  # type: ignore[attr-defined]
    assert f"From=%2B{NUMBER}" in body
    assert "CallerId=%2B918000000000" in body
    calls = client.get(f"/api/patients/{pid}/scheduled-calls").json()["calls"]
    assert [c["state"] for c in calls] == ["placed"]


def test_nobody_is_rung_twice(
    client: Any, db: psycopg.Connection[Any], pid: str, exotel: None
) -> None:
    schedule(client, pid)
    later = clinic_time.now() + timedelta(days=1)
    first = provider()
    assert service.place_due(db, later, first) == 1
    again = provider()
    assert service.place_due(db, later, again) == 0
    assert len(again.sent) == 0  # type: ignore[attr-defined]


def test_a_call_not_yet_due_is_left_alone(
    client: Any, db: psycopg.Connection[Any], pid: str, exotel: None
) -> None:
    schedule(client, pid)
    p = provider()
    assert service.place_due(db, clinic_time.now(), p) == 0


def test_a_provider_that_refuses_is_written_down_in_words(
    client: Any, db: psycopg.Connection[Any], pid: str, exotel: None
) -> None:
    """And not retried: a patient telephoned over and over by a retry loop
    is the thing to avoid most."""
    schedule(client, pid)
    later = clinic_time.now() + timedelta(days=1)
    assert service.place_due(db, later, provider(status=400)) == 0
    calls = client.get(f"/api/patients/{pid}/scheduled-calls").json()["calls"]
    assert calls[0]["state"] == "failed"
    assert "refused" in calls[0]["failure"]
    # Not tried again.
    second = provider()
    assert service.place_due(db, later, second) == 0
    assert len(second.sent) == 0  # type: ignore[attr-defined]


def test_nothing_is_placed_when_the_clinic_cannot_ring_out(
    client: Any, db: psycopg.Connection[Any], pid: str, dialable: None
) -> None:
    """Exotel unconfigured. The row says so rather than the call vanishing."""
    schedule(client, pid)
    p = provider()
    assert service.place_due(db, clinic_time.now() + timedelta(days=1), p) == 0
    assert len(p.sent) == 0  # type: ignore[attr-defined]
    calls = client.get(f"/api/patients/{pid}/scheduled-calls").json()["calls"]
    assert "Exotel is not configured" in calls[0]["failure"]


def test_a_waiting_call_can_be_called_off(client: Any, pid: str, dialable: None) -> None:
    made = schedule(client, pid).json()
    res = client.delete(f"/api/scheduled-calls/{made['id']}")
    assert res.status_code == 200, res.text
    assert res.json()["state"] == "cancelled"


def test_a_call_off_stops_it_being_placed(
    client: Any, db: psycopg.Connection[Any], pid: str, exotel: None
) -> None:
    made = schedule(client, pid).json()
    client.delete(f"/api/scheduled-calls/{made['id']}")
    p = provider()
    assert service.place_due(db, clinic_time.now() + timedelta(days=1), p) == 0
    assert len(p.sent) == 0  # type: ignore[attr-defined]


def test_a_call_already_placed_cannot_be_called_off(
    client: Any, db: psycopg.Connection[Any], pid: str, exotel: None
) -> None:
    made = schedule(client, pid).json()
    service.place_due(db, clinic_time.now() + timedelta(days=1), provider())
    assert client.delete(f"/api/scheduled-calls/{made['id']}").status_code == 409


def test_scheduling_and_placing_are_audited(
    client: Any, db: psycopg.Connection[Any], pid: str, exotel: None
) -> None:
    schedule(client, pid)
    service.place_due(db, clinic_time.now() + timedelta(days=1), provider())
    actions = [r["action"] for r in verify_audit_chain(db)]
    assert "call.schedule" in actions
    assert "call.place" in actions


def test_the_number_dialled_is_never_written_to_the_record(
    client: Any, db: psycopg.Connection[Any], pid: str, exotel: None
) -> None:
    """The sealed number is opened to dial and nowhere else."""
    schedule(client, pid)
    service.place_due(db, clinic_time.now() + timedelta(days=1), provider())
    row = db.execute("SELECT * FROM core.scheduled_call LIMIT 1").fetchone()
    assert row is not None
    assert NUMBER not in str(dict(row))
    assert UUID(str(row["id"])) is not None
