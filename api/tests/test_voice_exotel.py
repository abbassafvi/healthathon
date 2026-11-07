"""
Exotel's Passthru applet against our endpoint.

These cover the adapter's own job, which is translation: a GET with
query parameters, a secret in the URL because Exotel documents no custom
headers, digits arriving wrapped in double quotes, and a reply Exotel
reads only as a status code.
"""

from typing import Any
from uuid import UUID

import psycopg
import pytest

from healthathon import clinic_time
from tests.helpers import patient_id

ASHA = "+91 55500 00001"
# The seed gives her SMS but not voice.
MEERA_SMS_ONLY = "+91 55500 00003"
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


def hit(client: Any, path: str, **params: str) -> Any:
    """Exotel calls a URL. It follows no redirect, so neither do we."""
    base = {"CallSid": "exo-0001", "CallFrom": ASHA, "CallTo": "+91 80 1234 5678"}
    return client.get(
        f"/api/voice/exotel/{SECRET}{path}", params={**base, **params}, follow_redirects=False
    )


def _entries(client: Any, pid: str) -> list[dict[str, Any]]:
    day = clinic_time.today().isoformat()
    return list(client.get(f"/api/patients/{pid}/entries?from={day}&to={day}").json()["entries"])


def test_a_reading_gathered_by_exotel_reaches_the_record(
    client: Any, db: psycopg.Connection[Any], pid: str, agreed: None
) -> None:
    res = hit(client, "/reading/fasting", digits='"142"')
    assert res.status_code == 200, res.text
    glucose = [e for e in _entries(client, pid) if e["kind"] == "glucose_reading"]
    assert [(g["value_text"], g["context"], g["channel"]) for g in glucose] == [
        ("142", "fasting", "voice_call")
    ]


def test_the_double_quotes_exotel_wraps_digits_in_are_trimmed(
    client: Any, db: psycopg.Connection[Any], pid: str, agreed: None
) -> None:
    """Exotel's own documentation says to trim them. Untrimmed, 142 would store as '"142"'."""
    hit(client, "/reading/fasting", digits='"142"')
    glucose = [e for e in _entries(client, pid) if e["kind"] == "glucose_reading"]
    assert [g["value_text"] for g in glucose] == ["142"]


def test_the_time_of_day_comes_from_the_branch_the_flow_took(
    client: Any, db: psycopg.Connection[Any], pid: str, agreed: None
) -> None:
    """
    Exotel hands over only the last gather, so a two-step question would
    need this endpoint to remember a half-finished call. It does not: the
    branch is in the URL.
    """
    hit(client, "/reading/bedtime", digits='"98"')
    glucose = [e for e in _entries(client, pid) if e["kind"] == "glucose_reading"]
    assert [(g["value_text"], g["context"]) for g in glucose] == [("98", "bedtime")]


def test_a_tick_takes_the_medicine_from_the_digits_and_taken_from_the_branch(
    client: Any, db: psycopg.Connection[Any], pid: str, agreed: None
) -> None:
    assert hit(client, "/tick/yes", digits='"1"').status_code == 200
    ticks = [e for e in _entries(client, pid) if e["kind"] == "medication_tick"]
    assert [(t["ticked"], t["channel"]) for t in ticks] == [(True, "voice_call")]


def test_the_no_branch_records_a_medicine_as_not_taken(
    client: Any, db: psycopg.Connection[Any], pid: str, agreed: None
) -> None:
    hit(client, "/tick/no", digits='"1"')
    ticks = [e for e in _entries(client, pid) if e["kind"] == "medication_tick"]
    assert [t["ticked"] for t in ticks] == [False]


def test_two_instructions_in_one_call_are_both_stored(
    client: Any, db: psycopg.Connection[Any], pid: str, agreed: None
) -> None:
    """Same CallSid. The provider_ref keeps them apart."""
    hit(client, "/reading/fasting", digits='"142"')
    hit(client, "/tick/yes", digits='"1"')
    assert sorted(e["kind"] for e in _entries(client, pid)) == [
        "glucose_reading",
        "medication_tick",
    ]


def test_the_same_passthru_delivered_twice_stores_once(
    client: Any, db: psycopg.Connection[Any], pid: str, agreed: None
) -> None:
    hit(client, "/reading/fasting", digits='"142"')
    again = hit(client, "/reading/fasting", digits='"142"')
    # Still 200: the flow should play "recorded", because it was.
    assert again.status_code == 200
    glucose = [e for e in _entries(client, pid) if e["kind"] == "glucose_reading"]
    assert len(glucose) == 1


