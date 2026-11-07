from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

from healthathon.entries.models import CAPTURE_ID, GlucoseContext, MealName

# What the patient app reads and writes. Everything the patient sees is
# what the patient or the prescription put there: no range, no average, no score.

Lang = Literal["en", "hi", "ur"]


class AppPatient(BaseModel):
    id: UUID
    registration_no: str
    full_name: str
    preferred_language: str


class SignInStart(BaseModel):
    phone: str = Field(min_length=6, max_length=24)


class SignInStarted(BaseModel):
    # Test mode only: the code, for the sign-in screen to show. Null with Twilio.
    demo_code: str | None


class SignInCheck(BaseModel):
    phone: str = Field(min_length=6, max_length=24)
    code: str = Field(pattern=r"^[0-9]{4,10}$")


class SignedIn(BaseModel):
    """A token for this phone, sent as `Authorization: Bearer <token>`, and whose it is."""

    token: str
    patient: AppPatient


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
    """A meal photograph: which meal, when it was taken, and calories only if typed."""

    id: UUID
    uri: str
    occurred_at: datetime
    meal: MealName | None
    calories_text: str | None


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
    # The recording with today's answer, when it was spoken.
    answer_audio_uri: str | None
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


# A recording the patient sent, as /recordings stored it.
RECORDING_KEY = r"^voice/[0-9a-f-]{36}/[A-Za-z0-9_-]{8,64}\.(m4a|webm|ogg|wav)$"


class AnswerRequest(BaseModel):
    """An answer is words, a tap, a recording, or a tap with a recording."""

    question_key: str
    answer_text: str | None = Field(default=None, max_length=2000)
    audio_key: str | None = Field(default=None, pattern=RECORDING_KEY)
    capture_id: str = Field(pattern=CAPTURE_ID)
    language: Lang | None = None


class SurveyRequest(BaseModel):
    # Written answers, and recorded ones by question key; each question needs one or both.
    answers: dict[str, str] = Field(max_length=20)
    recordings: dict[str, str] = Field(default_factory=dict, max_length=20)
    capture_id: str = Field(pattern=CAPTURE_ID)
    language: Lang | None = None


class AppRecording(BaseModel):
    """A recording kept at the clinic, to attach to an answer."""

    key: str
    uri: str


class AppDocumentLine(BaseModel):
    """A medicine as read off the patient's own page, exactly as written."""

    drug_text: str
    dose_text: str
    schedule_text: str | None
    # False until a clinician settles the line. The app says so beside it,
    # because a reading nobody has checked is not a fact about a medicine.
    checked: bool


class AppDocumentValue(BaseModel):
    """
    A laboratory value off the patient's own page.

    `value_text` is null until the value is renderable. `proj.renderable_value`
    admits only accepted and confirmed values, and it is the only view a value
    may be read from, so a number nobody has settled has no text to show.
    """

    analyte_name: str
    value_text: str | None
    unit_text: str | None
    checked: bool


class AppDocumentAdvice(BaseModel):
    """What the prescription asks for that is not a medicine, as written."""

    text: str
    checked: bool


class AppDocument(BaseModel):
    """One page the patient sent or the clinic scanned, and what was read off it."""

    id: UUID
    doc_type: str
    document_date: date | None
    received_at: datetime
    # 'patient_app' when the patient photographed it, 'desk_scan' at the clinic.
    sent_from: str
    page_uri: str | None
    lines: list[AppDocumentLine]
    values: list[AppDocumentValue]
    advice: list[AppDocumentAdvice]


class AppUploadStatus(BaseModel):
    """Where a page the patient sent has got to. The phone polls this."""

    id: str
    stage: Literal["uploading", "reading", "done", "duplicate", "failed"]
    document_id: UUID | None
    failure: str | None
