from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

Reason = Literal[
    "no_context",
    "not_a_number",
    "unknown",
    "bad_tick",
    "empty_answer",
    "no_such_medicine",
    "already_recorded",
    "no_question",
]


class InboundSms(BaseModel):
    """One message as the gateway received it. The body is never stored, only its hash."""

    message_id: str = Field(pattern=r"^[A-Za-z0-9-]{1,64}$")
    from_: str = Field(alias="from", max_length=32)
    body: str = Field(max_length=1600)
    received_at: datetime | None = None


class StoredItem(BaseModel):
    kind: Literal["glucose_reading", "medication_tick", "survey_answer"]
    entry_id: str


class SmsProblem(BaseModel):
    line: str
    reason: Reason


class SmsResult(BaseModel):
    # False when the number is not a patient's, or the patient has not agreed to SMS.
    accepted: bool
    duplicate: bool
    stored: list[StoredItem]
    problems: list[SmsProblem]
