"""
Where a read page lands in the database.

One intake per capture, one document per file, one page, and one
extraction run naming the detector and the agent that read it. Every
region the agent cited becomes a `core.provenance` row before anything
clinical is written, because `extracted_value.provenance_id` is NOT NULL
and that is the rule the project rests on.
"""

import hashlib
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path
from uuid import UUID

from psycopg import Connection
from psycopg.rows import DictRow

from healthathon.uploads.agent import DocType
from healthathon.uploads.detector import Box


@dataclass(frozen=True)
class StoredPage:
    intake_id: UUID
    document_id: UUID
    page_id: UUID
    run_id: UUID
    storage_key: str
    width: int
    height: int


def existing_document(conn: Connection[DictRow], patient_id: UUID, digest: bytes) -> UUID | None:
    """A file already in this patient's record. UNIQUE (patient_id, sha256)."""
    row = conn.execute(
        "SELECT id FROM core.document WHERE patient_id = %s AND sha256 = %s",
        (patient_id, digest),
    ).fetchone()
    return UUID(str(row["id"])) if row else None


def existing_intake(conn: Connection[DictRow], capture_id: str) -> UUID | None:
    """A retry of the same capture. client_capture_id is UNIQUE."""
    row = conn.execute(
        "SELECT id FROM core.intake WHERE client_capture_id = %s", (capture_id,)
    ).fetchone()
    return UUID(str(row["id"])) if row else None


def open_intake(
    conn: Connection[DictRow],
    capture_id: str,
    patient_id: UUID,
    captured_at: datetime,
    uploaded_by: UUID | None,
    channel: str = "desk_scan",
) -> UUID:
    """
    One intake per capture, naming where the page came from.

    A page the patient photographed arrives on the "patient_app" channel
    with no uploader: `uploaded_by` names a clinic user, and the audit
    must not name one for a page no clinic user touched.
    """
    row = conn.execute(
        "INSERT INTO core.intake (client_capture_id, channel, patient_id, captured_at,"
        " uploaded_by) VALUES (%s, %s, %s, %s, %s) RETURNING id",
        (capture_id, channel, patient_id, captured_at, uploaded_by),
    ).fetchone()
    assert row is not None
    return UUID(str(row["id"]))


def store_page(
    conn: Connection[DictRow],
    *,
    intake_id: UUID,
    patient_id: UUID,
    doc_type: DocType,
    digest: bytes,
    storage_key: str,
    width: int,
    height: int,
    document_date: date | None,
    issuing_source: str | None,
    reader: str,
    reader_version: str,
    agent: str,
    agent_version: str,
    profile_version: str,
    code_commit: str,
) -> StoredPage:
    """
    The document, its one page, and the run that read it. The run names
    both halves of the reader, because a value is reproducible only if
    the detector and the agent are both pinned.
    """
    doc = conn.execute(
        "INSERT INTO core.document (intake_id, patient_id, doc_type, issuing_source,"
        " document_date, sha256, storage_key, page_count) VALUES (%s, %s, %s, %s, %s, %s, %s, 1)"
        " RETURNING id",
        (intake_id, patient_id, doc_type, issuing_source, document_date, digest, storage_key),
    ).fetchone()
    assert doc is not None
    document_id = UUID(str(doc["id"]))

    page = conn.execute(
        "INSERT INTO core.document_page (document_id, page_no, storage_key, width_px,"
        " height_px) VALUES (%s, 1, %s, %s, %s) RETURNING id",
        (document_id, storage_key, width, height),
    ).fetchone()
    assert page is not None

    run = conn.execute(
        "INSERT INTO core.extraction_run (document_id, reader_name, reader_version,"
        " profile_version, code_commit, finished_at) VALUES (%s, %s, %s, %s, %s, now())"
        " RETURNING id",
        (
            document_id,
            f"{reader}+{agent}",
            f"{reader_version}+{agent_version}",
            profile_version,
            code_commit,
        ),
    ).fetchone()
    assert run is not None

    return StoredPage(
        intake_id=intake_id,
        document_id=document_id,
        page_id=UUID(str(page["id"])),
        run_id=UUID(str(run["id"])),
        storage_key=storage_key,
        width=width,
        height=height,
    )


def write_provenance(
    conn: Connection[DictRow],
    page: StoredPage,
    box: Box,
    crop_path: Path | None,
) -> UUID:
    """
    The region a value came from, normalised to the page. The crop's hash
    is stored beside it so the image a person was shown is identifiable
    later, not merely re-derivable.
    """
    crop_digest = hashlib.sha256(crop_path.read_bytes()).digest() if crop_path else None
    row = conn.execute(
        "INSERT INTO core.provenance (kind, document_id, page_id, bbox_x, bbox_y, bbox_w,"
        " bbox_h, crop_sha256) VALUES ('source_document', %s, %s, %s, %s, %s, %s, %s)"
        " RETURNING id",
        (
            page.document_id,
            page.page_id,
            box.x,
            box.y,
            box.w,
            box.h,
            crop_digest,
        ),
    ).fetchone()
    assert row is not None
    return UUID(str(row["id"]))


def analyte_units(conn: Connection[DictRow]) -> dict[str, set[str]]:
    """Every unit we know for each analyte: its canonical one and any it converts from."""
    units: dict[str, set[str]] = {}
    for row in conn.execute("SELECT code, canonical_unit FROM core.analyte").fetchall():
        units[str(row["code"])] = {str(row["canonical_unit"])}
    for row in conn.execute(
        "SELECT analyte_code, from_unit, to_unit FROM core.unit_conversion"
    ).fetchall():
        code = str(row["analyte_code"])
        units.setdefault(code, set()).update({str(row["from_unit"]), str(row["to_unit"])})
    return units


def reportable_ranges(conn: Connection[DictRow]) -> dict[str, tuple[float, float]]:
    """The assay's range, used only to route a value to a person. Never rendered."""
    rows = conn.execute(
        "SELECT analyte_code, min_reportable, max_reportable FROM core.analyte_reportable_range"
    ).fetchall()
    return {
        str(r["analyte_code"]): (float(r["min_reportable"]), float(r["max_reportable"]))
        for r in rows
    }


def same_day_values(
    conn: Connection[DictRow], patient_id: UUID, analyte_code: str, observed_at: date | None
) -> list[str]:
    """What another document in this record says about the same analyte on the same day."""
    if observed_at is None:
        return []
    rows = conn.execute(
        "SELECT value_text FROM core.extracted_value WHERE patient_id = %s"
        " AND analyte_code = %s AND observed_at = %s AND state IN ('accepted', 'confirmed')",
        (patient_id, analyte_code, observed_at),
    ).fetchall()
    return [str(r["value_text"]) for r in rows]
