from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel

from healthathon.record.models import Box

# How one document was read: every region the reader found, where each value
# went and why, and who settled what. A value still waiting for a person is
# named but never shown, as everywhere else in the clinician API.

CheckCode = Literal["grounding", "reread_agreement", "cross_document", "well_formed", "legibility"]


class ReadingPatient(BaseModel):
    id: UUID
    registration_no: str
    full_name: str


class ReadingDocument(BaseModel):
    id: UUID
    doc_type: str
    document_date: date | None
    issuing_source: str | None
    received_at: datetime
    page_count: int
    # 'desk_scan' or 'patient_app'. A clinician settling a line should
    # know whether the page was photographed at the desk or sent in.
    sent_from: str = "desk_scan"


class ReadingPage(BaseModel):
    page_no: int
    url: str
    width_px: int
    height_px: int


class ReaderRun(BaseModel):
    reader_name: str
    reader_version: str
    profile_version: str
    code_commit: str
    started_at: datetime
    finished_at: datetime | None


class Check(BaseModel):
    code: CheckCode
    outcome: Literal["pass", "fail", "not_applicable"]


class Settled(BaseModel):
    action: Literal["confirmed", "corrected", "discarded"]
    by_name: str | None
    at: datetime
    decision_latency_ms: int | None
    # What the reader had, for a correction. As the trace view shows it.
    original_value_text: str | None
    original_unit_text: str | None


class ShownValue(BaseModel):
    value_text: str
    unit_text: str | None


class ReadValue(BaseModel):
    id: UUID
    analyte_name: str
    page_no: int | None
    box: Box | None
    # record: every check passed and no person was involved.
    # person: sent to the confirm queue, with the reason it was sent.
    # checking: the checks have not finished.
    went_to: Literal["record", "person", "checking"]
    reason: str | None
    checks: list[Check]
    waiting: bool
    # Only a value the record can show: accepted, confirmed or a correction.
    shown: ShownValue | None
    settled: Settled | None


class ReadLine(BaseModel):
    """One line of a handwritten prescription. Every line goes to a person."""

    id: UUID
    page_no: int | None
    box: Box | None
    # "accepted" means every check on the line passed and nobody had to
    # look. It is not "confirmed": no person is named against it.
    state: Literal["waiting", "accepted", "confirmed", "corrected"]
    # None while the line waits for review: it is shown on the review page,
    # next to its crop, and nowhere else.
    drug_text: str | None
    dose_text: str | None
    schedule_text: str | None
    by_name: str | None
    at: datetime | None
    original_text: str | None
    regimen_id: UUID


class DocumentReading(BaseModel):
    document: ReadingDocument
    patient: ReadingPatient
    pages: list[ReadingPage]
    run: ReaderRun | None
    values: list[ReadValue]
    lines: list[ReadLine]
