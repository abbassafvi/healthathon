import os
import re
from collections.abc import Iterator
from pathlib import Path
from typing import Any
from uuid import UUID

import psycopg
import pytest
from psycopg.rows import dict_row

ADMIN_URL = os.environ.get(
    "HEALTHATHON_ADMIN_URL",
    "postgresql://healthathon:healthathon@127.0.0.1:5434/healthathon",
)
TEST_DB = "healthathon_test"
TEST_URL = ADMIN_URL.rsplit("/", 1)[0] + "/" + TEST_DB

os.environ["HEALTHATHON_DATABASE_URL"] = TEST_URL

# A developer's api/.env is read by Settings, so without this the suite
# would run on whatever model, reader and threshold that file happens to
# name. Environment variables beat the file, so the tests pin what they
# depend on and behave the same on every machine.
os.environ.update(
    {
        "HEALTHATHON_DETECTOR": "stub",
        "HEALTHATHON_AGENT_PROVIDER": "none",
        "HEALTHATHON_AGENT_API_KEY": "",
        "HEALTHATHON_AGENT_READS": "3",
        "HEALTHATHON_AGENT_MAX_CROPS_PER_CALL": "12",
        "HEALTHATHON_CONFIDENCE_THRESHOLD": "1.0",
        "HEALTHATHON_LEGIBILITY_MIN_SHARPNESS": "1450.0",
        # Inbound voice is off by default, because no provider is chosen.
        # The tests that cover it set the key, so the refusal is covered too.
        "HEALTHATHON_VOICE_GATEWAY_KEY": "dev-only-voice-key",
        "HEALTHATHON_TRANSCRIBE_RECORDINGS": "false",
        # Pinned for the same reason as the rest: a developer's own .env
        # must not change what the suite tests. Each door gets its own.
        "HEALTHATHON_SMS_GATEWAY_KEY": "dev-only-gateway-key",
        # The clinic cannot ring out unless a test asks for it. A developer
        # with real Exotel credentials in their .env must not turn the
        # suite's "outbound is off" cases into something else, and must
        # never have a test reach a telephone provider.
        "HEALTHATHON_EXOTEL_ACCOUNT_SID": "",
        "HEALTHATHON_EXOTEL_API_KEY": "",
        "HEALTHATHON_EXOTEL_API_TOKEN": "",
        "HEALTHATHON_EXOTEL_FROM": "",
        "HEALTHATHON_EXOTEL_FLOW_ID": "",
        "HEALTHATHON_PHONE_ENCRYPTION_KEY": "",
    }
)


@pytest.fixture(scope="session")
def storage_dir(tmp_path_factory: pytest.TempPathFactory) -> Path:
    path = tmp_path_factory.mktemp("storage")
    os.environ["HEALTHATHON_STORAGE_DIR"] = str(path)
    return path


@pytest.fixture(scope="session")
def database(storage_dir: Path) -> Iterator[str]:
    """A fresh database built from db/schema.sql, once per test session."""
    from dev_seed.create_db import recreate
    from healthathon.config import get_settings

    recreate(TEST_DB)

    get_settings.cache_clear()
    yield TEST_URL
    from healthathon.db import close_pool

    close_pool()


@pytest.fixture
def db(database: str, storage_dir: Path) -> Iterator[psycopg.Connection[Any]]:
    """Every test starts from the same freshly seeded state."""
    from dev_seed.__main__ import _truncate, seed
    from healthathon.config import get_settings

    with psycopg.connect(database, row_factory=dict_row, autocommit=True) as conn:
        with conn.transaction():
            _truncate(conn)
            seed(conn, storage_dir, get_settings().stub_user_email)
        yield conn


_APP_PATIENT = re.compile(r"^/api/app/patients/([0-9a-f-]{36})(/|$)")


def _signed_in_as_the_path(request: Any) -> None:
    """
    A request to /api/app/patients/{id}/... carries a token for that patient,
    as the patient's own phone would, unless the test set one itself. The
    sign-in tests use `unsigned_client` to see what happens without one.
    """
    from healthathon.patient_app import signin

    m = _APP_PATIENT.match(request.url.path)
    if m and "authorization" not in request.headers:
        request.headers["Authorization"] = f"Bearer {signin.token_for(UUID(m.group(1)))}"


@pytest.fixture
def auto_accept() -> Iterator[None]:
    """
    Let the checks settle a prescription line without a clinician.

    Off by default, agreed in review on PR 12: no check reads the drug
    name and nothing measures the reader yet. The tests that are about
    the settling path ask for it; the rest see the shipped default.
    """
    from healthathon.config import get_settings

    settings = get_settings()
    was = settings.auto_accept_lines
    settings.auto_accept_lines = True
    yield
    settings.auto_accept_lines = was


@pytest.fixture
def unsigned_client(db: psycopg.Connection[Any]) -> Iterator[Any]:
    from fastapi.testclient import TestClient

    from healthathon.main import app
    from healthathon.patient_app import signin

    signin.reset()
    with TestClient(app) as c:
        yield c


@pytest.fixture
def client(unsigned_client: Any) -> Any:
    unsigned_client.event_hooks["request"].append(_signed_in_as_the_path)
    return unsigned_client
