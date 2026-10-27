from typing import Annotated

from fastapi import APIRouter, Query

from healthathon.audit_log import service
from healthathon.audit_log.models import AuditLog, Kind
from healthathon.auth import Conn, User

router = APIRouter(prefix="/api", tags=["audit"])


@router.get("/audit-log", response_model=AuditLog)
def get_audit_log(
    conn: Conn,
    user: User,
    kind: Kind | None = None,
    before: Annotated[int | None, Query(ge=1)] = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
) -> AuditLog:
    return service.audit_log(conn, user, kind, before, limit)
