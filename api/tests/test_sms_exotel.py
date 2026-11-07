"""
Exotel's inbound SMS webhook against our endpoint.

The storing is already covered by test_sms.py, so these cover the
adapter's own job: form fields instead of JSON, a secret in the URL
because Exotel documents no custom headers, and always answering 200 so
a settled refusal is not delivered again.
"""

from typing import Any

import psycopg
import pytest

from healthathon import clinic_time
from tests.helpers import patient_id

ASHA = "+91 55500 00001"
SECRET = "dev-only-gateway-key"


@pytest.fixture
def pid(db: psycopg.Connection[Any]) -> str:
    return patient_id(db, "DEV-0001")


def post(client: Any, **fields: Any) -> Any:
    body = {"SmsSid": "exo-sms-1", "From": ASHA, "Body": "G 142 F"}
    body.update(fields)
    return client.post(f"/api/sms/exotel/{SECRET}", data=body)


def _entries(client: Any, pid: str) -> list[dict[str, Any]]:
    day = clinic_time.today().isoformat()
    return list(client.get(f"/api/patients/{pid}/entries?from={day}&to={day}").json()["entries"])


def test_a_message_posted_by_exotel_reaches_the_record(
    client: Any, db: psycopg.Connection[Any], pid: str
) -> None:
    assert post(client).status_code == 200
    glucose = [e for e in _entries(client, pid) if e["kind"] == "glucose_reading"]
    assert [(g["value_text"], g["context"], g["channel"]) for g in glucose] == [
        ("142", "fasting", "sms")
    ]


def test_the_same_webhook_with_get_works_too(
    client: Any, db: psycopg.Connection[Any], pid: str
) -> None:
    """Exotel lets an account choose POST or GET for this webhook."""
    res = client.get(
        f"/api/sms/exotel/{SECRET}",
        params={"SmsSid": "exo-sms-2", "From": ASHA, "Body": "G 98 B"},
    )
    assert res.status_code == 200
    glucose = [e for e in _entries(client, pid) if e["kind"] == "glucose_reading"]
    assert [g["value_text"] for g in glucose] == ["98"]


def test_the_same_message_delivered_twice_is_stored_once(
    client: Any, db: psycopg.Connection[Any], pid: str
) -> None:
    post(client)
    post(client)
    glucose = [e for e in _entries(client, pid) if e["kind"] == "glucose_reading"]
    assert len(glucose) == 1


def test_a_sender_who_is_not_a_patient_stores_nothing_and_still_gets_200(
    client: Any, db: psycopg.Connection[Any], pid: str
) -> None:
    """
    200 because the refusal is settled: Exotel retries anything else, and
    this message will be refused every time.
    """
    assert post(client, From="+91 99999 99999").status_code == 200
    assert not _entries(client, pid)


def test_a_message_missing_a_field_is_not_retried(client: Any, pid: str) -> None:
    assert post(client, Body=None).status_code == 200
    assert post(client, SmsSid=None).status_code == 200
    assert not _entries(client, pid)


def test_a_message_id_that_does_not_fit_the_contract_is_refused_quietly(
    client: Any, pid: str
) -> None:
    assert post(client, SmsSid="not a valid id!").status_code == 200
    assert not _entries(client, pid)


def test_a_wrong_secret_in_the_url_is_not_found(client: Any) -> None:
    res = client.post(
        "/api/sms/exotel/wrong-secret",
        data={"SmsSid": "exo-sms-9", "From": ASHA, "Body": "G 142 F"},
    )
    assert res.status_code == 404


def test_the_voice_secret_does_not_open_the_sms_endpoint(client: Any) -> None:
    """A leaked secret for one door must not open the other."""
    res = client.post(
        "/api/sms/exotel/dev-only-voice-key",
        data={"SmsSid": "exo-sms-8", "From": ASHA, "Body": "G 142 F"},
    )
    assert res.status_code == 404
