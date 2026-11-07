"""
A page that is kept, not read.

A paper survey is photographed at the desk so the clinician can see it,
but nothing on it is read: the survey's answers are the patient's own
words, and the project does not turn them into values. So the page is
stored as a document, with its intake and its one page, and no
extraction run is opened for it.
"""

import hashlib
from datetime import datetime
from typing import Literal
from uuid import UUID

from psycopg import Connection
from psycopg.rows import DictRow

from healthathon.uploads.page_images import page_key, save_page
from healthathon.uploads.writer import open_intake

KeptType = Literal["survey_form"]


def keep_page(
    conn: Connection[DictRow],
    *,
    capture_id: str,
    patient_id: UUID,
    uploaded_by: UUID,
    doc_type: KeptType,
    captured_at: datetime,
    data: bytes,
) -> UUID:
    """Store the photograph in the patient's record and return its document."""
    digest = hashlib.sha256(data).digest()
    _path, width, height = save_page(data, digest.hex())
    key = page_key(digest.hex())
    intake_id = open_intake(conn, capture_id, patient_id, captured_at, uploaded_by)
    doc = conn.execute(
        "INSERT INTO core.document (intake_id, patient_id, doc_type, sha256, storage_key,"
        " page_count) VALUES (%s, %s, %s, %s, %s, 1) RETURNING id",
        (intake_id, patient_id, doc_type, digest, key),
    ).fetchone()
    assert doc is not None
    document_id = UUID(str(doc["id"]))
    conn.execute(
        "INSERT INTO core.document_page (document_id, page_no, storage_key, width_px,"
        " height_px) VALUES (%s, 1, %s, %s, %s)",
        (document_id, key, width, height),
    )
    return document_id
