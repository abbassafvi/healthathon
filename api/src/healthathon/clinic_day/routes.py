from datetime import date
from typing import Annotated

from fastapi import APIRouter, Query

from healthathon import clinic_time
from healthathon.auth import Conn, User
from healthathon.clinic_day import service
from healthathon.clinic_day.models import ClinicDay

router = APIRouter(prefix="/api", tags=["clinic-day"])


@router.get("/clinic-day", response_model=ClinicDay)
def get_clinic_day(
    conn: Conn,
    user: User,
    day: Annotated[date | None, Query(alias="date", description="Defaults to today")] = None,
) -> ClinicDay:
    return service.clinic_day(conn, user, day or clinic_time.today())
