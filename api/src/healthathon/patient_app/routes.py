from datetime import date, datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Body, Depends, Header, HTTPException, Query, Response

from healthathon import phones
from healthathon.audit import record_event
from healthathon.auth import Conn
from healthathon.entries.models import CALORIES, CAPTURE_ID, MealName
from healthathon.patient_app import days, document_routes, service, signin, writes
from healthathon.patient_app import repository as repo
from healthathon.patient_app.models import (
    AnswerRequest,
    AppMeal,
    AppPatient,
    AppQuestion,
    AppReading,
    AppRecording,
    ReadingRequest,
    SignedIn,
    SignInCheck,
    SignInStart,
    SignInStarted,
    SurveyRequest,
    TickRequest,
    Today,
)


def signed_in(patient_id: UUID, authorization: Annotated[str | None, Header()] = None) -> UUID:
    """A route under /patients/{id} opens only with a token issued to that patient."""
    token = authorization.removeprefix("Bearer ") if authorization else ""
    pid = signin.patient_for(token) if token else None
    if pid is None:
        raise HTTPException(401, "Sign in again", headers={"WWW-Authenticate": "Bearer"})
    if pid != patient_id:
        raise HTTPException(403, "This phone is signed in as another patient")
    return pid


# The patient app's endpoints. A phone signs in with a code sent by SMS to
# the number on the patient's record; every patient route needs its token.
router = APIRouter(prefix="/api/app", tags=["patient-app"])
patient_router = APIRouter(dependencies=[Depends(signed_in)])


@router.post("/sign-in/start", response_model=SignInStarted)
def start_sign_in(req: SignInStart, conn: Conn) -> SignInStarted:
    """
    Send a code to this number if it is on a patient's record. The answer is
    the same either way, except that test mode shows the code it made.
    """
    phone = phones.normalise(req.phone)
    if phone is None:
        raise HTTPException(422, "That is not a phone number")
    if repo.patient_by_phone(conn, phones.phone_hmac(phone)) is None:
        return SignInStarted(demo_code=None)
    return SignInStarted(demo_code=signin.send_code(phone))


@router.post("/sign-in/check", response_model=SignedIn)
def check_sign_in(req: SignInCheck, conn: Conn) -> SignedIn:
    phone = phones.normalise(req.phone)
    patient = repo.patient_by_phone(conn, phones.phone_hmac(phone)) if phone else None
    if phone is None or patient is None or not signin.check_code(phone, req.code):
        raise HTTPException(401, "That code is not right, or it has run out")
    record_event(conn, None, "patient.sign_in", "core.patient", patient["id"])
    return SignedIn(token=signin.token_for(patient["id"]), patient=AppPatient(**patient))


@patient_router.get("/patients/{patient_id}/today", response_model=Today)
def get_today(patient_id: UUID, conn: Conn) -> Today:
    return service.today(conn, patient_id)


@patient_router.put("/patients/{patient_id}/ticks/{item_id}", status_code=204)
def put_tick(patient_id: UUID, item_id: UUID, req: TickRequest, conn: Conn) -> Response:
    writes.set_tick(conn, patient_id, item_id, req)
    return Response(status_code=204)


@patient_router.post("/patients/{patient_id}/readings", response_model=AppReading)
def post_reading(patient_id: UUID, req: ReadingRequest, conn: Conn) -> AppReading:
    return writes.add_reading(conn, patient_id, req)


@patient_router.post("/patients/{patient_id}/answers", status_code=204)
def post_answer(patient_id: UUID, req: AnswerRequest, conn: Conn) -> Response:
    writes.answer(conn, patient_id, req)
    return Response(status_code=204)


@patient_router.post(
    "/patients/{patient_id}/meals",
    response_model=AppMeal,
    openapi_extra={
        "requestBody": {
            "required": True,
            "content": {
                "image/jpeg": {"schema": {"type": "string", "format": "binary"}},
                "image/png": {"schema": {"type": "string", "format": "binary"}},
            },
        }
    },
)
def post_meal(
    patient_id: UUID,
    conn: Conn,
    body: Annotated[bytes, Body(media_type="application/octet-stream", include_in_schema=False)],
    capture_id: Annotated[str, Query(pattern=CAPTURE_ID)],
    meal: Annotated[MealName, Query(description="The meal, as the patient chose it")],
    taken_at: Annotated[
        datetime | None, Query(description="When the photograph was taken; now by default")
    ] = None,
    calories: Annotated[
        str | None, Query(pattern=CALORIES, description="Only as typed by the patient")
    ] = None,
) -> AppMeal:
    return writes.add_meal(conn, patient_id, capture_id, body, meal, taken_at, calories)


@patient_router.post(
    "/patients/{patient_id}/recordings",
    response_model=AppRecording,
    openapi_extra={
        "requestBody": {
            "required": True,
            "content": {
                t: {"schema": {"type": "string", "format": "binary"}}
                for t in ("audio/mp4", "audio/webm", "audio/ogg", "audio/wav")
            },
        }
    },
)
def post_recording(
    patient_id: UUID,
    conn: Conn,
    body: Annotated[bytes, Body(media_type="application/octet-stream", include_in_schema=False)],
    capture_id: Annotated[str, Query(pattern=CAPTURE_ID)],
) -> AppRecording:
    """A spoken answer, kept as recorded. Attach its key to an answer or the survey."""
    return writes.add_recording(conn, patient_id, capture_id, body)


@patient_router.get("/patients/{patient_id}/survey", response_model=list[AppQuestion])
def get_survey(patient_id: UUID, conn: Conn) -> list[AppQuestion]:
    return service.survey_questions(conn, patient_id)


@patient_router.post("/patients/{patient_id}/survey", status_code=204)
def post_survey(patient_id: UUID, req: SurveyRequest, conn: Conn) -> Response:
    writes.submit_survey(conn, patient_id, req)
    return Response(status_code=204)


@patient_router.get("/patients/{patient_id}/days", response_model=days.PastDays)
def get_past_days(
    patient_id: UUID,
    conn: Conn,
    before: Annotated[
        date | None, Query(description="Days before this one; today by default")
    ] = None,
    count: Annotated[int, Query(ge=1, le=31)] = 7,
) -> days.PastDays:
    return days.past_days(conn, patient_id, before, count)


patient_router.include_router(document_routes.router)
router.include_router(patient_router)
