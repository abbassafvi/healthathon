from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

from healthathon.entries.models import CAPTURE_ID, GlucoseContext

# What the patient app reads and writes. Everything the patient sees is
# what the patient or the prescription put there: no range, no average, no score.

Lang = Literal["en", "hi", "ur"]


class AppPatient(BaseModel):
    id: UUID
    registration_no: str
    full_name: str
    preferred_language: str


class AppChecklistItem(BaseModel):
    """Exactly as printed on the activated prescription."""

    id: UUID
    drug_text: str
    dose_text: str
    schedule_text: str | None


class AppReading(BaseModel):
    id: UUID
    value_text: str
    context: GlucoseContext
    occurred_at: datetime


class AppQuestion(BaseModel):
    key: str
    text: dict[str, str]  # language -> text


class AppMeal(BaseModel):
    id: UUID
    uri: str
    occurred_at: datetime


class SurveyState(BaseModel):
    open: bool
    done: bool


class Today(BaseModel):
    date: date
    patient: AppPatient
    items: list[AppChecklistItem]
    # item id -> ticked today. Absent means no entry yet.
    ticks: dict[str, bool]
    readings: list[AppReading]
    question: AppQuestion | None
    answer: str | None
    meals: list[AppMeal]
    survey: SurveyState


class TickRequest(BaseModel):
    # null clears today's tick: "no entry", which is not the same as not taken.
    ticked: bool | None
    capture_id: str = Field(pattern=CAPTURE_ID)


class ReadingRequest(BaseModel):
    value_text: str = Field(max_length=20)
    context: GlucoseContext
    capture_id: str = Field(pattern=CAPTURE_ID)
    language: Lang | None = None


class AnswerRequest(BaseModel):
    question_key: str
    answer_text: str = Field(max_length=2000)
    capture_id: str = Field(pattern=CAPTURE_ID)
    language: Lang | None = None


class SurveyRequest(BaseModel):
    answers: dict[str, str] = Field(max_length=20)
    capture_id: str = Field(pattern=CAPTURE_ID)
    language: Lang | None = None
