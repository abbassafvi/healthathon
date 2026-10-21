from typing import Any
from uuid import UUID

from fastapi import HTTPException
from psycopg import Connection
from psycopg.rows import DictRow

from healthathon import storage
from healthathon.audit import record_event
from healthathon.auth import CurrentUser
from healthathon.confirm_queue import repository as repo
from healthathon.confirm_queue.models import (
    Decision,
    DecisionResult,
    QueueDocument,
    QueueItem,
    QueuePatient,
)


def to_item(row: dict[str, Any]) -> QueueItem:
    return QueueItem(
        id=row["id"],
        reason=row["reason"],
        created_at=row["created_at"],
        analyte_code=row["analyte_code"],
        analyte_name=row["analyte_name"],
        value_text=row["value_text"],
        unit_text=row["unit_text"],
        candidate_readings=row["candidate_readings"],
        crop_url=storage.url_for(row["crop_storage_key"]),
        patient=QueuePatient(
            id=row["patient_id"],
            registration_no=row["registration_no"],
            full_name=row["full_name"],
        ),
        document=QueueDocument(
            id=row["document_id"],
            doc_type=row["doc_type"],
            document_date=row["document_date"],
        ),
    )


def decide(
    conn: Connection[DictRow], user: CurrentUser, item_id: UUID, decision: Decision
) -> DecisionResult:
    """
    Apply one reviewer decision to one queue item, in one transaction.

    Confirm moves the value to confirmed. Correct writes a replacement row
    and supersedes the original (R4: nothing is edited in place). Discard
    marks it not a clinical value. Every path resolves the item and writes
    an audit event. The crop hash recorded is computed here from the file
    the item points at, so it is the crop the reviewer was actually served.
    """
    row = repo.lock_item(conn, item_id)
    if row is None:
        raise HTTPException(404, "No such queue item")
    if row["resolved_at"] is not None or row["value_state"] != "needs_confirm":
        raise HTTPException(409, "This item has already been resolved")
    crop_sha = storage.sha256_of(row["crop_storage_key"])
    if crop_sha is None:
        # The client cannot have rendered a crop that does not exist.
        raise HTTPException(409, "The crop for this item is missing")

    value_id: UUID = row["value_id"]
    replacement_id: UUID | None = None
    old = {
        "state": row["value_state"],
        "value_text": row["value_text"],
        "unit_text": row["unit_text"],
    }

    if decision.action == "confirm":
        repo.set_value_state(conn, value_id, "confirmed")
        new: dict[str, Any] = {"state": "confirmed"}
    elif decision.action == "correct":
        assert decision.value_text is not None
        replacement_id = repo.insert_replacement(
            conn, value_id, decision.value_text.strip(), _clean(decision.unit_text)
        )
        repo.insert_correction(
            conn,
            value_id,
            replacement_id,
            user.id,
            "confirm_queue.corrected",
            crop_sha,
            decision.decision_latency_ms,
        )
        new = {
            "state": "superseded",
            "replacement_value_id": str(replacement_id),
            "value_text": decision.value_text.strip(),
            "unit_text": _clean(decision.unit_text),
        }
    else:
        repo.set_value_state(conn, value_id, "discarded")
        repo.insert_correction(
            conn,
            value_id,
            None,
            user.id,
            "confirm_queue.discarded",
            crop_sha,
            decision.decision_latency_ms,
        )
        new = {"state": "discarded"}

    repo.resolve_item(conn, item_id, user.id)
    new |= {
        "queue_item_id": str(item_id),
        "crop_sha256": crop_sha.hex(),
        "decision_latency_ms": decision.decision_latency_ms,
    }
    record_event(
        conn,
        user,
        f"value.{decision.action}",
        "core.extracted_value",
        value_id,
        old_value=old,
        new_value=new,
        reason_code=row["reason"],
    )
    return DecisionResult(
        item_id=item_id,
        action=decision.action,
        value_id=value_id,
        replacement_value_id=replacement_id,
    )


def _clean(unit: str | None) -> str | None:
    return unit.strip() or None if unit else None
