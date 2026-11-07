"""
Upload jobs while they are being read.

Reading a page takes seconds, so the request returns immediately and the
screen polls. Only the transient part of a job lives here: the durable
answer is the database, where an intake, a document and an extraction
run say what happened. A job the process has forgotten is rebuilt from
those rows, so a restart mid-read does not strand the screen.
"""

import threading
from dataclasses import dataclass, field
from typing import Literal
from uuid import UUID

Stage = Literal["uploading", "reading", "done", "duplicate", "failed"]


@dataclass
class Job:
    id: str
    capture_id: str
    patient_id: UUID
    stage: Stage = "uploading"
    document_id: UUID | None = None
    values_in_record: int = 0
    sent_to_queue: list[dict[str, object]] = field(default_factory=list)
    regimen_id: UUID | None = None
    lines_accepted: int = 0
    lines_for_a_person: int = 0
    failure: str | None = None

    @property
    def finished(self) -> bool:
        return self.stage in ("done", "duplicate", "failed")


class Registry:
    """Thread-safe, process-local. One lock, because the map is tiny."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._jobs: dict[str, Job] = {}
        self._by_capture: dict[str, str] = {}

    def open(self, capture_id: str, patient_id: UUID) -> tuple[Job, bool]:
        """Return the job for this capture, and whether it is new."""
        with self._lock:
            existing = self._by_capture.get(capture_id)
            if existing is not None:
                return self._jobs[existing], False
            # The capture id is the upload id. It is the only name for
            # this read that survives the process, so a job this
            # registry has forgotten can still be found in the database.
            job = Job(id=capture_id, capture_id=capture_id, patient_id=patient_id)
            self._jobs[job.id] = job
            self._by_capture[capture_id] = job.id
            return job, True

    def get(self, upload_id: str) -> Job | None:
        with self._lock:
            return self._jobs.get(upload_id)

    def update(self, upload_id: str, **fields: object) -> None:
        with self._lock:
            job = self._jobs.get(upload_id)
            if job is None:
                return
            for key, value in fields.items():
                setattr(job, key, value)

    def clear(self) -> None:
        with self._lock:
            self._jobs.clear()
            self._by_capture.clear()


_registry = Registry()


def registry() -> Registry:
    return _registry
