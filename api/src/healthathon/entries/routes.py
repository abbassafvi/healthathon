from datetime import date
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Query

from healthathon.auth import Conn, User
from healthathon.entries import service
from healthathon.entries.models import (
    EntriesPage,
    PaperFormQuestion,
    PaperFormResult,
    PaperFormSubmission,
)

router = APIRouter(prefix="/api", tags=["entries"])


@router.get("/patients/{patient_id}/entries", response_model=EntriesPage)
def get_entries(
    patient_id: UUID,
    conn: Conn,
    user: User,
    from_: Annotated[date | None, Query(alias="from")] = None,
    to: date | None = None,
) -> EntriesPage:
    return service.entries_page(conn, user, patient_id, from_, to)


@router.get("/paper-form/questions", response_model=list[PaperFormQuestion])
def get_paper_form_questions(conn: Conn, _user: User) -> list[PaperFormQuestion]:
    return service.paper_form_questions(conn)


@router.post("/patients/{patient_id}/paper-form", response_model=PaperFormResult)
def post_paper_form(
    patient_id: UUID, form: PaperFormSubmission, conn: Conn, user: User
) -> PaperFormResult:
    return service.submit_paper_form(conn, user, patient_id, form)
