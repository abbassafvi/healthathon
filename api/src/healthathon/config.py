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


@lru_cache
def get_settings() -> Settings:
    return Settings()
