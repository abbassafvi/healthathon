"""
One photograph, start to finish.

The page is stored, the detector finds every region holding writing, each
region is cut out and saved, and the document agent is shown the crops.
What comes back is checked and written. The order matters: the crop
exists on disk before a value referring to it exists in the database, so
there is never a queue item whose image cannot be rendered.
"""

import hashlib
import subprocess
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from PIL import Image
from psycopg import Connection
from psycopg.rows import DictRow
from psycopg.types.json import Jsonb

from healthathon import storage
from healthathon.config import Settings
from healthathon.uploads.agent import Crop, DocType, DocumentAgent, drop_ungrounded
from healthathon.uploads.consensus import Consensus, combine
from healthathon.uploads.detector import Box, TextDetector, draw_boxes, merge_lines
from healthathon.uploads.normalise import straighten
from healthathon.uploads.page_images import (
    context_page,
    cut_crops,
    page_key,
    save_page,
    storage_path,
    straight_key,
)
from healthathon.uploads.persist import Outcome, persist_lab_report, persist_prescription
from healthathon.uploads.whole_page import fold_near_duplicates
from healthathon.uploads.writer import StoredPage, open_intake, store_page

PROFILE_VERSION = "detect-then-agent/1"
# A ceiling on the regions one page can produce, so a detection that goes
# wrong cannot fill the disk with crops. It was 60, which a dense
# prescription passes halfway down the page: the bottom was dropped and
# nothing said so. Anything this does cut is recorded on the run.
MAX_CROPS = 400


def code_commit() -> str:
    try:
        return subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            capture_output=True,
            text=True,
            timeout=5,
            check=True,
        ).stdout.strip()
    except (subprocess.SubprocessError, OSError):
        return "unknown"


@dataclass(frozen=True)
class PageRead:
    """
    What reading a photograph produced, before anything is written.

    It carries no database handle on purpose. Detection and the model
    calls take seconds to minutes, and holding a pooled connection
    across them left it idle in a transaction against a pool of
    sixteen: a slow provider could take the pool down with it.
    """

    digest: bytes
    storage_key: str
    width: int
    height: int
    boxes: list[Box]
    crops: dict[int, Crop]
    agreed: Consensus
    regions_dropped: int


def read_page(
    *,
    doc_type: DocType,
    data: bytes,
    detector: TextDetector,
    agent: DocumentAgent,
    settings: Settings,
) -> PageRead:
    """
    Store the photograph, find its regions and read them. No database.

    Raises if the detector or the agent cannot do its work. The page
    itself is on disk either way, so the upload can be tried again.
    """
    digest_bytes = hashlib.sha256(data).digest()
    digest = digest_bytes.hex()
    page_path, width, height = save_page(data, digest)

    # Everything after this reads the straightened page, and the boxes
    # are in its frame, so it is the page the record points at. The
    # photograph as it arrived stays beside it under its own name.
    if settings.normalise_deskew:
        straight = storage.resolve(straight_key(digest))
        if straight is None:
            page_path, _ = straighten(page_path, storage_path(straight_key(digest)))
        else:
            page_path = straight
        with Image.open(page_path) as img:
            width, height = img.size

    boxes = detector.detect(page_path)
    if doc_type == "prescription":
        # A medicine is written across the line, not inside one run of
        # text. A laboratory value is the opposite and keeps its own cell.
        boxes = merge_lines(boxes)
    found = len(boxes)
    boxes = boxes[:MAX_CROPS]
    if not boxes:
        raise ValueError("The page could not be found in this photograph.")
    draw_boxes(page_path, boxes, page_path.parent / "boxes.png")

    crops = cut_crops(page_path, boxes, digest)
    # Read the page more than once and compare: "ask again". Whatever the
    # agent is, nothing citing a region that was never shown gets past
    # here, because an invented index would index into boxes.
    shown = [crops[i] for i in sorted(crops)]
    # The reads are independent of each other, and each one is almost
    # entirely waiting on a reply. Run together, three reads cost about
    # what one costs; run one after another they cost three times as
    # much and tell you nothing extra.
    reads = max(settings.agent_reads, 1)
    context = context_page(page_path, digest, settings.agent_context_page_px)
    if reads == 1:
        passes = [drop_ungrounded(agent.read(doc_type, context, shown), len(boxes))]
    else:
        with ThreadPoolExecutor(max_workers=reads) as pool:
            futures = [pool.submit(agent.read, doc_type, context, shown) for _ in range(reads)]
            passes = [drop_ungrounded(f.result(), len(boxes)) for f in futures]
    agreed = combine(passes)
    reading = agreed.reading
    if doc_type == "prescription" and reading.lines:
        # Each read folds its own repeats, but the reads are then put
        # together by region, so the same medicine landing on two
        # regions in two different reads survives as two medicines.
        folded, argued = fold_near_duplicates(reading.lines, boxes, list(range(len(boxes))))
        reading.lines = folded
        reading.ungrounded = sorted(set(reading.ungrounded) | argued)

    return PageRead(
        digest=digest_bytes,
        storage_key=page_key(digest)
        if not settings.normalise_deskew or page_path.name == "page-1.png"
        else straight_key(digest),
        width=width,
        height=height,
        boxes=boxes,
        crops=crops,
        agreed=agreed,
        regions_dropped=found - len(boxes),
    )


