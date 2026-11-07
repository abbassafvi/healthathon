"""
A spoken answer left on a call, fetched and kept as recorded.

Exotel does not hand over the audio. It hands over a URL, and says the
recording takes 5 to 20 minutes to become available depending on its
length, so there is nothing to fetch while the webhook is still open.
The fetch therefore happens afterwards, waiting and trying again, and
**nothing is stored until the audio is in hand**. A half-stored answer
pointing at a recording that never arrived would be worse than no answer
at all: the clinician would see that the patient said something and be
unable to hear it.

Fetching a URL that arrived in a query parameter is how a service is
talked into reaching inside its own network, so the host is checked
against a configured list first and nothing else is fetched. The list is
empty by default, which turns spoken answers by phone off until a real
call shows what the recording host actually is.
"""

import logging
import threading
import time
from urllib.parse import urlparse
from uuid import UUID

import httpx

from healthathon import storage
from healthathon.config import get_settings
from healthathon.db import open_pool
from healthathon.voice import service
from healthathon.voice.models import VoiceStep

log = logging.getLogger(__name__)

MAX_RECORDING_BYTES = 5 * 1024 * 1024

# What a provider sends. MP3 is Exotel's; the rest match what the phone
# app records, so one storage convention covers both doors.
_AUDIO_TYPES: list[tuple[int, bytes, str]] = [
    (0, b"ID3", "mp3"),
    (0, b"\xff\xfb", "mp3"),
    (0, b"\xff\xf3", "mp3"),
    (4, b"ftyp", "m4a"),
    (0, b"\x1a\x45\xdf\xa3", "webm"),
    (0, b"OggS", "ogg"),
    (8, b"WAVE", "wav"),
]


def host_allowed(url: str) -> bool:
    """Whether this URL's host is one a recording may be fetched from."""
    allowed = get_settings().voice_recording_hosts
    if not allowed:
        return False
    try:
        parsed = urlparse(url)
    except ValueError:
        return False
    # Only https, and only the exact host. A suffix match would let
    # "exotel.com.attacker.example" through.
    return parsed.scheme == "https" and parsed.hostname in allowed


def _extension(body: bytes) -> str | None:
    return next((e for at, magic, e in _AUDIO_TYPES if body[at : at + len(magic)] == magic), None)


def fetch(url: str, client: httpx.Client | None = None) -> bytes | None:
    """
    The recording, once the provider has it. None when it never arrived.

    Waits between tries because the provider needs minutes to make a
    recording available, and a 404 early on means "not yet" rather than
    "never".
    """
    settings = get_settings()
    owned = client is None
    client = client or httpx.Client(timeout=30.0, follow_redirects=False)
    try:
        for attempt in range(max(settings.voice_recording_tries, 1)):
            try:
                reply = client.get(url)
                if reply.status_code == 200 and reply.content:
                    return bytes(reply.content[:MAX_RECORDING_BYTES])
            except httpx.HTTPError as exc:
                log.warning("voice recording: %s", exc)
            if attempt + 1 < settings.voice_recording_tries:
                time.sleep(settings.voice_recording_wait_s)
        return None
    finally:
        if owned:
            client.close()


def store_when_ready(step: VoiceStep, url: str) -> None:
    """Fetch the recording off the request, then store the answer."""
    threading.Thread(target=collect, args=(step, url), daemon=True).start()


def collect(step: VoiceStep, url: str, client: httpx.Client | None = None) -> bool:
    """
    Fetch, keep, and store the answer. True when the answer was stored.

    Its own connection: the webhook that started this has long since
    answered, and the wait is measured in minutes.
    """
    if not host_allowed(url):
        log.warning("voice recording: refused a host that is not allowed")
        return False
    body = fetch(url, client)
    if body is None:
        log.warning("voice recording for call %s never became available", step.call_id)
        return False
    ext = _extension(body)
    if ext is None:
        log.warning("voice recording for call %s was not audio", step.call_id)
        return False

    with open_pool().connection() as conn:
        patient = _patient(conn, step)
        if patient is None:
            return False
        key = f"voice/{patient}/{step.call_id}-{step.provider_ref or step.step}.{ext}"
        if storage.resolve(key) is None:
            storage.save(key, body)
        out = service.handle(conn, step.model_copy(update={"audio_key": key}))
        return bool(out.stored)


def _patient(conn: object, step: VoiceStep) -> UUID | None:
    """Whose phone this is, so the recording is kept under their own key."""
    from healthathon import phones
    from healthathon.inbound import store

    number = phones.normalise(step.from_)
    found = store.patient_for(conn, number) if number else None  # type: ignore[arg-type]
    return UUID(str(found["id"])) if found else None
