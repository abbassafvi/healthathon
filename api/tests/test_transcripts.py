"""
Spoken answers written down, when transcription is switched on. The
recording stays the answer: the transcript sits beside it, and a failed
or empty transcript leaves the answer exactly as it was.
"""

import time
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import psycopg
import pytest

from healthathon import clinic_time
from healthathon.config import get_settings
from healthathon.transcripts import set_transcriber, transcript_prompt
from healthathon.uploads.providers import ModelUnavailable, _mime
from tests.helpers import patient_id
from tests.test_recordings import M4A


class FakeTranscriber:
    name = "fake:1"

    def __init__(self, text: str = "Nahin, shaam wali bhool gaya", fail: bool = False) -> None:
        self.text = text
        self.fail = fail
        self.heard: list[tuple[str, str]] = []

    def transcribe(self, recording: Path, language: str) -> str:
        self.heard.append((recording.name, language))
        if self.fail:
            raise ModelUnavailable("quota")
        return self.text


@pytest.fixture
def switched_on(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    monkeypatch.setenv("HEALTHATHON_TRANSCRIBE_RECORDINGS", "true")
    get_settings.cache_clear()
    yield
    set_transcriber(None)
    monkeypatch.delenv("HEALTHATHON_TRANSCRIBE_RECORDINGS")
    get_settings.cache_clear()


@pytest.fixture
def pid(db: psycopg.Connection[Any]) -> str:
    return patient_id(db, "DEV-0001")


def _record(client: Any, pid: str, capture: str = "cap-voice-0001") -> str:
    res = client.post(f"/api/app/patients/{pid}/recordings?capture_id={capture}", content=M4A)
    assert res.status_code == 200, res.text
    return str(res.json()["key"])


def _transcript(db: psycopg.Connection[Any], key: str, timeout_s: float = 10.0) -> Any:
    """Wait for the background transcription, as a reader of the record would."""
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        row = db.execute(
            "SELECT transcript_text, language, transcriber FROM pat.recording_transcript"
            " WHERE audio_key = %s",
            (key,),
        ).fetchone()
        if row:
            return row
        time.sleep(0.05)
    return None


def _answer_entry(client: Any, pid: str) -> dict[str, Any]:
    day = clinic_time.today().isoformat()
    entries = client.get(f"/api/patients/{pid}/entries?from={day}&to={day}").json()["entries"]
    [entry] = [e for e in entries if e["kind"] == "survey_answer"]
    return dict(entry)


def test_a_spoken_answer_is_written_down_beside_its_recording(
    client: Any, pid: str, db: psycopg.Connection[Any], switched_on: None
) -> None:
    fake = FakeTranscriber()
    set_transcriber(fake)
    key = _record(client, pid)
    lang = db.execute(
        "SELECT preferred_language FROM core.patient WHERE id = %s", (pid,)
    ).fetchone()
    assert lang is not None
    assert _transcript(db, key) == {
        "transcript_text": "Nahin, shaam wali bhool gaya",
        "language": lang["preferred_language"],
        "transcriber": "fake:1",
    }
    body = {"question_key": "felt_unwell_today", "capture_id": "cap-ans-1", "audio_key": key}
    assert client.post(f"/api/app/patients/{pid}/answers", json=body).status_code == 204

    entry = _answer_entry(client, pid)
    assert entry["answer_text"] is None
    assert entry["audio_url"] == f"/api/storage/{key}"
    assert entry["audio_transcript"] == "Nahin, shaam wali bhool gaya"
    today = client.get(f"/api/app/patients/{pid}/today").json()
    assert today["answer_transcript"] == "Nahin, shaam wali bhool gaya"
    assert today["answer"] is None


def test_the_recogniser_is_told_the_patients_language(
    client: Any, db: psycopg.Connection[Any], switched_on: None
) -> None:
    fake = FakeTranscriber()
    set_transcriber(fake)
    pid = patient_id(db, "DEV-0002")
    db.execute("UPDATE core.patient SET preferred_language = 'hi' WHERE id = %s", (pid,))
    key = _record(client, pid)
    assert _transcript(db, key)["language"] == "hi"
    assert fake.heard == [(key.rsplit("/", 1)[1], "hi")]


def test_a_failed_transcription_leaves_the_answer_as_recorded(
    client: Any, pid: str, db: psycopg.Connection[Any], switched_on: None
) -> None:
    fake = FakeTranscriber(fail=True)
    set_transcriber(fake)
    key = _record(client, pid)
    deadline = time.monotonic() + 5
    while not fake.heard and time.monotonic() < deadline:
        time.sleep(0.05)
    assert fake.heard
    assert _transcript(db, key, timeout_s=0.3) is None
    body = {"question_key": "felt_unwell_today", "capture_id": "cap-ans-2", "audio_key": key}
    assert client.post(f"/api/app/patients/{pid}/answers", json=body).status_code == 204
    entry = _answer_entry(client, pid)
    assert (entry["audio_url"], entry["audio_transcript"]) == (f"/api/storage/{key}", None)


def test_silence_is_not_written_down(
    client: Any, pid: str, db: psycopg.Connection[Any], switched_on: None
) -> None:
    fake = FakeTranscriber(text="")
    set_transcriber(fake)
    key = _record(client, pid)
    deadline = time.monotonic() + 5
    while not fake.heard and time.monotonic() < deadline:
        time.sleep(0.05)
    assert _transcript(db, key, timeout_s=0.3) is None


def test_nothing_is_sent_anywhere_while_transcription_is_off(
    client: Any, pid: str, db: psycopg.Connection[Any]
) -> None:
    fake = FakeTranscriber()
    set_transcriber(fake)
    try:
        key = _record(client, pid)
        time.sleep(0.3)
        assert fake.heard == []
        assert _transcript(db, key, timeout_s=0.1) is None
    finally:
        set_transcriber(None)


def test_a_survey_answer_spoken_is_written_down_too(
    client: Any, pid: str, db: psycopg.Connection[Any], switched_on: None
) -> None:
    set_transcriber(FakeTranscriber("teen din"))
    key = _record(client, pid, "cap-voice-s1")
    assert _transcript(db, key)
    body = {"answers": {"walk_days_week": "3"}, "recordings": {"skipped_meal_week": key},
            "capture_id": "cap-survey-t"}  # fmt: skip
    assert client.post(f"/api/app/patients/{pid}/survey", json=body).status_code == 204
    day = clinic_time.today().isoformat()
    entries = client.get(f"/api/patients/{pid}/entries?from={day}&to={day}").json()["entries"]
    spoken = {e["question_key"]: e["audio_transcript"] for e in entries if e["set"] == "survey"}
    assert spoken == {"walk_days_week": None, "skipped_meal_week": "teen din"}


def test_the_prompt_asks_for_the_words_and_nothing_else() -> None:
    prompt = transcript_prompt("ur")
    assert "Urdu script" in prompt
    assert "Do not translate, summarise, correct" in prompt


def test_a_recording_is_sent_with_its_own_type() -> None:
    assert _mime(Path("a.m4a")) == "audio/mp4"
    assert _mime(Path("a.webm")) == "audio/webm"
    assert _mime(Path("crop.png")) == "image/png"