def run(
    conn: Connection[DictRow],
    *,
    capture_id: str,
    patient_id: UUID,
    uploaded_by: UUID | None,
    doc_type: DocType,
    captured_at: datetime,
    data: bytes,
    detector: TextDetector,
    agent: DocumentAgent,
    settings: Settings,
    channel: str = "desk_scan",
) -> Outcome:
    """
    Read one page into the record, both phases on one connection.

    Kept for callers that have a connection anyway and do not mind
    holding it. The upload route reads first and writes afterwards, so
    no connection waits on a model.
    """
    read = read_page(
        doc_type=doc_type, data=data, detector=detector, agent=agent, settings=settings
    )
    return write_reading(
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


def write_reading(
    conn: Connection[DictRow],
    read: PageRead,
    *,
    capture_id: str,
    patient_id: UUID,
    uploaded_by: UUID | None,
    doc_type: DocType,
    captured_at: datetime,
    detector: TextDetector,
    agent: DocumentAgent,
    settings: Settings,
    channel: str = "desk_scan",
) -> Outcome:
    """
    The intake, the document, the run and everything the checks decided,
    written in one transaction once the reading is already in hand.
    """
    agreed = read.agreed
    reading = agreed.reading
    boxes, crops = read.boxes, read.crops

    intake_id = open_intake(conn, capture_id, patient_id, captured_at, uploaded_by, channel)
    page: StoredPage = store_page(
        conn,
        intake_id=intake_id,
        patient_id=patient_id,
        doc_type=doc_type,
        digest=read.digest,
        storage_key=read.storage_key,
        width=read.width,
        height=read.height,
        document_date=reading.document_date,
        issuing_source=reading.issuing_source,
        reader=detector.name,
        reader_version=detector.version,
        agent=agent.name,
        agent_version=agent.version,
        profile_version=PROFILE_VERSION,
        code_commit=code_commit(),
    )
    conn.execute(
        "UPDATE core.extraction_run SET raw_output = %s WHERE id = %s",
        (
            Jsonb(
                {
                    "boxes": [{"x": b.x, "y": b.y, "w": b.w, "h": b.h} for b in boxes],
                    "unreadable": reading.unreadable,
                    "reads": agreed.reads,
                    # Regions the ceiling cut. Not zero means the bottom
                    # of the page was never read.
                    "regions_dropped": read.regions_dropped,
                }
            ),
            page.run_id,
        ),
    )

    if doc_type == "prescription":
        return persist_prescription(
            conn,
            page,
            patient_id,
            reading,
            boxes,
            crops,
            settings,
            agreed.reads,
            agreed.line_votes,
            agreed.other_reads,
        )
    outcome = persist_lab_report(
        conn, page, patient_id, reading, boxes, crops, settings, agreed.other_reads
    )
    conn.execute(
        "UPDATE core.extraction_run SET raw_output = raw_output || %s WHERE id = %s",
        (
            Jsonb(
                {
                    "confidence": {str(k): v for k, v in outcome.confidence.items()},
                    "confidence_threshold": settings.confidence_threshold,
                }
            ),
            page.run_id,
        ),
    )
    return outcome
