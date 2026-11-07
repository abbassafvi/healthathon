from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from healthathon.entries.models import GlucoseContext

# What the caller is being asked for at this step of the call. The provider
# posts one request per step, so the step says how to read `digits`.
StepKind = Literal["menu", "tick", "reading", "answer"]

# A recording the provider already stored for us, as /recordings names them.
RECORDING_KEY = r"^voice/[0-9a-f-]{36}/[A-Za-z0-9_-]{8,64}\.(mp3|m4a|webm|ogg|wav)$"

CALL_ID = r"^[A-Za-z0-9-]{1,64}$"


class VoiceStep(BaseModel):
    """
    One step of one inbound call, as the provider's webhook reports it.

    Deliberately not any provider's own shape: an adapter maps Twilio's or
    Exotel's form fields onto this, so the record never depends on which
    company carries the call.
    """

    call_id: str = Field(pattern=CALL_ID, description="The provider's id for this call")
    # Which step of the call this is. Part of the capture id, so the same
    # step delivered twice stores once.
    step: int = Field(ge=1, le=99)
    from_: str = Field(alias="from", max_length=32, description="Caller ID")
    kind: StepKind
    # Keys the caller pressed, '#' and '*' already stripped by the adapter.
    digits: str | None = Field(default=None, pattern=r"^[0-9]{0,12}$")
    # For a spoken answer: the recording, stored as given and never transcribed.
    audio_key: str | None = Field(default=None, pattern=RECORDING_KEY)
    # Which medicine the caller chose at an earlier step, by card number.
    item_number: int | None = Field(default=None, ge=1, le=99)
    # Which time of day a reading is for. The adapter maps its provider's
    # key presses onto these names, so nothing provider-shaped gets this
    # far and the core never has to know what "press 1" meant.
    context: GlucoseContext | None = None
    # The provider's own name for this instruction within the call, when
    # it has one. It joins the capture id, so a redelivered webhook stores
    # once while two different instructions in one call both store.
    provider_ref: str | None = Field(default=None, pattern=r"^[A-Za-z0-9_-]{1,64}$")
    occurred_at: datetime | None = None


class VoiceProblem(BaseModel):
    line: str
    reason: str


class VoiceReply(BaseModel):
    """
    What the call should do next. No prompt text, only which prompt.

    The audio is recorded by people in each language and played by the
    adapter, so nothing here is spoken by a machine and no drug name is
    ever read out: a medicine is its number on the patient's SMS card.
    """

    # False when the caller ID is not a patient's, or voice consent is not
    # a granted, unwithdrawn yes. The call ends and nothing is stored.
    accepted: bool
    duplicate: bool
    # Which recorded prompt to play next, or null to end the call.
    prompt: str | None
    # What was just stored, repeated back to the caller as digits. Never a
    # judgement about it, and never a drug name.
    confirm: str | None
    expect: Literal["digits", "recording", None] = None
    stored: list[str] = []
    problems: list[VoiceProblem] = []
