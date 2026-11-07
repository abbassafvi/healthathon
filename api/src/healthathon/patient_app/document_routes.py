"""
The patient's own documents: sending a page, and reading one back.

A page the patient photographs goes through the same pipeline as one
scanned at the desk, on the "patient_app" intake channel and with no
uploader named, because no clinic user touched it. It lands on the same
record, so the clinician sees it on that patient's profile without a
second place to look.
"""

import hashlib
from datetime import datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Body, HTTPException, Query
from fastapi.responses import FileResponse

from healthathon import clinic_time, storage
from healthathon.audit import record_event
from healthathon.auth import Conn
from healthathon.entries.models import CAPTURE_ID
from healthathon.patient_app import documents, service
from healthathon.patient_app.models import AppDocument, AppUploadStatus
from healthathon.uploads.agent import DocType
from healthathon.uploads.jobs import Job, registry
from healthathon.uploads.reader_job import MAX_BYTES, start_read
from healthathon.uploads.recover import recover
from healthathon.uploads.writer import existing_document

router = APIRouter()


# A page the patient photographs. Same pipeline as a page scanned at the
# desk, so the reading lands on the clinician's record for this patient
# rather than in a second place nobody looks at.
@router.post(
    "/patients/{patient_id}/documents",
    response_model=AppUploadStatus,
    status_code=201,
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
def post_document(
    patient_id: UUID,
    conn: Conn,
    body: Annotated[bytes, Body(media_type="application/octet-stream", include_in_schema=False)],
    capture_id: Annotated[str, Query(pattern=CAPTURE_ID)],
    doc_type: Annotated[DocType, Query(description="What the page is")],
    captured_at: Annotated[
        datetime | None, Query(description="When the photograph was taken; now by default")
    ] = None,
) -> AppUploadStatus:
    """
    Reading takes seconds, so this returns at once and the phone polls
    the upload. The photograph is stored before anything is read, so a
    failed read never loses the page.
    """
    if not body:
        raise HTTPException(422, "The photograph is empty")
    if len(body) > MAX_BYTES:
        raise HTTPException(413, "The photograph is too large")
    service.require_patient(conn, patient_id)

    jobs = registry()
    job, is_new = jobs.open(capture_id, patient_id)
    if not is_new:
        return _upload_status(job)

    already = existing_document(conn, patient_id, hashlib.sha256(body).digest())
    if already is not None:
        jobs.update(job.id, stage="duplicate", document_id=already)
        return _upload_status(jobs.get(job.id) or job)

    record_event(
        conn,
        None,
        "document.upload",
        "core.patient",
        patient_id,
        new_value={"channel": "patient_app", "doc_type": doc_type},
    )
    start_read(
        job.id,
        capture_id,
        patient_id,
        None,
        doc_type,
        captured_at or clinic_time.now(),
        body,
        channel="patient_app",
    )
    return _upload_status(job)


@router.get("/patients/{patient_id}/uploads/{upload_id}", response_model=AppUploadStatus)
def get_upload(patient_id: UUID, upload_id: str, conn: Conn) -> AppUploadStatus:
    """Where a page has got to. The database answers after a restart."""
    job = registry().get(upload_id) or recover(conn, upload_id)
    if job is None or job.patient_id != patient_id:
        raise HTTPException(404, "No such upload")
    return _upload_status(job)


@router.get("/patients/{patient_id}/documents", response_model=list[AppDocument])
def get_documents(patient_id: UUID, conn: Conn) -> list[AppDocument]:
    """Every document on this patient's record, whoever sent it."""
    return documents.listing(conn, patient_id)


@router.get("/patients/{patient_id}/documents/{document_id}", response_model=AppDocument)
def get_document(patient_id: UUID, document_id: UUID, conn: Conn) -> AppDocument:
    found = documents.one(conn, patient_id, document_id)
    if found is None:
        raise HTTPException(404, "No such document")
    return found


@router.get("/patients/{patient_id}/documents/{document_id}/page", response_class=FileResponse)
def get_document_page(patient_id: UUID, document_id: UUID, conn: Conn) -> FileResponse:
    """The photograph itself, only ever this patient's own."""
    key = documents.page_key(conn, patient_id, document_id)
    path = storage.resolve(key) if key else None
    if path is None:
        raise HTTPException(404, "No such page")
    return FileResponse(path, headers={"Cache-Control": "private, max-age=3600"})


def _upload_status(job: Job) -> AppUploadStatus:
    return AppUploadStatus(
        id=job.id, stage=job.stage, document_id=job.document_id, failure=job.failure
    )
