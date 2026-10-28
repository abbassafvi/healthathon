from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel

# The day's booked visits, with plain facts about each patient's record.
# Counts of what is in the record, never a judgement about the patient:
# nothing here is ranked, flagged or scored, and visits come in time order.


class DayPatient(BaseModel):
    id: UUID
    registration_no: str
    full_name: str
    year_of_birth: int | None
    sex: str | None


class DocumentsSince(BaseModel):
    lab_reports: int
    prescriptions: int


class Waiting(BaseModel):
    """What still needs a person before it can be shown or ticked."""

    values: int
    prescription_lines: int
    # The first prescription waiting for review, to open it directly.
    review_regimen_id: UUID | None


class ChecklistState(BaseModel):
    # None when the patient has no checklist in force.
    active_since: date | None
    medicines: int


class EntriesSince(BaseModel):
    medicine_ticks: int
    glucose_readings: int
    answers: int
    meal_photos: int
    last_at: datetime | None


class DayVisit(BaseModel):
    visit_id: UUID
    scheduled_for: datetime
    started_at: datetime | None
    clinician_name: str | None
    patient: DayPatient
    # The period the visit page will cover: from the day after the last visit.
    period_from: date
    previous_visit: date | None
    documents: DocumentsSince
    waiting: Waiting
    checklist: ChecklistState
    entries: EntriesSince


class ClinicDay(BaseModel):
    date: date
    visits: list[DayVisit]
