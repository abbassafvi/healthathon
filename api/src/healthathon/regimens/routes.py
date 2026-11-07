from uuid import UUID

from fastapi import APIRouter, Response
from fastapi.responses import FileResponse

from healthathon import storage
from healthathon.auth import Conn, User
from healthathon.regimens import service
from healthathon.regimens.models import (
    Activated,
    Checklist,
    ItemDecision,
    RegimenItem,
    RegimenReview,
)

router = APIRouter(prefix="/api", tags=["regimens"])


@router.get("/patients/{patient_id}/checklist", response_model=Checklist)
def get_checklist(patient_id: UUID, conn: Conn, _user: User) -> Checklist:
    return service.checklist(conn, patient_id)


@router.get("/regimens/{regimen_id}/review", response_model=RegimenReview)
def get_review(regimen_id: UUID, conn: Conn, _user: User) -> RegimenReview:
    return service.review(conn, regimen_id)


@router.post("/regimen-items/{item_id}/confirm", response_model=RegimenItem)
def post_confirm(item_id: UUID, decision: ItemDecision, conn: Conn, user: User) -> RegimenItem:
    return service.confirm_item(conn, user, item_id, decision)


@router.delete("/regimen-items/{item_id}", status_code=204)
def delete_item(item_id: UUID, conn: Conn, user: User) -> Response:
    service.remove_item(conn, user, item_id)
    return Response(status_code=204)


@router.post("/regimens/{regimen_id}/activate", response_model=Activated)
def post_activate(regimen_id: UUID, conn: Conn, user: User) -> Activated:
    return service.activate(conn, user, regimen_id)


@router.get("/regimen-advice/{advice_id}/crop", response_class=FileResponse)
def get_advice_crop(advice_id: UUID, conn: Conn, _user: User) -> FileResponse:
    path = storage.resolve(service.advice_crop_path(conn, advice_id))
    assert path is not None
    return FileResponse(path, headers={"Cache-Control": "private, max-age=3600"})


@router.get("/regimen-items/{item_id}/crop", response_class=FileResponse)
def get_crop(item_id: UUID, conn: Conn, _user: User) -> FileResponse:
    path = storage.resolve(service.crop_path(conn, item_id))
    assert path is not None
    return FileResponse(path, headers={"Cache-Control": "private, max-age=3600"})
