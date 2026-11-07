"""
Photographs in, a document and its values out.

The request carries the file, so the pipeline has something to read. It
is idempotent by `client_capture_id`, which the device generates when
the file is picked, and a file already in the patient's record is
recognised by its hash before anything is read a second time.
"""

import hashlib
import logging
import threading
from datetime import datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from healthathon.audit import record_event
from healthathon.auth import Conn, CurrentUser, User
from healthathon.config import get_settings
from healthathon.db import open_pool
from healthathon.uploads import pipeline
from healthathon.uploads.agent import DocType
from healthathon.uploads.factory import build_agent, build_detector
from healthathon.uploads.jobs import Job, registry
from healthathon.uploads.models import QueueReason, UploadOutcome, UploadStatus
from healthathon.uploads.providers import ModelUnavailable
from healthathon.uploads.writer import existing_document

router = APIRouter(prefix="/api/uploads", tags=["uploads"])

log = logging.getLogger(__name__)

# What a clinician is told when the read fails. The provider's own words
# name a host and an HTTP status, which say nothing about the page in
# their hand and nothing about what to do next. The real message goes to
# the log, where whoever runs this can read it.
UNREADABLE = "The reader could not be reached. The photograph is saved, so try again."
UNEXPECTED = "Something went wrong reading this page. The photograph is saved, so try again."

MAX_BYTES = 20 * 1024 * 1024


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


def _read_in_background(
    upload_id: str,
    capture_id: str,
    patient_id: UUID,
    uploaded_by: UUID,
    doc_type: DocType,
    captured_at: datetime,
    data: bytes,
) -> None:
    """
    The read itself, off the request. Its own connection and its own
    transaction: the request that started it has already committed.
    """
    jobs = registry()
    jobs.update(upload_id, stage="reading")
    settings = get_settings()
    try:
        with open_pool().connection() as conn:
            outcome = pipeline.run(
                conn,
                capture_id=capture_id,
                patient_id=patient_id,
                uploaded_by=uploaded_by,
                doc_type=doc_type,
                captured_at=captured_at,
                data=data,
                detector=build_detector(),
                agent=build_agent(conn, settings),
                settings=settings,
            )
            record_event(
                conn,
                None,
                "document.read",
                "core.document",
                outcome.document_id,
                new_value={
                    "values_in_record": outcome.values_in_record,
                    "sent_to_queue": outcome.sent_to_queue,
                },
            )
        jobs.update(
            upload_id,
            stage="done",
            document_id=outcome.document_id,
            values_in_record=outcome.values_in_record,
            sent_to_queue=outcome.sent_to_queue,
            regimen_id=outcome.regimen_id,
            lines_accepted=outcome.lines_accepted,
            lines_for_a_person=outcome.lines_for_a_person,
        )
    except ValueError as exc:
        # The pipeline raises this with a sentence meant for a person.
        jobs.update(upload_id, stage="failed", failure=str(exc))
    except ModelUnavailable as exc:
        log.warning("upload %s: the document agent did not answer: %s", upload_id, exc)
        jobs.update(upload_id, stage="failed", failure=UNREADABLE)
    except Exception:  # noqa: BLE001 - any failure is the page's, not the screen's
        log.exception("upload %s: the read failed", upload_id)
        jobs.update(upload_id, stage="failed", failure=UNEXPECTED)


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
    threading.Thread(
        target=_read_in_background,
        args=(job.id, client_capture_id, patient_id, user.id, doc_type, captured_at, data),
        daemon=True,
    ).start()
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
def get_upload(upload_id: str, _user: User) -> UploadStatus:
    job = registry().get(upload_id)
    if job is None:
        raise HTTPException(404, "No such upload")
    return _status(job)
