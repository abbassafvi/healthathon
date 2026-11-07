"""
Ringing a patient, which the clinic does only when a clinician asked.

This is the one place the system reaches out rather than being reached,
and it is deliberately narrow. It takes a scheduled call, unseals that
patient's number, hands it to Exotel with the flow that reads the
survey, and writes down what the provider said. It decides nothing: who
to ring and when came from a clinician, and what the patient answers
comes back through the same inbound path a call they made uses.

Off unless every Exotel setting and the phone key are present. A half
configured dialler that silently does nothing is worse than one that
says it is off, so `why_off` names the first thing missing.
"""

import logging
from dataclasses import dataclass
from uuid import UUID

import httpx

from healthathon import phones
from healthathon.config import Settings, get_settings

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class Placed:
    """What the provider said when asked to ring someone."""

    call_id: str | None
    # A sentence for whoever looks at the schedule, not a code.
    failure: str | None

    @property
    def ok(self) -> bool:
        return self.call_id is not None


def why_off(settings: Settings | None = None) -> str | None:
    """The first thing missing, or None when the clinic can ring out."""
    s = settings or get_settings()
    if not phones.can_seal():
        return "No phone encryption key is set, so no number can be unsealed to dial."
    missing = [
        name
        for name, value in (
            ("account SID", s.exotel_account_sid),
            ("API key", s.exotel_api_key),
            ("API token", s.exotel_api_token),
            ("ExoPhone to call from", s.exotel_from),
            ("flow id", s.exotel_flow_id),
        )
        if not value
    ]
    return f"Exotel is not configured: no {', no '.join(missing)}." if missing else None


def flow_url(settings: Settings) -> str:
    """The flow Exotel runs once the patient picks up."""
    return (
        f"http://my.exotel.com/{settings.exotel_account_sid}"
        f"/exoml/start_voice/{settings.exotel_flow_id}"
    )


def place(
    sealed: bytes | None,
    scheduled_call_id: UUID,
    client: httpx.Client | None = None,
    settings: Settings | None = None,
) -> Placed:
    """
    Ring one patient. Returns what to write on the scheduled call.

    The number is unsealed here and nowhere else, and it is never logged:
    a failure says what went wrong without repeating who was called.
    """
    s = settings or get_settings()
    off = why_off(s)
    if off:
        return Placed(call_id=None, failure=off)

    number = phones.unseal(sealed)
    if number is None:
        return Placed(
            call_id=None,
            failure="This patient has no number the clinic can dial, or it would not unseal.",
        )

    owned = client is None
    client = client or httpx.Client(timeout=30.0)
    try:
        reply = client.post(
            f"https://{s.exotel_subdomain}/v1/Accounts/{s.exotel_account_sid}/Calls/connect.json",
            auth=(str(s.exotel_api_key), str(s.exotel_api_token)),
            data={
                # Exotel rings "From" first and then runs the flow, so the
                # patient is From and the ExoPhone is the caller id.
                "From": f"+{number}",
                "CallerId": s.exotel_from,
                "Url": flow_url(s),
                # Comes back on the webhook, tying answers to this row.
                "CustomField": str(scheduled_call_id),
            },
        )
    except httpx.HTTPError as exc:
        log.warning("scheduled call %s: provider unreachable: %s", scheduled_call_id, exc)
        return Placed(call_id=None, failure="The telephone provider could not be reached.")
    finally:
        if owned:
            client.close()

    if reply.status_code >= 400:
        log.warning("scheduled call %s: provider refused, %s", scheduled_call_id, reply.status_code)
        return Placed(
            call_id=None,
            failure=f"The telephone provider refused the call ({reply.status_code}).",
        )
    try:
        sid = str(reply.json()["Call"]["Sid"])
    except (ValueError, KeyError, TypeError):
        return Placed(
            call_id=None, failure="The telephone provider sent an answer we could not read."
        )
    return Placed(call_id=sid, failure=None)
