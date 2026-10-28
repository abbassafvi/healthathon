import hashlib
import json
from datetime import datetime
from typing import Any
from uuid import UUID

from psycopg import Connection
from psycopg.rows import DictRow

from healthathon.auth import CurrentUser
from healthathon.config import get_settings

# Any fixed key works; it only serialises writers to the chain.
_CHAIN_LOCK_KEY = 7_240_001


def record_event(
    conn: Connection[DictRow],
    actor: CurrentUser | None,
    action: str,
    entity_table: str,
    entity_id: UUID | None,
    old_value: dict[str, Any] | None = None,
    new_value: dict[str, Any] | None = None,
    reason_code: str | None = None,
    occurred_at: datetime | None = None,
) -> None:
    """
    Append one row to audit.event and extend the hash chain.

    actor is None for a write the patient made in the app: the patient is
    not a clinic user, and entity_id leads to the entry and so to the patient.

    this_hash = sha256(prev_hash || canonical JSON of the row). The advisory
    lock is held to the end of the transaction, so two writers cannot both
    read the same prev_hash and fork the chain.

    occurred_at is for the dev seed alone, which writes the history of what
    it seeds; every request leaves it to the database clock.
    """
    conn.execute("SELECT pg_advisory_xact_lock(%s)", (_CHAIN_LOCK_KEY,))
    last = conn.execute("SELECT this_hash FROM audit.event ORDER BY id DESC LIMIT 1").fetchone()
    prev_hash: bytes | None = bytes(last["this_hash"]) if last else None
    # Read back through the database so the time hashes as verify() will read it.
    at = conn.execute("SELECT COALESCE(%s::timestamptz, now()) AS t", (occurred_at,)).fetchone()
    occurred_at = at["t"]  # type: ignore[index]

    row = {
        "occurred_at": occurred_at.isoformat(),
        "actor_id": str(actor.id) if actor else None,
        "actor_role": actor.role if actor else None,
        "action": action,
        "entity_table": entity_table,
        "entity_id": str(entity_id) if entity_id else None,
        "old_value": old_value,
        "new_value": new_value,
        "reason_code": reason_code,
        "app_version": get_settings().app_version,
    }
    canonical = json.dumps(row, sort_keys=True, separators=(",", ":"), default=str)
    this_hash = hashlib.sha256((prev_hash or b"") + canonical.encode()).digest()

    conn.execute(
        """
        INSERT INTO audit.event (occurred_at, actor_id, actor_role, action,
            entity_table, entity_id, old_value, new_value, reason_code, app_version,
            prev_hash, this_hash)
        VALUES (%(occurred_at)s, %(actor_id)s, %(actor_role)s, %(action)s,
            %(entity_table)s, %(entity_id)s, %(old_value)s, %(new_value)s,
            %(reason_code)s, %(app_version)s,
            %(prev_hash)s, %(this_hash)s)
        """,
        {
            **row,
            "old_value": _json(old_value),
            "new_value": _json(new_value),
            "prev_hash": prev_hash,
            "this_hash": this_hash,
        },
    )


def _json(value: dict[str, Any] | None) -> str | None:
    return None if value is None else json.dumps(value, default=str)
