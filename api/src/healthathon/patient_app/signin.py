"""
Patient sign-in: a code sent by SMS to the phone the clinic has on record.

Codes go through Twilio Verify when its keys are set. Without them sign-in
runs in test mode, for development and the demonstration: the code is
returned to the sign-in screen and written to the log. Either way a code is
sent only to a number already on a patient's record, so the endpoint cannot
be used to text strangers, and it answers the same whether or not the
number is known.

A signed-in phone holds a token: the patient id and an expiry, signed with
the server's secret. Every /api/app/patients/{id} route checks it.
"""

import base64
import hashlib
import hmac
import json
import logging
import secrets
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any
from uuid import UUID

from fastapi import HTTPException

from healthathon.config import get_settings

log = logging.getLogger(__name__)

CODE_SECONDS = 10 * 60
MAX_TRIES = 5

_lock = threading.Lock()
# Test mode: normalised phone -> (sha256 of the code, expiry, wrong tries left).
_codes: dict[str, tuple[bytes, float, int]] = {}
# Both modes: normalised phone -> when codes were sent in the last hour.
_sends: dict[str, list[float]] = {}


def twilio_configured() -> bool:
    s = get_settings()
    return bool(s.twilio_account_sid and s.twilio_auth_token and s.twilio_verify_sid)


def send_code(phone: str) -> str | None:
    """
    Send a sign-in code to a normalised number on a patient's record. Returns
    the code in test mode, so the screen can show it, and None with Twilio.
    """
    now = time.time()
    with _lock:
        recent = [t for t in _sends.get(phone, []) if now - t < 3600]
        if len(recent) >= get_settings().otp_sends_per_hour:
            raise HTTPException(429, "Too many codes for this number. Try again in an hour.")
        _sends[phone] = [*recent, now]
    if twilio_configured():
        _twilio("Verifications", {"To": f"+{phone}", "Channel": "sms"})
        return None
    code = get_settings().otp_test_code or f"{secrets.randbelow(10**6):06d}"
    with _lock:
        _codes[phone] = (hashlib.sha256(code.encode()).digest(), now + CODE_SECONDS, MAX_TRIES)
    log.warning("Sign-in is in test mode. Code for the number ending %s: %s", phone[-4:], code)
    return code


def check_code(phone: str, code: str) -> bool:
    """Whether the code is the one sent to this number, and still good."""
    if twilio_configured():
        try:
            res = _twilio("VerificationCheck", {"To": f"+{phone}", "Code": code})
        except HTTPException:
            return False
        return res.get("status") == "approved"
    with _lock:
        held = _codes.get(phone)
        if held is None:
            return False
        digest, expires, tries = held
        if time.time() > expires or tries <= 0:
            _codes.pop(phone, None)
            return False
        if hmac.compare_digest(digest, hashlib.sha256(code.encode()).digest()):
            _codes.pop(phone, None)
            return True
        _codes[phone] = (digest, expires, tries - 1)
        return False


def token_for(patient_id: UUID) -> str:
    exp = int(time.time()) + get_settings().session_days * 86400
    payload = _b64(f"{patient_id}:{exp}".encode())
    return f"{payload}.{_b64(_sign(payload))}"


def patient_for(token: str) -> UUID | None:
    """The patient a token was issued to, or None if it is forged, damaged or expired."""
    try:
        payload, sig = token.split(".")
        if not hmac.compare_digest(_unb64(sig), _sign(payload)):
            return None
        pid, exp = _unb64(payload).decode().split(":")
        return UUID(pid) if int(exp) > time.time() else None
    except (ValueError, UnicodeDecodeError):
        return None


def reset() -> None:
    """Forget every code and send; for tests."""
    with _lock:
        _codes.clear()
        _sends.clear()


def _twilio(path: str, data: dict[str, str]) -> dict[str, Any]:
    s = get_settings()
    url = f"https://verify.twilio.com/v2/Services/{s.twilio_verify_sid}/{path}"
    req = urllib.request.Request(url, data=urllib.parse.urlencode(data).encode(), method="POST")
    basic = base64.b64encode(f"{s.twilio_account_sid}:{s.twilio_auth_token}".encode()).decode()
    req.add_header("Authorization", f"Basic {basic}")
    try:
        with urllib.request.urlopen(req, timeout=10) as res:  # noqa: S310 (a fixed https URL)
            body: dict[str, Any] = json.loads(res.read())
            return body
    except (urllib.error.URLError, TimeoutError, ValueError) as e:
        log.error("Twilio Verify %s failed: %s", path, e)
        raise HTTPException(503, "Codes cannot be sent right now. Try again shortly.") from e


def _sign(payload: str) -> bytes:
    return hmac.new(
        get_settings().session_secret.encode(), payload.encode(), hashlib.sha256
    ).digest()


def _b64(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def _unb64(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))