def test_a_caller_without_voice_consent_gets_the_other_branch(
    client: Any, db: psycopg.Connection[Any]
) -> None:
    """
    302 is the only way to tell Exotel to say something else: a Passthru
    response "cannot be customised". The flow then plays its own prompt
    rather than telling the caller something was kept.

    She agreed to SMS and not to voice, which is the case worth covering.
    """
    her = patient_id(db, "DEV-0003")
    res = hit(client, "/reading/fasting", digits='"142"', CallFrom=MEERA_SMS_ONLY)
    assert res.status_code == 302
    assert not _entries(client, her)


def test_an_unknown_caller_gets_the_other_branch(client: Any, pid: str, agreed: None) -> None:
    res = hit(client, "/reading/fasting", digits='"142"', CallFrom="+91 99999 99999")
    assert res.status_code == 302


def test_empty_or_non_numeric_digits_take_the_other_branch(
    client: Any, pid: str, agreed: None
) -> None:
    assert hit(client, "/reading/fasting", digits='""').status_code == 302
    assert hit(client, "/tick/yes", digits='"#"').status_code == 302


def test_a_wrong_secret_in_the_url_is_not_found(client: Any, pid: str, agreed: None) -> None:
    """404, not 401: an unguessed URL should not confirm that it exists."""
    res = client.get(
        "/api/voice/exotel/wrong-secret/reading/fasting",
        params={"CallSid": "exo-0001", "CallFrom": ASHA, "digits": '"142"'},
        follow_redirects=False,
    )
    assert res.status_code == 404


def test_an_unknown_time_of_day_is_refused_before_anything_is_stored(
    client: Any, pid: str, agreed: None
) -> None:
    res = hit(client, "/reading/whenever", digits='"142"')
    assert res.status_code == 422


def test_a_medicine_the_patient_is_not_on_takes_the_other_branch(
    client: Any, pid: str, agreed: None
) -> None:
    assert hit(client, "/tick/yes", digits='"99"').status_code == 302


def test_a_medicine_number_out_of_range_takes_the_other_branch(
    client: Any, pid: str, agreed: None
) -> None:
    """It was a 500: the model refused 0 and 100 inside the handler."""
    assert hit(client, "/tick/yes", digits='"0"').status_code == 302
    assert hit(client, "/tick/no", digits='"100"').status_code == 302


def test_a_reading_too_long_to_be_one_takes_the_other_branch(
    client: Any, pid: str, agreed: None
) -> None:
    assert hit(client, "/reading/fasting", digits='"1234567890123"').status_code == 302
    assert [e for e in _entries(client, pid) if e["channel"] == "voice_call"] == []


def test_a_secret_with_non_ascii_text_is_not_found(client: Any, pid: str, agreed: None) -> None:
    """compare_digest raises on non-ASCII str, which was a 500."""
    res = client.get(
        "/api/voice/exotel/\u0938\u0940\u0915\u094d\u0930\u0947\u091f/reading/fasting",
        params={"CallSid": "exo-0001", "CallFrom": ASHA, "digits": '"142"'},
        follow_redirects=False,
    )
    assert res.status_code == 404


def test_what_a_call_records_reaches_the_patient_and_the_clinician(
    client: Any, db: psycopg.Connection[Any], pid: str, agreed: None
) -> None:
    """
    The point of the whole path: one reading keyed in on a call, visible
    to the clinician and to the patient, each told it came from a call.
    """
    from healthathon.patient_app import signin

    hit(client, "/reading/fasting", digits='"142"')

    # The clinician's timeline.
    day = clinic_time.today().isoformat()
    seen = client.get(f"/api/patients/{pid}/entries?from={day}&to={day}").json()["entries"]
    from_call = [e for e in seen if e["channel"] == "voice_call"]
    assert [(e["kind"], e["value_text"]) for e in from_call] == [("glucose_reading", "142")]

    # The patient's own app, where it is theirs and says how it arrived.
    token = signin.token_for(UUID(pid))
    mine = client.get(
        f"/api/app/patients/{pid}/today", headers={"Authorization": f"Bearer {token}"}
    ).json()
    theirs = [r for r in mine["readings"] if r["value_text"] == "142"]
    assert theirs, mine["readings"]
    assert theirs[0]["channel"] == "voice_call"
