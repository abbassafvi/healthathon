from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel


class PatientSummary(BaseModel):
    id: UUID
    registration_no: str
    full_name: str
    year_of_birth: int | None
    sex: str | None
    # The language the patient reads and writes in (BCP-47).
    preferred_language: str


class Caregiver(BaseModel):
    full_name: str
    relationship: str | None


class PatientListItem(PatientSummary):
    """
    One row of the patient list: who the patient is, and what the record
    holds now. Counts and dates of the record only, never a judgement.
    """

    enrolled_at: datetime
    caregiver: Caregiver | None
    last_visit: datetime | None
    next_visit: datetime | None
    # The checklist in force: when it came into force and how many medicines.
    checklist_since: datetime | None
    checklist_medicines: int
    # Values in the confirm queue, and prescription lines waiting for review.
    waiting_values: int
    waiting_lines: int
    documents: int
    last_entry_at: datetime | None


class RecordValue(BaseModel):
    """A renderable value, exactly as printed. Nothing derived is attached."""

    id: UUID
    analyte_code: str
    analyte_name: str
    value_text: str
    unit_text: str | None
    observed_at: date | None


class DocumentInfo(BaseModel):
    id: UUID
    doc_type: str
    document_date: date | None
    issuing_source: str | None


class RecordDocument(DocumentInfo):
    # In the order they sit on the page, top to bottom.
    values: list[RecordValue]


class PatientRecord(BaseModel):
    patient: PatientSummary
    # Date order, newest first. Never ranked by anything else.
    documents: list[RecordDocument]


class Box(BaseModel):
    """Normalised 0..1 region on the page, as core.provenance stores it."""

    x: float
    y: float
    w: float
    h: float


class TracePage(BaseModel):
    url: str
    page_no: int
    page_count: int
    width_px: int
    height_px: int


HistoryKind = Literal["accepted", "confirmed", "corrected"]


class TraceHistory(BaseModel):
    """
    How the value reached the record. 'accepted' means every check passed
    and no person was involved; the other two name the person.
    """

    kind: HistoryKind
    actor_name: str | None
    at: datetime | None
    original_value_text: str | None
    original_unit_text: str | None


class Trace(BaseModel):
    value: RecordValue
    patient: PatientSummary
    document: DocumentInfo
    provenance_kind: Literal[
        "source_document", "register_transcription", "clinician_entered", "patient_reported"
    ]
    page: TracePage | None
    box: Box | None
    located_by_text: bool
    entered_by_name: str | None
    reader_name: str | None
    reader_version: str | None
    history: TraceHistory
