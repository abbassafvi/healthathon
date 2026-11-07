"""
Photographs in, a document and its values out.

The request carries the file, so the pipeline has something to read. It
is idempotent by `client_capture_id`, which the device generates when
the file is picked, and a file already in the patient's record is
recognised by its hash before anything is read a second time.
"""

import hashlib
from datetime import datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from healthathon.audit import record_event
from healthathon.auth import Conn, CurrentUser, User
from healthathon.uploads.agent import DocType
from healthathon.uploads.jobs import Job, registry
from healthathon.uploads.models import QueueReason, UploadOutcome, UploadStatus
from healthathon.uploads.reader_job import MAX_BYTES, start_read
from healthathon.uploads.recover import recover
from healthathon.uploads.writer import existing_document

router = APIRouter(prefix="/api/uploads", tags=["uploads"])

def _status(job: Job) -> UploadStatus:
    outcome = None
    if job.stage == "done" and job.document_id is not None:
        outcome = UploadOutcome(
            document_id=job.document_id,
            values_in_record=job.values_in_record,
            sent_to_queue=[QueueReason(**r) for r in job.sent_to_queue],  # type: ignore[arg-type]
            regimen_id=job.regimen_id,
            lines_accepted=job.lines_accepted,
            lines_for_a_person=job.lines_for_a_person,
        )
    return UploadStatus(id=job.id, stage=job.stage, outcome=outcome, failure=job.failure)


# Sync, like every other route here, and that is not a style choice: the
# database dependency is synchronous, and the audit chain takes a lock
# held to the end of its transaction. On the event loop, a request
# waiting for that lock stops the loop that has to commit the request
# holding it, and the two wait on each other forever. In the threadpool
# they do not.
@router.post("", response_model=UploadStatus, status_code=201)
def create_upload(
    conn: Conn,
    user: User,
    file: Annotated[UploadFile, File(description="The photograph of the page")],
    client_capture_id: Annotated[str, Form()],
    patient_id: Annotated[UUID, Form()],
    doc_type: Annotated[DocType, Form()],
    captured_at: Annotated[datetime, Form()],
) -> UploadStatus:
    data = file.file.read()
    if not data:
        raise HTTPException(422, "The photograph is empty")
    if len(data) > MAX_BYTES:
        raise HTTPException(413, "The photograph is larger than 20 MB")

    patient = conn.execute("SELECT id FROM core.patient WHERE id = %s", (patient_id,)).fetchone()
    if patient is None:
        raise HTTPException(404, "No such patient")

    jobs = registry()
    job, is_new = jobs.open(client_capture_id, patient_id)
    if not is_new:
        return _status(job)

    already = existing_document(conn, patient_id, hashlib.sha256(data).digest())
    if already is not None:
        jobs.update(job.id, stage="duplicate", document_id=already)
        return _status(jobs.get(job.id) or job)

    _record_upload(conn, user, patient_id, file.filename or "page", doc_type)
    start_read(job.id, client_capture_id, patient_id, user.id, doc_type, captured_at, data)
    return _status(job)


def _record_upload(
    conn: Conn, user: CurrentUser, patient_id: UUID, file_name: str, doc_type: str
) -> None:
    record_event(
        conn,
        user,
        "document.upload",
        "core.patient",
        patient_id,
        new_value={"file_name": file_name, "doc_type": doc_type},
    )


@router.get("/{upload_id}", response_model=UploadStatus)
def get_upload(conn: Conn, upload_id: str, _user: User) -> UploadStatus:
    """
    Where this upload got to. The registry answers while the process
    that started the read is still running; after a restart, or from a
    second worker, the database does.
    """
    job = registry().get(upload_id) or recover(conn, upload_id)
    if job is None:
        raise HTTPException(404, "No such upload")
    return _status(job)
