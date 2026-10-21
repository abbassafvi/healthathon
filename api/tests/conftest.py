import os
from collections.abc import Iterator
from pathlib import Path
from typing import Any

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


@pytest.fixture
def client(db: psycopg.Connection[Any]) -> Iterator[Any]:
    from fastapi.testclient import TestClient

    from healthathon.main import app

    with TestClient(app) as c:
        yield c
