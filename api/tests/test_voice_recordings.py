"""
A spoken answer left on a call.

Exotel hands over a URL, not the audio, and says the recording takes 5
to 20 minutes to appear. So these cover the two things that follow from
that: where a recording may be fetched from, and that nothing is stored
until the audio is actually in hand.
"""

from typing import Any

import httpx
import psycopg
import pytest

from healthathon.config import get_settings
from healthathon.voice import recordings
from healthathon.voice.models import VoiceStep
from tests.helpers import patient_id

ASHA = "+91 55500 00001"
SECRET = "dev-only-voice-key"
HOST = "recordings.exotel.test"
URL = f"https://{HOST}/call/exo-ans-1.mp3"
MP3 = b"ID3\x03\x00\x00\x00" + b"\x00" * 256


@pytest.fixture
def allowed_host() -> Any:
    """Spoken answers are off until a host is configured. These switch it on."""
    settings = get_settings()
    was = settings.voice_recording_hosts
    tries, wait = settings.voice_recording_tries, settings.voice_recording_wait_s
    settings.voice_recording_hosts = [HOST]
    # No waiting in a test: the delay is the provider's, not ours to prove.
    settings.voice_recording_tries, settings.voice_recording_wait_s = 1, 0
    yield
    settings.voice_recording_hosts = was
    settings.voice_recording_tries, settings.voice_recording_wait_s = tries, wait


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


def serving(body: bytes, status: int = 200) -> httpx.Client:
    """A stand-in for the provider's recording store."""
    return httpx.Client(
        transport=httpx.MockTransport(lambda _: httpx.Response(status, content=body))
    )


def a_step(ref: str = "answer") -> VoiceStep:
    return VoiceStep.model_validate(
        {"call_id": "exo-ans-1", "step": 1, "from": ASHA, "kind": "answer", "provider_ref": ref}
    )


def test_a_recording_is_fetched_and_the_answer_stored(
    client: Any, db: psycopg.Connection[Any], pid: str, agreed: None, allowed_host: None
) -> None:
    assert recordings.collect(a_step(), URL, serving(MP3)) is True
    row = db.execute(
        "SELECT sa.answer_text, sa.audio_key FROM pat.survey_answer sa"
        " JOIN pat.entry e ON e.id = sa.entry_id"
        " WHERE e.client_capture_id = 'voice-exo-ans-1:answer:1'"
    ).fetchone()
    assert row is not None
    # The recording is the answer. Nothing was transcribed from the audio.
    assert row["answer_text"] is None
    # Kept under the patient's own key, named for the call it came from.
    assert row["audio_key"] == f"voice/{pid}/exo-ans-1-answer.mp3"


def test_the_entry_is_marked_as_coming_from_a_call(
    client: Any, db: psycopg.Connection[Any], pid: str, agreed: None, allowed_host: None
) -> None:
    recordings.collect(a_step(), URL, serving(MP3))
    row = db.execute(
        "SELECT channel::text AS channel, entered_by::text AS by FROM pat.entry"
        " WHERE client_capture_id = 'voice-exo-ans-1:answer:1'"
    ).fetchone()
    assert row is not None
    assert (row["channel"], row["by"]) == ("voice_call", "patient")


def test_nothing_is_stored_when_the_recording_never_arrives(
    client: Any, db: psycopg.Connection[Any], pid: str, agreed: None, allowed_host: None
) -> None:
    """
    An answer the clinician cannot play is worse than no answer: they
    would see the patient spoke and be unable to hear it.
    """
    assert recordings.collect(a_step(), URL, serving(b"", status=404)) is False
    assert not db.execute(
        "SELECT 1 FROM pat.entry WHERE client_capture_id = 'voice-exo-ans-1:answer:1'"
    ).fetchall()


def test_something_that_is_not_audio_is_not_stored(
    client: Any, db: psycopg.Connection[Any], pid: str, agreed: None, allowed_host: None
) -> None:
    assert recordings.collect(a_step(), URL, serving(b"<html>not audio</html>")) is False


