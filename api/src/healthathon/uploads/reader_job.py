"""
Reading a page off the request, and what a person is told if it fails.

Both doors into the pipeline use this: the clinic's upload page and the
patient's phone. The read takes seconds to minutes, so the request
returns at once and the screen polls the job.
"""

import logging
import threading
from datetime import datetime
from uuid import UUID

from healthathon.audit import record_event
from healthathon.config import get_settings
from healthathon.db import open_pool
from healthathon.uploads import pipeline
from healthathon.uploads.agent import DocType
from healthathon.uploads.factory import build_agent, build_detector
from healthathon.uploads.jobs import registry
from healthathon.uploads.providers import ModelUnavailable

log = logging.getLogger(__name__)

# What a person is told when the read fails. The provider's own words
# name a host and an HTTP status, which say nothing about the page in
# their hand and nothing about what to do next. The real message goes to
# the log, where whoever runs this can read it.
UNREADABLE = "The reader could not be reached. The photograph is saved, so try again."
UNEXPECTED = "Something went wrong reading this page. The photograph is saved, so try again."

MAX_BYTES = 20 * 1024 * 1024


def start_read(
    upload_id: str,
    capture_id: str,
    patient_id: UUID,
    uploaded_by: UUID | None,
    doc_type: DocType,
    captured_at: datetime,
    data: bytes,
    channel: str = "desk_scan",
) -> None:
    """Hand the page to a thread and return. The job carries the answer."""
    threading.Thread(
        target=read_in_background,
        args=(
            upload_id,
            capture_id,
            patient_id,
            uploaded_by,
            doc_type,
            captured_at,
            data,
            channel,
        ),
        daemon=True,
    ).start()


def read_in_background(
    upload_id: str,
    capture_id: str,
    patient_id: UUID,
    uploaded_by: UUID | None,
    doc_type: DocType,
    captured_at: datetime,
    data: bytes,
    channel: str = "desk_scan",
) -> None:
    """
    The read itself, off the request. Its own connections and its own
    transaction: the request that started it has already committed.

    Three phases, and the long one holds no connection. Detection and
    the model calls take seconds to minutes, and a pooled connection
    held across them sat idle in a transaction against a pool of
    sixteen, so a slow provider could starve every other request.
    """
    jobs = registry()
    jobs.update(upload_id, stage="reading")
    settings = get_settings()
    detector = build_detector()
    try:
        with open_pool().connection() as conn:
            agent = build_agent(conn, settings)
        read = pipeline.read_page(
            doc_type=doc_type,
            data=data,
            detector=detector,
            agent=agent,
            settings=settings,
        )
        with open_pool().connection() as conn:
            outcome = pipeline.write_reading(
                conn,
                read,
                capture_id=capture_id,
                patient_id=patient_id,
                uploaded_by=uploaded_by,
                doc_type=doc_type,
                captured_at=captured_at,
                detector=detector,
                agent=agent,
                settings=settings,
                channel=channel,
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
