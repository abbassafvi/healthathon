import hashlib
import json
from typing import Any

import psycopg


def _canonical(row: dict[str, Any]) -> bytes:
    fields = {
        k: row[k]
        for k in ("action", "entity_table", "reason_code", "app_version", "old_value", "new_value")
    }
    fields |= {
        "occurred_at": row["occurred_at"].isoformat(),
        "actor_id": str(row["actor_id"]),
        "actor_role": row["actor_role"],
        "entity_id": str(row["entity_id"]) if row["entity_id"] else None,
    }
    return json.dumps(fields, sort_keys=True, separators=(",", ":"), default=str).encode()


def test_every_decision_is_audited_and_the_chain_verifies(
    client: Any, db: psycopg.Connection[Any]
) -> None:
    items = client.get("/api/confirm-queue").json()["items"]
    for item, action in zip(items[:3], ["confirm", "discard", "correct"], strict=True):
        body: dict[str, Any] = {"action": action, "decision_latency_ms": 900}
        if action == "correct":
            body["value_text"] = "7.4"
        assert client.post(f"/api/confirm-queue/{item['id']}/decision", json=body).is_success

    rows = db.execute("SELECT * FROM audit.event ORDER BY id").fetchall()
    assert [r["action"] for r in rows] == ["value.confirm", "value.discard", "value.correct"]
    prev = b""
    for r in rows:
        assert (bytes(r["prev_hash"]) if r["prev_hash"] else b"") == prev
        assert bytes(r["this_hash"]) == hashlib.sha256(prev + _canonical(r)).digest()
        assert r["new_value"]["decision_latency_ms"] == 900
        prev = bytes(r["this_hash"])


def test_schema_guardrail_has_no_violations(db: psycopg.Connection[Any]) -> None:
    assert db.execute("SELECT * FROM audit.schema_guardrail_violations").fetchall() == []