def test_a_host_that_is_not_allowed_is_never_fetched(
    client: Any, db: psycopg.Connection[Any], pid: str, agreed: None, allowed_host: None
) -> None:
    """
    A URL that arrived in a query parameter is how a service is talked
    into reaching inside its own network. The host is checked first.
    """
    called: list[str] = []

    def record(request: httpx.Request) -> httpx.Response:
        called.append(str(request.url))
        return httpx.Response(200, content=MP3)

    spy = httpx.Client(transport=httpx.MockTransport(record))
    assert recordings.collect(a_step(), "https://attacker.example/x.mp3", spy) is False
    assert recordings.collect(a_step(), "http://169.254.169.254/latest/meta-data/", spy) is False
    assert called == []


def test_a_lookalike_host_is_not_allowed() -> None:
    """A suffix match would let this through. An exact host does not."""
    settings = get_settings()
    was = settings.voice_recording_hosts
    settings.voice_recording_hosts = [HOST]
    try:
        assert recordings.host_allowed(f"https://{HOST}/ok.mp3") is True
        assert recordings.host_allowed(f"https://{HOST}.attacker.example/x.mp3") is False
        assert recordings.host_allowed(f"http://{HOST}/not-https.mp3") is False
    finally:
        settings.voice_recording_hosts = was


def test_spoken_answers_are_off_until_a_host_is_configured() -> None:
    """Empty by default, because no real call has shown the host yet."""
    assert get_settings().voice_recording_hosts == []
    assert recordings.host_allowed(URL) is False


def test_the_webhook_takes_the_answer_and_returns_at_once(
    client: Any, pid: str, agreed: None, allowed_host: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    """200 means "we will keep this". The fetch happens afterwards."""
    asked: list[tuple[str, str]] = []
    monkeypatch.setattr(
        recordings, "store_when_ready", lambda step, url: asked.append((step.call_id, url))
    )
    res = client.get(
        f"/api/voice/exotel/{SECRET}/answer",
        params={"CallSid": "exo-ans-9", "CallFrom": ASHA, "RecordingUrl": URL},
        follow_redirects=False,
    )
    assert res.status_code == 200, res.text
    assert asked == [("exo-ans-9", URL)]


def test_the_webhook_refuses_a_url_from_a_host_that_is_not_allowed(
    client: Any, pid: str, agreed: None, allowed_host: None
) -> None:
    res = client.get(
        f"/api/voice/exotel/{SECRET}/answer",
        params={"CallSid": "exo-ans-8", "CallFrom": ASHA, "RecordingUrl": "https://x.test/a.mp3"},
        follow_redirects=False,
    )
    assert res.status_code == 302


def test_the_webhook_refuses_a_call_with_no_recording(
    client: Any, pid: str, agreed: None, allowed_host: None
) -> None:
    res = client.get(
        f"/api/voice/exotel/{SECRET}/answer",
        params={"CallSid": "exo-ans-7", "CallFrom": ASHA},
        follow_redirects=False,
    )
    assert res.status_code == 302


def test_a_caller_who_agreed_to_sms_but_not_voice_has_no_answer_stored(
    client: Any, db: psycopg.Connection[Any], allowed_host: None
) -> None:
    """Separately refusable, so the recording is fetched and then dropped."""
    step = VoiceStep.model_validate(
        {
            "call_id": "exo-ans-2",
            "step": 1,
            "from": "+91 55500 00003",
            "kind": "answer",
            "provider_ref": "answer",
        }
    )
    assert recordings.collect(step, URL, serving(MP3)) is False
    assert not db.execute(
        "SELECT 1 FROM pat.entry WHERE client_capture_id = 'voice-exo-ans-2:answer:1'"
    ).fetchall()


def test_the_webhook_takes_the_other_branch_for_a_caller_id_it_cannot_store(
    client: Any, pid: str, agreed: None, allowed_host: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A caller ID over 32 characters failed validation inside the handler: a 500."""
    asked: list[str] = []
    monkeypatch.setattr(recordings, "store_when_ready", lambda step, url: asked.append(url))
    res = client.get(
        f"/api/voice/exotel/{SECRET}/answer",
        params={"CallSid": "exo-ans-7", "CallFrom": "+91" + "5" * 40, "RecordingUrl": URL},
        follow_redirects=False,
    )
    assert res.status_code == 302
    assert asked == []
