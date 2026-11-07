"""
Exotel's inbound SMS webhook, mapped onto `InboundSms`.

The same three mismatches the voice adapter deals with, for the same
reasons: Exotel sends form fields rather than JSON, documents no custom
HTTP headers so the shared secret travels in the URL, and expects a 200
within ten seconds. Storing is fast, so the last one needs no thread.

Exotel lets you choose POST or GET for this webhook and its own docs
disagree about the exact field list, so both methods are accepted and
every field but the message, the sender and the id is optional.
"""

import hmac
import logging
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Form, HTTPException, Query, Response

from healthathon.auth import Conn
from healthathon.config import get_settings
from healthathon.sms import service
from healthathon.sms.models import InboundSms

router = APIRouter(prefix="/api/sms/exotel", tags=["sms"])

log = logging.getLogger(__name__)


def _check(secret: str) -> None:
    """
    The secret in the URL. Weaker than a header, and its own setting:
    a leaked SMS secret must not open the voice endpoint, or the reverse.
    Empty configuration means this door is shut.
    """
    expected = get_settings().sms_gateway_key
    if not expected:
        raise HTTPException(503, "Inbound SMS is not configured")
    if not hmac.compare_digest(secret, expected):
        # 404, not 401: an unguessed URL should not confirm it exists.
        raise HTTPException(404, "Not found")


def _store(conn: Conn, sid: str | None, sender: str | None, body: str | None) -> Response:
    """
    Hand the message to the same `receive` an SMS gateway's JSON reaches.

    Always 200. Exotel retries anything else, and a message refused
    because the sender is not a consenting patient is settled, not
    something to deliver again.
    """
    if not sid or not sender or body is None:
        log.warning("inbound SMS from Exotel was missing a field")
        return Response(status_code=200)
    try:
        msg = InboundSms.model_validate({"message_id": sid, "from": sender, "body": body})
    except ValueError:
        log.warning("inbound SMS from Exotel did not fit the contract")
        return Response(status_code=200)
    service.receive(conn, msg)
    return Response(status_code=200)


@router.post("/{secret}", include_in_schema=False)
def post_inbound(
    secret: str,
    conn: Conn,
    SmsSid: Annotated[str | None, Form()] = None,
    From: Annotated[str | None, Form()] = None,
    Body: Annotated[str | None, Form()] = None,
    DateCreated: Annotated[datetime | None, Form()] = None,
) -> Response:
    """One inbound message, as Exotel's webhook posts it."""
    _check(secret)
    return _store(conn, SmsSid, From, Body)


@router.get("/{secret}", include_in_schema=False)
def get_inbound(
    secret: str,
    conn: Conn,
    SmsSid: Annotated[str | None, Query()] = None,
    From: Annotated[str | None, Query()] = None,
    Body: Annotated[str | None, Query()] = None,
    DateCreated: Annotated[datetime | None, Query()] = None,
) -> Response:
    """The same, for an account configured to call the webhook with GET."""
    _check(secret)
    return _store(conn, SmsSid, From, Body)
