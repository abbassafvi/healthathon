from uuid import UUID

from fastapi import APIRouter

from healthathon.auth import Conn, User
from healthathon.visit import service
from healthathon.visit.models import VisitSummary

router = APIRouter(prefix="/api", tags=["visit"])


@router.get("/patients/{patient_id}/visit", response_model=VisitSummary)
def get_visit(patient_id: UUID, conn: Conn, user: User) -> VisitSummary:
    return service.summary(conn, user, patient_id)
