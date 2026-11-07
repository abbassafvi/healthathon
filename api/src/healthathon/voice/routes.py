import hmac
from typing import Annotated

from fastapi import APIRouter, Header, HTTPException

from healthathon.auth import Conn
from healthathon.config import get_settings
from healthathon.voice import service
from healthathon.voice.models import VoiceReply, VoiceStep

router = APIRouter(prefix="/api/voice", tags=["voice"])


@router.post("/inbound", response_model=VoiceReply)
def post_inbound(
    step: VoiceStep,
    conn: Conn,
    x_gateway_key: Annotated[str | None, Header()] = None,
) -> VoiceReply:
    """
    One step of one inbound call, as the voice provider's webhook reports it.

    Off unless `voice_gateway_key` is set, which it is not by default: no
    provider has been chosen, and an endpoint that stores patient data
    must not be reachable because a setting was left at a placeholder.

    The provider's own payload is mapped onto `VoiceStep` by an adapter,
    so nothing in the record depends on which company carries the call.
    """
    expected = get_settings().voice_gateway_key.encode()
    if not expected:
        raise HTTPException(503, "Inbound voice is not configured")
    if not x_gateway_key or not hmac.compare_digest(x_gateway_key.encode(), expected):
        raise HTTPException(401, "Unknown gateway")
    return service.handle(conn, step)
