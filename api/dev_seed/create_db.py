"""
Drop and recreate a database from db/schema.sql. For test and e2e
databases only; it refuses a name that does not end in _test or _e2e.

    uv run python -m dev_seed.create_db healthathon_e2e
"""

import os
import sys
from pathlib import Path

import psycopg

SCHEMA = Path(__file__).resolve().parents[2] / "db" / "schema.sql"
ADMIN_URL = os.environ.get(
    "HEALTHATHON_ADMIN_URL", "postgresql://healthathon:healthathon@127.0.0.1:5434/healthathon"
)


def recreate(name: str) -> str:
    if not name.endswith(("_test", "_e2e")) or not name.replace("_", "").isalnum():
        raise SystemExit(f"Refusing to recreate {name!r}: only *_test or *_e2e databases.")
    with psycopg.connect(ADMIN_URL, autocommit=True) as admin:
        admin.execute(f"DROP DATABASE IF EXISTS {name} WITH (FORCE)")
        admin.execute(f"CREATE DATABASE {name}")
    url = ADMIN_URL.rsplit("/", 1)[0] + "/" + name
    with psycopg.connect(url, autocommit=True) as conn:
        conn.execute(SCHEMA.read_text())  # type: ignore[call-overload]
    return url


if __name__ == "__main__":
    print(recreate(sys.argv[1] if len(sys.argv) > 1 else "healthathon_e2e"))
