import hashlib
import json
from typing import Any

import psycopg

DEMO = "Dr. Demo Clinician"


def queue_item_for(client: Any, registration_no: str, analyte: str) -> dict[str, Any]:
    items = client.get("/api/confirm-queue").json()["items"]
    for item in items:
        if (
            item["patient"]["registration_no"] == registration_no
            and item["analyte_code"] == analyte
        ):
            return dict(item)
    raise AssertionError(f"no queue item for {registration_no}/{analyte}")


def decide(client: Any, item_id: str, **body: Any) -> dict[str, Any]:
    res = client.post(
        f"/api/confirm-queue/{item_id}/decision", json={"decision_latency_ms": 1200, **body}
    )
    assert res.status_code == 200, res.text
    return dict(res.json())


def patient_id(db: psycopg.Connection[Any], registration_no: str) -> str:
    row = db.execute(
        "SELECT id FROM core.patient WHERE registration_no = %s", (registration_no,)
    ).fetchone()
    return str(row["id"])


def value_id(db: psycopg.Connection[Any], registration_no: str, analyte: str, state: str) -> str:
    row = db.execute(
        """SELECT ev.id FROM core.extracted_value ev JOIN core.patient p ON p.id = ev.patient_id
           WHERE p.registration_no = %s AND ev.analyte_code = %s AND ev.state = %s""",
        (registration_no, analyte, state),
    ).fetchone()
    assert row is not None, f"no {state} {analyte} for {registration_no}"
    return str(row["id"])


def verify_audit_chain(db: psycopg.Connection[Any]) -> list[dict[str, Any]]:
    """Walk audit.event and check every hash links to the one before it."""
    rows = db.execute("SELECT * FROM audit.event ORDER BY id").fetchall()
    prev = b""
    for r in rows:
        fields = {
            k: r[k]
            for k in (
                "action",
                "entity_table",
                "reason_code",
                "app_version",
                "old_value",
                "new_value",
            )
        }
        fields |= {
            "occurred_at": r["occurred_at"].isoformat(),
            "actor_id": str(r["actor_id"]),
            "actor_role": r["actor_role"],
            "entity_id": str(r["entity_id"]) if r["entity_id"] else None,
        }
        canonical = json.dumps(fields, sort_keys=True, separators=(",", ":"), default=str)
        assert (bytes(r["prev_hash"]) if r["prev_hash"] else b"") == prev
        assert bytes(r["this_hash"]) == hashlib.sha256(prev + canonical.encode()).digest()
        prev = bytes(r["this_hash"])
    return list(rows)
