import base64
import hashlib
import hmac
import os
import re

from healthathon.config import get_settings

# A phone number is recognised by its HMAC and shown by its last four
# digits, so the clinic can tell whose phone sent something without
# keeping the number itself. That is enough for everything the patient
# starts: an SMS, a call they make.
#
# Ringing a patient is the one thing it is not enough for, because a
# dialler needs the number back. `seal` is for that and only that: the
# number encrypted under a key that lives outside the database, so a
# dump of the database on its own still yields no phone numbers. The
# HMAC stays the way every lookup is done; nothing searches on the
# sealed copy.


def normalise(phone: str, default_country: str = "91") -> str | None:
    """Digits with the country code, e.g. '919876543210'. None if it is not a phone number."""
    digits = re.sub(r"[\s().-]", "", phone)
    if digits.startswith("+"):
        digits = digits[1:]
    elif digits.startswith("00"):
        digits = digits[2:]
    elif len(digits) == 10:
        digits = default_country + digits
    elif len(digits) == 11 and digits.startswith("0"):
        digits = default_country + digits[1:]
    return digits if re.fullmatch(r"\d{10,15}", digits) else None


def phone_hmac(normalised: str) -> bytes:
    key = get_settings().phone_hmac_key.encode()
    return hmac.new(key, normalised.encode(), hashlib.sha256).digest()


# AES-GCM, so a tampered ciphertext fails to open rather than decrypting
# to something else. The nonce is stored in front of the ciphertext.
_NONCE_BYTES = 12


def _box_key() -> bytes | None:
    """The key numbers are sealed under, or None when sealing is off."""
    raw = get_settings().phone_encryption_key
    if not raw:
        return None
    key = base64.b64decode(raw)
    if len(key) != 32:
        raise ValueError("phone_encryption_key must be 32 bytes, base64 encoded")
    return key


def can_seal() -> bool:
    """Whether a number can be sealed at all. False means outbound is off."""
    return _box_key() is not None


def seal(normalised: str) -> bytes | None:
    """
    The number, encrypted for dialling later. None when sealing is off.

    Off is the default: a clinic that never rings a patient should not be
    holding their number in a form anything can read.
    """
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    key = _box_key()
    if key is None:
        return None
    nonce = os.urandom(_NONCE_BYTES)
    return nonce + AESGCM(key).encrypt(nonce, normalised.encode(), None)


def unseal(blob: bytes | None) -> str | None:
    """
    The number back, to dial it. None when there is none, or it will not
    open: a wrong key or a tampered ciphertext gives nothing, never a
    wrong number to ring.
    """
    from cryptography.exceptions import InvalidTag
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    key = _box_key()
    if key is None or not blob or len(blob) <= _NONCE_BYTES:
        return None
    try:
        plain = AESGCM(key).decrypt(bytes(blob[:_NONCE_BYTES]), bytes(blob[_NONCE_BYTES:]), None)
    except InvalidTag:
        return None
    return plain.decode()
