import hmac
from typing import Annotated

from fastapi import APIRouter, Header, HTTPException

from healthathon.auth import Conn
from healthathon.config import get_settings
from healthathon.sms import service
from healthathon.sms.models import InboundSms, SmsResult

router = APIRouter(prefix="/api/sms", tags=["sms"])


@router.post("/inbound", response_model=SmsResult)
def post_inbound(
    msg: InboundSms,
    conn: Conn,
    x_gateway_key: Annotated[str | None, Header()] = None,
) -> SmsResult:
    """The endpoint an SMS gateway calls for each message it receives."""
    expected = get_settings().sms_gateway_key.encode()
    if not x_gateway_key or not hmac.compare_digest(x_gateway_key.encode(), expected):
        raise HTTPException(401, "Unknown gateway")
    return service.receive(conn, msg)
