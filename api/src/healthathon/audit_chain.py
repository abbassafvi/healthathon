import hashlib
import json
from typing import Any

from psycopg import Connection
from psycopg.rows import DictRow


def verify(conn: Connection[DictRow]) -> dict[str, Any]:
    """
    Walk audit.event from the first row and recompute every hash. Returns
    how many rows were checked and the first row whose hash does not follow
    from the one before it, if any. The same rule record_event writes with.
    """
    prev = b""
    checked = 0
    for r in conn.execute("SELECT * FROM audit.event ORDER BY id"):
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
            "actor_id": str(r["actor_id"]) if r["actor_id"] else None,
            "actor_role": r["actor_role"],
            "entity_id": str(r["entity_id"]) if r["entity_id"] else None,
        }
        canonical = json.dumps(fields, sort_keys=True, separators=(",", ":"), default=str)
        linked = (bytes(r["prev_hash"]) if r["prev_hash"] else b"") == prev
        if (
            not linked
            or bytes(r["this_hash"]) != hashlib.sha256(prev + canonical.encode()).digest()
        ):
            return {"checked": checked, "intact": False, "first_broken_id": r["id"]}
        prev = bytes(r["this_hash"])
        checked += 1
    return {"checked": checked, "intact": True, "first_broken_id": None}
