from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel

Kind = Literal["decision", "read", "patient"]


class ChainCheck(BaseModel):
    """The result of recomputing every hash in audit.event, oldest first."""

    checked: int
    intact: bool
    first_broken_id: int | None


class AuditPatient(BaseModel):
    id: UUID
    registration_no: str
    full_name: str


class AuditEntry(BaseModel):
    id: int
    occurred_at: datetime
    action: str
    kind: Kind
    # None for a write the patient made: the patient is not a clinic user.
    actor_name: str | None
    actor_role: str | None
    patient: AuditPatient | None
    reason_code: str | None
    decision_latency_ms: int | None


class AuditLog(BaseModel):
    chain: ChainCheck
    entries: list[AuditEntry]
    # Pass as `before` for the next, older page; None at the oldest.
    next_before: int | None
