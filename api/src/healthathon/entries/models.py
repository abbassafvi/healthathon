from datetime import date, datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, Field

# Patient-reported entries, stored as the patient gave them. Nothing here is
# scored, totalled or interpreted, and no field carries a range or a target.

Channel = Literal["patient_app", "paper_form", "sms"]
EnteredBy = Literal["patient", "caregiver", "clinic_staff"]
GlucoseContext = Literal["fasting", "before_meal", "after_meal", "bedtime", "overnight", "random"]
MealName = Literal["breakfast", "lunch", "dinner", "snack"]
# Calories only as the patient typed them, because they knew them. Never estimated.
CALORIES = r"^[0-9]{1,4}$"

CAPTURE_ID = r"^[A-Za-z0-9-]{8,64}$"
# A reading as written: digits, optionally a decimal part. No range is applied.
READING = r"^\d{1,4}(\.\d{1,2})?$"


class RegimenItemRef(BaseModel):
    id: UUID
    drug_text: str
    dose_text: str
    schedule_text: str | None


class EntryBase(BaseModel):
    id: UUID
    channel: Channel
    entered_by: EnteredBy
    caregiver_name: str | None
    language: str
    occurred_at: datetime  # when it happened, per the patient
    recorded_at: datetime  # when the clinic received it


class GlucoseEntry(EntryBase):
    kind: Literal["glucose_reading"]
    value_text: str
    context: GlucoseContext
    insulin_units: float | None


class TickEntry(EntryBase):
    kind: Literal["medication_tick"]
    regimen_item: RegimenItemRef
    tick_date: date
    ticked: bool


class AnswerEntry(EntryBase):
    kind: Literal["survey_answer"]
    set: Literal["daily", "survey"]
    question_key: str
    question_text: str  # in English, for the clinician
    question_text_shown: str  # as the patient saw it
    # The patient's words, a tapped Yes or No, or None when the answer was only spoken.
    answer_text: str | None
    # The patient's own recording, kept as recorded and not transcribed.
    audio_url: str | None


class MealPhotoEntry(EntryBase):
    kind: Literal["meal_photo"]
    photo_url: str
    # occurred_at is when the photograph was taken.
    meal: MealName | None
    calories_text: str | None


PatientEntry = Annotated[
    GlucoseEntry | TickEntry | AnswerEntry | MealPhotoEntry, Field(discriminator="kind")
]


class RegimenItemSpan(RegimenItemRef):
    active_from: date
    active_until: date | None


class EntriesPage(BaseModel):
    entries: list[PatientEntry]
    # Every item active in the range, so a day without a tick shows as a gap.
    regimen_items: list[RegimenItemSpan]
    from_: date = Field(serialization_alias="from")
    to: date


class PaperFormQuestion(BaseModel):
    key: str
    text: str


class PaperTick(BaseModel):
    regimen_item_id: UUID
    date: date
    ticked: bool


class PaperGlucose(BaseModel):
    date: date
    time: str | None = Field(pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    value_text: str = Field(max_length=20)
    context: GlucoseContext
    insulin_units: float | None = Field(ge=0, le=500)


class PaperAnswer(BaseModel):
    date: date
    question_key: str
    answer_text: str = Field(max_length=2000)


class PaperFormSubmission(BaseModel):
    """A week of a paper form, transcribed by clinic staff, stored as written."""

    client_capture_id: str = Field(pattern=CAPTURE_ID)
    week_from: date
    week_to: date
    language: Literal["en", "hi", "ur"]
    ticks: list[PaperTick] = Field(max_length=200)
    glucose: list[PaperGlucose] = Field(max_length=200)
    answers: list[PaperAnswer] = Field(max_length=100)


class PaperFormResult(BaseModel):
    created: int
    duplicate: bool
