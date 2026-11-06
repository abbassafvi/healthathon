from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field


class QueueReason(BaseModel):
    reason: str = Field(description="The check that sent these values to a person")
    count: int


class UploadOutcome(BaseModel):
    document_id: UUID
    values_in_record: int = Field(
        description="Values that passed every check and are in the record"
    )
    sent_to_queue: list[QueueReason] = Field(description="Values waiting for a person, by reason")
    regimen_id: UUID | None = Field(
        description="For a prescription: the regimen this document produced"
    )
    lines_accepted: int = Field(
        default=0, description="Prescription lines every check passed, settled without a person"
    )
    lines_for_a_person: int = Field(
        default=0, description="Prescription lines a clinician still has to confirm"
    )


class UploadStatus(BaseModel):
    id: str
    stage: Literal["uploading", "reading", "done", "duplicate", "failed"]
    outcome: UploadOutcome | None
    failure: str | None
