from datetime import date, datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Body, Query, Response

from healthathon.auth import Conn
from healthathon.entries.models import CALORIES, CAPTURE_ID, MealName
from healthathon.patient_app import days, service, writes
from healthathon.patient_app.models import (
    AnswerRequest,
    AppMeal,
    AppPatient,
    AppQuestion,
    AppReading,
    AppRecording,
    ReadingRequest,
    SurveyRequest,
    TickRequest,
    Today,
)

# The patient app's endpoints. There is no login in the prototype: the app
# picks one of the four seeded patients, as the scope allows.
router = APIRouter(prefix="/api/app", tags=["patient-app"])


@router.get("/patients", response_model=list[AppPatient])
def get_patients(conn: Conn) -> list[AppPatient]:
    return service.patients(conn)


@router.get("/patients/{patient_id}/today", response_model=Today)
def get_today(patient_id: UUID, conn: Conn) -> Today:
    return service.today(conn, patient_id)


@router.put("/patients/{patient_id}/ticks/{item_id}", status_code=204)
def put_tick(patient_id: UUID, item_id: UUID, req: TickRequest, conn: Conn) -> Response:
    writes.set_tick(conn, patient_id, item_id, req)
    return Response(status_code=204)


@router.post("/patients/{patient_id}/readings", response_model=AppReading)
def post_reading(patient_id: UUID, req: ReadingRequest, conn: Conn) -> AppReading:
    return writes.add_reading(conn, patient_id, req)


@router.post("/patients/{patient_id}/answers", status_code=204)
def post_answer(patient_id: UUID, req: AnswerRequest, conn: Conn) -> Response:
    writes.answer(conn, patient_id, req)
    return Response(status_code=204)


@router.post(
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


@router.post(
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


@router.get("/patients/{patient_id}/survey", response_model=list[AppQuestion])
def get_survey(patient_id: UUID, conn: Conn) -> list[AppQuestion]:
    return service.survey_questions(conn, patient_id)


@router.post("/patients/{patient_id}/survey", status_code=204)
def post_survey(patient_id: UUID, req: SurveyRequest, conn: Conn) -> Response:
    writes.submit_survey(conn, patient_id, req)
    return Response(status_code=204)


@router.get("/patients/{patient_id}/days", response_model=days.PastDays)
def get_past_days(
    patient_id: UUID,
    conn: Conn,
    before: Annotated[
        date | None, Query(description="Days before this one; today by default")
    ] = None,
    count: Annotated[int, Query(ge=1, le=31)] = 7,
) -> days.PastDays:
    return days.past_days(conn, patient_id, before, count)
