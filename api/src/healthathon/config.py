from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration, read from HEALTHATHON_* environment variables."""

    model_config = SettingsConfigDict(env_prefix="HEALTHATHON_", env_file=".env")

    database_url: str = "postgresql://healthathon:healthathon@127.0.0.1:5434/healthathon"
    # Root for page images and crops. Never committed; see .gitignore.
    storage_dir: Path = Path(__file__).resolve().parents[3] / "storage"
    # The scope has one hardcoded user and no login. This is that user.
    stub_user_email: str = "demo.clinician@example.org"
    app_version: str = "0.1.0"
    # Dates the patient sees ("today", a tick's day, a paper form's week) are
    # days in the clinic's time zone, whatever the server's clock says.
    clinic_timezone: str = "Asia/Kolkata"
    # Browser origins allowed to call the API: the patient app's web build
    # in development and tests. The clinic app is served through the Vite
    # proxy and the Android app is not a browser, so neither needs this.
    # Set as JSON, e.g. HEALTHATHON_CORS_ORIGINS='["http://127.0.0.1:8091"]'.
    cors_origins: list[str] = ["http://localhost:8081", "http://127.0.0.1:8081"]
    # Phone numbers are stored only as an HMAC with this key (core.patient_phone).
    # The defaults are for development; set real values outside it, never in git.
    phone_hmac_key: str = "dev-only-phone-key"
    # The SMS gateway stand-in sends this in X-Gateway-Key.
    sms_gateway_key: str = "dev-only-gateway-key"
    # Patient sign-in by a code sent by SMS. With all three Twilio values set,
    # codes go through Twilio Verify. Without them sign-in is in test mode: the
    # code is shown on the sign-in screen and written to the log, which is for
    # development and the demonstration only. Set them outside git, never in it.
    twilio_account_sid: str | None = None
    twilio_auth_token: str | None = None
    twilio_verify_sid: str | None = None
    # Test mode only: a fixed code instead of a random one, for automated tests.
    otp_test_code: str | None = None
    # Signs the patient app's session tokens. Set a long random value outside development.
    session_secret: str = "dev-only-session-secret"
    session_days: int = 30
    # Codes one number may be sent in an hour. Browser tests sign in on the same numbers all day.
    otp_sends_per_hour: int = 5


@lru_cache
def get_settings() -> Settings:
    return Settings()
