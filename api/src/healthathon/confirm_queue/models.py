from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, model_validator

ConfirmReason = Literal[
    "no_region_on_page",
    "readers_disagree",
    "conflicting_documents",
    "unknown_unit",
    "outside_assay_range",
    "implausible_date",
    "region_illegible",
    "handwritten",
    "script_not_read",
]


class CandidateReading(BaseModel):
    value_text: str
    unit_text: str | None = None


class QueuePatient(BaseModel):
    id: UUID
    registration_no: str
    full_name: str


class QueueDocument(BaseModel):
    id: UUID
    doc_type: str
    document_date: date | None


class QueueItem(BaseModel):
    """One open item. The value is shown as read, next to the crop it came from."""

    id: UUID
    reason: ConfirmReason
    created_at: datetime
    analyte_code: str
    analyte_name: str
    value_text: str
    unit_text: str | None
    candidate_readings: list[CandidateReading]
    crop_url: str
    patient: QueuePatient
    document: QueueDocument


class QueueList(BaseModel):
    items: list[QueueItem]
    open_count: int


class Decision(BaseModel):
    """
    What a reviewer decided about one item.

    decision_latency_ms runs from the moment the crop finished rendering to
    the decision. The client cannot send a decision before that moment.
    """

    action: Literal["confirm", "correct", "discard"]
    decision_latency_ms: int = Field(ge=0)
    value_text: str | None = Field(default=None, min_length=1, max_length=200)
    unit_text: str | None = Field(default=None, max_length=50)

    @model_validator(mode="after")
    def correction_needs_value(self) -> "Decision":
        if self.action == "correct" and not (self.value_text and self.value_text.strip()):
            raise ValueError("a correction needs value_text")
        if self.action != "correct" and (self.value_text or self.unit_text):
            raise ValueError("only a correction carries a value")
        return self


class DecisionResult(BaseModel):
    item_id: UUID
    action: str
    value_id: UUID
    replacement_value_id: UUID | None
