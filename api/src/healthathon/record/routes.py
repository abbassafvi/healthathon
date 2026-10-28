from uuid import UUID

from fastapi import APIRouter

from healthathon.auth import Conn, User
from healthathon.record import service
from healthathon.record.models import PatientListItem, PatientRecord, Trace

router = APIRouter(prefix="/api", tags=["record"])


@router.get("/patients", response_model=list[PatientListItem])
def list_patients(conn: Conn, _user: User) -> list[PatientListItem]:
    return service.patient_list(conn)


@router.get("/patients/{patient_id}/record", response_model=PatientRecord)
def get_record(patient_id: UUID, conn: Conn, user: User) -> PatientRecord:
    return service.patient_record(conn, user, patient_id)


@router.get("/values/{value_id}/trace", response_model=Trace)
def get_trace(value_id: UUID, conn: Conn, user: User) -> Trace:
    return service.trace(conn, user, value_id)
