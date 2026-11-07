"""
Exotel's Passthru applet, mapped onto `VoiceStep`.

Exotel is not shaped like the endpoint this project would have designed,
and three of its choices decide everything here:

1. It makes a **GET** with URL-encoded query parameters, not a JSON POST.
2. Its documentation does not offer custom HTTP headers, so the shared
   secret has to travel in the URL. That is weaker than `X-Gateway-Key`:
   a URL is logged by the provider and by anything between. Rotate it,
   and prefer the header route for any provider that supports one.
3. A Passthru response "cannot be customised" and carries only a binary
   decision: 200 takes one path through the flow, 302 the other. It
   therefore cannot tell Exotel what to say, so the prompts, the menu
   and the keypad gathering all live in Exotel's own flow builder.

That last point is why the branch is in the URL rather than in the
payload. Exotel hands over only the digits from the gather immediately
before, so asking "which medicine" at one step and "taken or not" at
another would need this endpoint to remember a half-finished call. It
does not: the flow branches first, and the branch it took is part of the
address it calls. Nothing is held between requests.
"""

import hmac
from typing import Annotated, Any, Literal

from fastapi import APIRouter, HTTPException, Query, Response
from pydantic import ValidationError

from healthathon.auth import Conn
from healthathon.config import get_settings
from healthathon.voice import recordings, service
from healthathon.voice.models import VoiceStep

router = APIRouter(prefix="/api/voice/exotel", tags=["voice"])

# Which time of day a reading is for, by the branch the flow took. The
# same contexts the app and the SMS card use.
Context = Literal["fasting", "before_meal", "after_meal", "bedtime", "random"]

# Exotel wraps the gathered digits in double quotes. Its own documentation
# says to trim them, so this is their quirk and not a guess.
_QUOTES = '" '


def _digits(raw: str | None) -> str:
    return (raw or "").strip(_QUOTES)


def _check(secret: str) -> None:
    """
    The secret in the URL, compared without leaking its length in timing.

    Empty configuration means inbound voice is off, as on the header
    route: an endpoint that stores patient data must not be reachable
    because a setting was left at a placeholder.
    """
    expected = get_settings().voice_gateway_key
    if not expected:
        raise HTTPException(503, "Inbound voice is not configured")
    # Bytes, not str: compare_digest raises TypeError on non-ASCII text.
    if not hmac.compare_digest(secret.encode(), expected.encode()):
        raise HTTPException(404, "Not found")


def _reply(conn: Conn, step: VoiceStep) -> Response:
    """
    Store the step, and answer in the only way Exotel reads: the status.

    200 means the step did what it said, and the flow plays its "taken"
    prompt. 302 means it did not, so the flow can take its other path and
    say so rather than telling the caller something was kept when nothing
    was. Both are recorded prompts: nothing here is spoken by a machine.

    Success is "we have a prompt to play that is not the one asking
    again", rather than "something was stored", because asking to be rung
    back stores nothing and is still a step that worked.
    """
    out = service.handle(conn, step)
    worked = out.accepted and out.prompt not in (None, service.NOT_RECOGNISED)
    return Response(
        status_code=200 if worked else 302, headers=None if worked else {"Location": "/"}
    )


def _step(fields: dict[str, Any]) -> VoiceStep | None:
    """
    The step, or None when what was keyed in is not something we store:
    medicine 0 or 100, or a reading longer than twelve digits. The caller
    then takes the other branch and hears that nothing was kept; raised
    here, the validation error was a 500, which the flow does not handle.
    """
    try:
        return VoiceStep.model_validate(fields)
    except ValidationError:
        return None


@router.get("/{secret}/tick/{taken}", include_in_schema=False)
def tick(
    secret: str,
    taken: Literal["yes", "no"],
    conn: Conn,
    CallSid: Annotated[str, Query()],
    CallFrom: Annotated[str, Query()],
    digits: Annotated[str | None, Query()] = None,
) -> Response:
    """
    A medicine ticked by keypad. The flow asked taken or not, branched,
    then gathered the medicine's number from the patient's SMS card, so
    no recording ever has to pronounce a drug name.
    """
    _check(secret)
    pressed = _digits(digits)
    if not pressed.isdigit():
        return Response(status_code=302, headers={"Location": "/"})
    step = _step(
        {
            "call_id": CallSid,
            # One instruction per request, and the capture id below is
            # what makes a redelivery store once, so the step is 1.
            "step": 1,
            "from": CallFrom,
            "kind": "tick",
            "digits": "1" if taken == "yes" else "2",
            "item_number": int(pressed),
            "provider_ref": f"tick-{taken}-{pressed}",
        }
    )
    if step is None:
        return Response(status_code=302, headers={"Location": "/"})
    return _reply(conn, step)


