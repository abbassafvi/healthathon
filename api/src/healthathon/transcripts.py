"""
Spoken answers written down.

A patient who answers by speaking keeps that recording as the answer. When
`transcribe_recordings` is on, a speech recogniser also writes down what it
heard, so a clinician can read an answer at a glance. The transcript is a
machine's hearing of the recording, never the answer itself: it is stored
beside the recording, labelled as automatic wherever it is shown, and the
recording is always one tap away.

Transcription runs off the request. A recording is stored and its key
returned at once; the transcript arrives when the provider answers, or not
at all if it does not.
"""

import logging
import threading
from pathlib import Path
from typing import Protocol

from psycopg import Connection
from psycopg.rows import DictRow

from healthathon import storage
from healthathon.config import Settings, get_settings
from healthathon.db import open_pool
from healthathon.uploads.factory import build_client
from healthathon.uploads.providers import GeminiClient, ModelClient, ModelUnavailable

log = logging.getLogger(__name__)

_SCRIPTS = {"hi": "Hindi, in Devanagari", "ur": "Urdu, in Urdu script", "en": "English"}


def transcript_prompt(language: str) -> str:
    expected = _SCRIPTS.get(language, language)
    return (
        "This is a patient's spoken answer to a question from their clinic. "
        f"It is most likely in {expected}, though it may mix languages. "
        "Write down exactly the words spoken, in the script of the language each word "
        "was spoken in. Do not translate, summarise, correct, tidy or add anything, and "
        "do not describe the speaker or the sound. If nothing intelligible is said, "
        'return an empty string. Reply with JSON only: {"text": "..."}'
    )


class Transcriber(Protocol):
    @property
    def name(self) -> str: ...

    def transcribe(self, recording: Path, language: str) -> str: ...


class ModelTranscriber:
    """A multimodal model that can listen. Only Gemini is wired for audio."""

    def __init__(self, client: ModelClient) -> None:
        self._client = client

    @property
    def name(self) -> str:
        return f"{self._client.name}:{self._client.model}"

    def transcribe(self, recording: Path, language: str) -> str:
        reply = self._client.complete_json(transcript_prompt(language), [recording])
        text = reply.get("text")
        if not isinstance(text, str):
            raise ModelUnavailable("the transcript reply has no text")
        return text.strip()


_override: Transcriber | None = None


def set_transcriber(transcriber: Transcriber | None) -> None:
    """Tests install a fake here, so no test reaches a model provider."""
    global _override
    _override = transcriber


def build_transcriber(settings: Settings) -> Transcriber | None:
    if _override is not None:
        return _override if settings.transcribe_recordings else None
    if not settings.transcribe_recordings:
        return None
    client = build_client(settings)
    # The OpenAI chat protocol has no common way to send audio.
    if not isinstance(client, GeminiClient):
        return None
    return ModelTranscriber(client)


def save_transcript(
    conn: Connection[DictRow], key: str, text: str, language: str, transcriber: str
) -> None:
    conn.execute(
        "INSERT INTO pat.recording_transcript (audio_key, transcript_text, language, transcriber)"
        " VALUES (%s, %s, %s, %s) ON CONFLICT (audio_key) DO NOTHING",
        (key, text, language, transcriber),
    )


def transcribe(key: str, language: str, transcriber: Transcriber) -> None:
    """Write down one stored recording. Failures are logged and leave no transcript."""
    path = storage.resolve(key)
    if path is None:
        return
    try:
        text = transcriber.transcribe(path, language)
    except ModelUnavailable as exc:
        log.warning("recording %s: no transcript: %s", key, exc)
        return
    except Exception:  # noqa: BLE001 - a missing transcript must never fail the answer
        log.exception("recording %s: transcription failed", key)
        return
    if not text:
        return
    with open_pool().connection() as conn:
        save_transcript(conn, key, text, language, transcriber.name)


def transcribe_later(key: str, language: str) -> threading.Thread | None:
    """Start writing a recording down, if transcription is on. Returns the thread, for tests."""
    transcriber = build_transcriber(get_settings())
    if transcriber is None:
        return None
    thread = threading.Thread(target=transcribe, args=(key, language, transcriber), daemon=True)
    thread.start()
    return thread
