from typing import Any

import psycopg
import pytest

from healthathon import clinic_time
from tests.helpers import patient_id

# Made here, never recorded: the first bytes of an MPEG-4 audio file and of a WebM one.
M4A = b"\x00\x00\x00\x18ftypM4A \x00\x00\x02\x00isomiso2" + b"\x00" * 64
WEBM = b"\x1a\x45\xdf\xa3" + b"\x00" * 64


@pytest.fixture
def pid(db: psycopg.Connection[Any]) -> str:
    return patient_id(db, "DEV-0001")


def _record(client: Any, pid: str, body: bytes = M4A, capture: str = "cap-voice-0001") -> Any:
    return client.post(f"/api/app/patients/{pid}/recordings?capture_id={capture}", content=body)


ANSWER = {"question_key": "felt_unwell_today", "capture_id": "cap-ans-0001"}


def _answer(client: Any, pid: str, **body: Any) -> Any:
    return client.post(f"/api/app/patients/{pid}/answers", json=ANSWER | body)


def _today_entries(client: Any, pid: str) -> list[dict[str, Any]]:
    day = clinic_time.today().isoformat()
    return list(client.get(f"/api/patients/{pid}/entries?from={day}&to={day}").json()["entries"])


def test_a_recording_is_kept_as_recorded_and_once(client: Any, pid: str) -> None:
    res = _record(client, pid)
    assert res.status_code == 200, res.text
    rec = res.json()
    assert rec["key"] == f"voice/{pid}/cap-voice-0001.m4a"
    served = client.get(rec["uri"])
    assert served.content == M4A and served.headers["content-type"] == "audio/mp4"
    assert _record(client, pid).json() == rec
    assert _record(client, pid, WEBM, "cap-voice-0002").json()["key"].endswith(".webm")


def test_only_audio_of_a_bounded_size_is_kept(client: Any, pid: str) -> None:
    assert _record(client, pid, b"not audio at all, just text").status_code == 415
    assert _record(client, pid, M4A + b"\x00" * (5 * 1024 * 1024)).status_code == 413
    assert client.post(f"/api/app/patients/{pid}/recordings", content=M4A).status_code == 422


def test_a_spoken_answer_is_kept_without_words_and_not_transcribed_by_default(
    client: Any, pid: str
) -> None:
    key = _record(client, pid).json()["key"]
    assert _answer(client, pid, audio_key=key).status_code == 204
    today = client.get(f"/api/app/patients/{pid}/today").json()
    assert today["answer"] is None and today["answer_audio_uri"] == f"/api/storage/{key}"
    [entry] = [e for e in _today_entries(client, pid) if e["kind"] == "survey_answer"]
    assert (entry["answer_text"], entry["audio_url"]) == (None, f"/api/storage/{key}")
    # Transcription is off unless switched on: the voice stays at the clinic.
    assert entry["audio_transcript"] is None and today["answer_transcript"] is None


def test_a_tap_can_carry_a_recording(client: Any, pid: str) -> None:
    key = _record(client, pid).json()["key"]
    assert _answer(client, pid, answer_text="No", audio_key=key).status_code == 204
    [entry] = [e for e in _today_entries(client, pid) if e["kind"] == "survey_answer"]
    assert (entry["answer_text"], entry["audio_url"]) == ("No", f"/api/storage/{key}")


def test_an_answer_needs_words_or_a_recording_from_this_phone(
    client: Any, pid: str, db: psycopg.Connection[Any]
) -> None:
    assert _answer(client, pid).status_code == 422
    assert _answer(client, pid, answer_text="   ").status_code == 422
    other = patient_id(db, "DEV-0002")
    theirs = _record(client, other, capture="cap-voice-0009").json()["key"]
    assert _answer(client, pid, audio_key=theirs).status_code == 422
    missing = f"voice/{pid}/cap-voice-never.m4a"
    assert _answer(client, pid, audio_key=missing).status_code == 422
    assert _answer(client, pid, audio_key="meals/../../etc/passwd").status_code == 422


def test_the_survey_takes_a_recording_for_any_question(client: Any, pid: str) -> None:
    key = _record(client, pid).json()["key"]
    url = f"/api/app/patients/{pid}/survey"
    body = {"answers": {"walk_days_week": "3"}, "recordings": {"skipped_meal_week": key},
            "capture_id": "cap-survey-voice"}  # fmt: skip
    assert client.post(url, json=body).status_code == 204
    answers = {e["question_key"]: e for e in _today_entries(client, pid) if e["set"] == "survey"}
    walk, skipped = answers["walk_days_week"], answers["skipped_meal_week"]
    assert (walk["answer_text"], walk["audio_url"]) == ("3", None)
    assert (skipped["answer_text"], skipped["audio_url"]) == (None, f"/api/storage/{key}")


def test_the_survey_still_needs_every_question_answered_somehow(client: Any, pid: str) -> None:
    key = _record(client, pid).json()["key"]
    url = f"/api/app/patients/{pid}/survey"
    for bad in (
        {"answers": {"walk_days_week": "3"}},
        {"answers": {"walk_days_week": "3", "skipped_meal_week": " "}},
        {"answers": {"walk_days_week": "3"}, "recordings": {"not_a_question": key}},
    ):
        assert client.post(url, json=bad | {"capture_id": "cap-survey-bad"}).status_code == 422, bad


def test_earlier_days_give_back_the_recording(
    client: Any, pid: str, db: psycopg.Connection[Any]
) -> None:
    key = _record(client, pid).json()["key"]
    _answer(client, pid, audio_key=key)
    # Earlier days are the days before today: move the answer to yesterday.
    db.execute(
        "UPDATE pat.entry SET occurred_at = occurred_at - interval '1 day'"
        " WHERE client_capture_id = 'cap-ans-0001'"
    )
    page = client.get(f"/api/app/patients/{pid}/days?count=1").json()
    spoken = [a for a in page["days"][0]["answers"] if a["audio_uri"]]
    assert [(a["answer_text"], a["audio_uri"]) for a in spoken] == [(None, f"/api/storage/{key}")]