@router.get("/{secret}/reading/{context}", include_in_schema=False)
def reading(
    secret: str,
    context: Context,
    conn: Conn,
    CallSid: Annotated[str, Query()],
    CallFrom: Annotated[str, Query()],
    digits: Annotated[str | None, Query()] = None,
) -> Response:
    """
    A glucose reading keyed in. The flow asked the time of day first and
    branched, so the value arrives already knowing what it is a reading of.
    """
    _check(secret)
    pressed = _digits(digits)
    if not pressed.isdigit():
        return Response(status_code=302, headers={"Location": "/"})
    step = _step(
        {
            "call_id": CallSid,
            "step": 1,
            "from": CallFrom,
            "kind": "reading",
            "digits": pressed,
            "context": context,
            "provider_ref": f"reading-{context}-{pressed}",
        }
    )
    if step is None:
        return Response(status_code=302, headers={"Location": "/"})
    return _reply(conn, step)


@router.get("/{secret}/keyed-answer", include_in_schema=False)
def keyed_answer(
    secret: str,
    conn: Conn,
    CallSid: Annotated[str, Query()],
    CallFrom: Annotated[str, Query()],
    digits: Annotated[str | None, Query()] = None,
) -> Response:
    """
    The day's question, answered on the keypad instead of spoken.

    This provider's account has no voicemail applet, so there is no way
    to record a caller. The question is a yes or no, so one key carries
    it. The answer is stored as the word in the patient's own language,
    the same as a typed one, and a clinician reads the two side by side
    without being told which arrived how.

    A press that is neither key is asked again, never read as a no: not
    answering and answering no are different reports.
    """
    _check(secret)
    step = _step(
        {
            "call_id": CallSid,
            "step": 1,
            "from": CallFrom,
            "kind": "keyed_answer",
            "digits": _digits(digits),
            "provider_ref": f"keyed-answer-{_digits(digits)}",
        }
    )
    if step is None:
        return Response(status_code=302, headers={"Location": "/"})
    return _reply(conn, step)


@router.get("/{secret}/answer", include_in_schema=False)
def answer(
    secret: str,
    conn: Conn,
    CallSid: Annotated[str, Query()],
    CallFrom: Annotated[str, Query()],
    RecordingUrl: Annotated[str | None, Query()] = None,
) -> Response:
    """
    The day's question, spoken into a voicemail and kept as recorded.

    Exotel hands over a URL rather than the audio, and says a recording
    takes 5 to 20 minutes to become available, so there is nothing to
    fetch while this request is open. It returns at once and the
    recording is collected afterwards; nothing is stored until the audio
    is in hand, because an answer the clinician cannot play is worse than
    no answer.

    200 therefore means "we will keep this", not "kept". The caller is
    told their answer was taken, which is true: the call is over and the
    recording is the provider's to deliver.
    """
    _check(secret)
    if not RecordingUrl or not recordings.host_allowed(RecordingUrl):
        # Either voicemail was not reached, or the URL is not somewhere a
        # recording may be fetched from. Neither is the caller's problem
        # to hear about, and neither stores anything.
        return Response(status_code=302, headers={"Location": "/"})
    step = _step(
        {
            "call_id": CallSid,
            "step": 1,
            "from": CallFrom,
            "kind": "answer",
            "provider_ref": "answer",
        }
    )
    if step is None:
        return Response(status_code=302, headers={"Location": "/"})
    recordings.store_when_ready(step, RecordingUrl)
    return Response(status_code=200)


@router.get("/{secret}/callback", include_in_schema=False)
def callback(
    secret: str,
    conn: Conn,
    CallSid: Annotated[str, Query()],
    CallFrom: Annotated[str, Query()],
) -> Response:
    """
    The caller asked the clinic to ring them back.

    Needs no dialler and no KYC: the patient made this call, and all the
    clinic has to do is know they asked. 200 so the flow can say it was
    taken; 302 when the caller is not a consenting patient, so the flow
    says something else rather than promising a call back.
    """
    _check(secret)
    return _reply(
        conn,
        VoiceStep.model_validate(
            {
                "call_id": CallSid,
                "step": 1,
                "from": CallFrom,
                "kind": "callback",
                "provider_ref": "callback",
            }
        ),
    )
