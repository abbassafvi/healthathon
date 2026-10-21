from uuid import UUID

from fastapi import APIRouter, Query

from healthathon.auth import Conn, User
from healthathon.confirm_queue import repository as repo
from healthathon.confirm_queue.models import Decision, DecisionResult, QueueList
from healthathon.confirm_queue.service import decide, to_item

router = APIRouter(prefix="/api/confirm-queue", tags=["confirm-queue"])


@router.get("", response_model=QueueList)
def list_queue(conn: Conn, _user: User, limit: int = Query(50, ge=1, le=200)) -> QueueList:
    items = [to_item(r) for r in repo.list_open(conn, limit)]
    return QueueList(items=items, open_count=repo.count_open(conn))


@router.post("/{item_id}/decision", response_model=DecisionResult)
def post_decision(item_id: UUID, decision: Decision, conn: Conn, user: User) -> DecisionResult:
    return decide(conn, user, item_id, decision)
