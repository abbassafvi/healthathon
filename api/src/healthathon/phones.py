import hashlib
import hmac
import re

from healthathon.config import get_settings

# Phone numbers are never stored, only an HMAC and the last four digits,
# so the clinic can recognise a sender without keeping the number.


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
