from uuid import UUID

from fastapi import APIRouter

from healthathon.auth import Conn, User
from healthathon.calls import callbacks, service
from healthathon.calls.models import (
    CallbackRequest,
    CallbackRequests,
    ScheduleCall,
    ScheduledCall,
    ScheduledCalls,
)

router = APIRouter(prefix="/api", tags=["calls"])


@router.post("/scheduled-calls", response_model=ScheduledCall, status_code=201)
def post_scheduled_call(body: ScheduleCall, conn: Conn, user: User) -> ScheduledCall:
    """
    Ask the clinic to ring a patient and read them the survey.

    A clinician chooses who and when. Nothing picks patients out on its
    own, because choosing whom to telephone would be a judgement about
    them.
    """
    return service.schedule(conn, user, body.patient_id, body.scheduled_for)


@router.get("/patients/{patient_id}/scheduled-calls", response_model=ScheduledCalls)
def get_scheduled_calls(patient_id: UUID, conn: Conn, _user: User) -> ScheduledCalls:
    """This patient's calls, soonest first."""
    return service.for_patient(conn, patient_id)


@router.delete("/scheduled-calls/{call_id}", response_model=ScheduledCall)
def delete_scheduled_call(call_id: UUID, conn: Conn, user: User) -> ScheduledCall:
    """Call off a call nobody has placed yet."""
    return service.cancel(conn, user, call_id)


@router.get("/callback-requests", response_model=CallbackRequests)
def get_callback_requests(conn: Conn, _user: User, include_seen: bool = False) -> CallbackRequests:
    """
    Patients who asked to be rung back, oldest first.

    Never ordered by anything about the patient, and nothing here says
    one matters more than another: a clinic user reads the list and
    decides.
    """
    return callbacks.waiting(conn, include_seen)


@router.post("/callback-requests/{request_id}/seen", response_model=CallbackRequest)
def post_callback_seen(request_id: UUID, conn: Conn, user: User) -> CallbackRequest:
    """Say a clinic user has seen this request. What happens next is a conversation."""
    return callbacks.mark_seen(conn, user, request_id)


@router.get("/patients/{patient_id}/callback-requests", response_model=CallbackRequests)
def get_patient_callback_requests(patient_id: UUID, conn: Conn, _user: User) -> CallbackRequests:
    """This patient's requests, newest first."""
    return callbacks.for_patient(conn, patient_id)
