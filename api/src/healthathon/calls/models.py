from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field

# A survey call a clinician asked the clinic to make. Nothing here ranks
# or judges a patient: the only ordering is the time a clinician picked.


class ScheduleCall(BaseModel):
    patient_id: UUID
    # When to ring. The clinic's own time, as the clinician chose it.
    scheduled_for: datetime


class ScheduledCall(BaseModel):
    id: UUID
    patient_id: UUID
    patient_name: str
    registration_no: str
    scheduled_for: datetime
    scheduled_by_name: str
    placed_at: datetime | None
    cancelled_at: datetime | None
    # Why it was not placed, as a sentence rather than a code.
    failure: str | None
    # waiting | placed | cancelled | failed. Derived, never stored.
    state: str


class ScheduledCalls(BaseModel):
    # Soonest first. Never ordered by anything about the patient.
    calls: list[ScheduledCall] = Field(default_factory=list)
