from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel, Field, model_validator

from healthathon.record.models import Box

# A regimen item is shown exactly as printed. Nothing is mapped to a drug
# vocabulary, normalised or checked against a dose.


class DocumentRef(BaseModel):
    id: UUID
    document_date: date | None
    issuing_source: str | None


class PageRef(BaseModel):
    url: str
    width_px: int
    height_px: int


class RegimenItem(BaseModel):
    id: UUID
    drug_text: str
    dose_text: str
    schedule_text: str | None
    box: Box
    crop_url: str
    confirmed_by_name: str | None
    confirmed_at: datetime | None
    # What the deterministic layer made of this line. accepted_at is set
    # when every check it ran passed, and is never a substitute for a
    # clinician's name: a line can be accepted and later confirmed.
    accepted_at: datetime | None = None
    checks_passed: int = 0
    checks_ran: int = 0
    failed_check: str | None = None


class RegimenAdvice(BaseModel):
    """An instruction that is not a medicine. Never counted as a dose."""

    id: UUID
    advice_text: str
    box: Box
    crop_url: str
    accepted_at: datetime | None = None
    confirmed_by_name: str | None = None
    confirmed_at: datetime | None = None


class ActiveRegimen(BaseModel):
    id: UUID
    activated_at: datetime
    activated_by_name: str
    source_document: DocumentRef
    items: list[RegimenItem]
    advice: list[RegimenAdvice] = []


class AwaitingReview(BaseModel):
    regimen_id: UUID
    document: DocumentRef
    item_count: int
    # Lines a named clinician confirmed. Never counts a line the checks
    # settled: the record must not say a person looked at one.
    confirmed_count: int
    # Lines that need nobody else, whether a person confirmed them or
    # every check on them passed. This is what says how far review has
    # to go, and what activation needs.
    settled_count: int = 0


class Checklist(BaseModel):
    active: ActiveRegimen | None
    awaiting_review: list[AwaitingReview]


class ReviewPatient(BaseModel):
    id: UUID
    registration_no: str
    full_name: str


class Replaces(BaseModel):
    activated_at: datetime
    item_count: int


class RegimenReview(BaseModel):
    regimen_id: UUID
    patient: ReviewPatient
    document: DocumentRef
    page: PageRef
    items: list[RegimenItem]
    advice: list[RegimenAdvice] = []
    # The checklist activation would replace, if there is one.
    replaces: Replaces | None
    activated_at: datetime | None


class ItemDecision(BaseModel):
    """
    A reviewer's confirmation of one line. The text fields are present only
    when the reviewer corrected what was read; the original stays in the
    audit log.
    """

    decision_latency_ms: int = Field(ge=0)
    drug_text: str | None = Field(default=None, max_length=200)
    dose_text: str | None = Field(default=None, max_length=100)
    schedule_text: str | None = Field(default=None, max_length=100)

    @model_validator(mode="after")
    def no_blank_correction(self) -> "ItemDecision":
        for name in ("drug_text", "dose_text"):
            if name in self.model_fields_set and not (getattr(self, name) or "").strip():
                raise ValueError(f"{name} cannot be empty")
        return self


class Activated(BaseModel):
    activated_at: datetime
