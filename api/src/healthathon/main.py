from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from healthathon import storage, thumbnails
from healthathon.audit_log.routes import router as audit_log_router
from healthathon.auth import CurrentUser, User
from healthathon.calls.routes import router as calls_router
from healthathon.clinic_day.routes import router as clinic_day_router
from healthathon.config import get_settings
from healthathon.confirm_queue.routes import router as confirm_queue_router
from healthathon.db import close_pool, open_pool
from healthathon.entries.routes import router as entries_router
from healthathon.patient_app.routes import router as patient_app_router
from healthathon.reading.routes import router as reading_router
from healthathon.record.routes import router as record_router
from healthathon.regimens.routes import router as regimens_router
from healthathon.sms.exotel import router as exotel_sms_router
from healthathon.sms.routes import router as sms_router
from healthathon.uploads.routes import router as uploads_router
from healthathon.visit.routes import router as visit_router
from healthathon.voice.exotel import router as exotel_voice_router
from healthathon.voice.routes import router as voice_router


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    open_pool()
    yield
    close_pool()


app = FastAPI(title="Healthathon API", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_origins,
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["Content-Type", "Authorization"],
)
app.include_router(confirm_queue_router)
app.include_router(record_router)
app.include_router(entries_router)
app.include_router(patient_app_router)
app.include_router(regimens_router)
app.include_router(visit_router)
app.include_router(sms_router)
app.include_router(exotel_sms_router)
app.include_router(voice_router)
app.include_router(exotel_voice_router)
app.include_router(calls_router)
app.include_router(clinic_day_router)
app.include_router(reading_router)
app.include_router(audit_log_router)
app.include_router(uploads_router)


@app.get("/api/health", tags=["meta"])
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/me", response_model=CurrentUser, tags=["meta"])
def me(user: User) -> CurrentUser:
    return user


@app.get("/api/storage/{key:path}", tags=["storage"], response_class=FileResponse)
def get_stored_file(
    key: str,
    _user: User,
    width: Annotated[
        int | None,
        Query(ge=64, le=1600, description="Send a JPEG copy no wider than this, for thumbnails"),
    ] = None,
) -> FileResponse:
    path = storage.resolve(key)
    if path is None:
        raise HTTPException(404, "Not found")
    if width is not None:
        path = thumbnails.thumbnail(key, width)
        if path is None:
            raise HTTPException(415, "Only an image can be sent smaller")
    return FileResponse(path, headers={"Cache-Control": "private, max-age=3600"})
