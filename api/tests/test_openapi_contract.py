import json
from pathlib import Path

from healthathon.main import app

COMMITTED = Path(__file__).resolve().parents[1] / "openapi.json"


def test_committed_openapi_matches_the_code() -> None:
    """
    api/openapi.json is the frozen contract the clients build against. If
    this fails, the API changed: agree the change with the other track,
    then run `uv run python -m healthathon.export_openapi`.
    """
    assert json.loads(COMMITTED.read_text()) == app.openapi()
