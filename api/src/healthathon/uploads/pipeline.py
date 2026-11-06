"""
One photograph, start to finish.

The page is stored, the detector finds every region holding writing, each
region is cut out and saved, and the document agent is shown the crops.
What comes back is checked and written. The order matters: the crop
exists on disk before a value referring to it exists in the database, so
there is never a queue item whose image cannot be rendered.
"""

import hashlib
import io
import subprocess
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path
from uuid import UUID

from PIL import Image, ImageDraw, ImageFont
from psycopg import Connection
from psycopg.rows import DictRow
from psycopg.types.json import Jsonb

from healthathon import storage
from healthathon.config import Settings, get_settings
from healthathon.uploads.agent import Crop, DocType, DocumentAgent, drop_ungrounded
from healthathon.uploads.consensus import combine
from healthathon.uploads.detector import Box, TextDetector, draw_boxes, merge_lines
from healthathon.uploads.normalise import straighten
from healthathon.uploads.persist import Outcome, persist_lab_report, persist_prescription
from healthathon.uploads.whole_page import fold_near_duplicates
from healthathon.uploads.writer import StoredPage, open_intake, store_page

PROFILE_VERSION = "detect-then-agent/1"
# Padding around a detected region, as a fraction of its size. A crop cut
# exactly on the box loses the ascenders and the decimal point, but a
# quarter of a tall handwritten line reaches well into the line below,
# which is how one crop came to hold three medicines.
CROP_PAD_X = 0.06
CROP_PAD_Y = 0.10
MAX_CROPS = 60


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


def _page_key(digest: str) -> str:
    return f"documents/{digest[:2]}/{digest}/page-1.png"


def _context_key(digest: str) -> str:
    return f"documents/{digest[:2]}/{digest}/context.jpg"


def context_page(page: Path, digest: str, widest: int) -> Path:
    """
    A smaller copy of the page, for the agent's sense of the layout.

    The prompt forbids reading a value off the whole page, so it is
    context and nothing else. Sending it at full size meant the same
    megabytes travelled with every call, six times for one document.
    """
    key = _context_key(digest)
    made = storage.resolve(key)
    if made is not None:
        return made
    with Image.open(page) as opened:
        img = opened.convert("RGB")
    if max(img.size) > widest:
        img.thumbnail((widest, widest))
    # JPEG, because a photographed page is a photograph: the same pixels
    # as PNG cost several times as much to send, for an image the prompt
    # forbids reading anything off.
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=80, optimize=True)
    storage.save(key, buf.getvalue())
    made = storage.resolve(key)
    assert made is not None
    return made


def _straight_key(digest: str) -> str:
    return f"documents/{digest[:2]}/{digest}/straight.png"


def _crop_key(digest: str, index: int) -> str:
    return f"documents/{digest[:2]}/{digest}/crops/{index:03d}.png"


def _labelled_key(digest: str, index: int) -> str:
    """Only the agent reads these, so they live apart from what a person sees."""
    return f"documents/{digest[:2]}/{digest}/labelled/{index:03d}.png"


def _storage_path(key: str) -> Path:
    """Where a key lives on disk, whether or not anything is there yet."""
    root = get_settings().storage_dir.resolve()
    return root / key


def save_page(data: bytes, digest: str) -> tuple[Path, int, int]:
    """
    Store the photograph as PNG and report its size. Re-encoding once
    here means every later crop reads the same pixels the detector saw.
    """
    key = _page_key(digest)
    path = storage.resolve(key)
    if path is None:
        with Image.open(io.BytesIO(data)) as img:
            storage.save_image(key, img.convert("RGB"))
        path = storage.resolve(key)
    assert path is not None
    with Image.open(path) as img:
        return path, img.width, img.height


# A crop shown to the agent is never smaller than this, and its index is
# printed in a band this tall.
MIN_SHOWN_H = 110
LABEL_H = 34


def _label_font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for path in (
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ):
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    return ImageFont.load_default()


def _labelled(region: Image.Image, index: int) -> Image.Image:
    """
    The crop with its own index printed above it, enlarged if it is small.

    The agent has to say which region each reading came from. Asked to
    count the images it was shown, it miscounts: on a three-column
    laboratory table it returned 8, 10, 12, 14, a tidy arithmetic
    sequence pointing at the wrong rows, while reading every value
    correctly. Printing the number into the image removes the counting.

    A line of a photographed page is about thirty pixels tall, and at
    that size neither the number nor the handwriting survives. Both are
    enlarged together: every reading on one card came back citing box 0
    and box 12 until they were.
    """
    if region.height < MIN_SHOWN_H:
        scale = MIN_SHOWN_H / max(region.height, 1)
        region = region.resize(
            (max(int(region.width * scale), 1), MIN_SHOWN_H), Image.Resampling.LANCZOS
        )
    canvas = Image.new("RGB", (max(region.width, 160), region.height + LABEL_H), "white")
    canvas.paste(region.convert("RGB"), (0, LABEL_H))
    draw = ImageDraw.Draw(canvas)
    draw.rectangle((0, 0, canvas.width, LABEL_H - 1), fill=(20, 20, 20))
    draw.text((6, 4), f"CROP {index}", fill=(255, 255, 255), font=_label_font(LABEL_H - 12))
    return canvas


def cut_crops(page: Path, boxes: list[Box], digest: str) -> dict[int, Crop]:
    """Cut every detected region out of the page, padded, and store it."""
    crops: dict[int, Crop] = {}
    with Image.open(page) as img:
        width, height = img.size
        for index, box in enumerate(boxes):
            left, top, right, bottom = box.pixels(width, height)
            pad_x = int((right - left) * CROP_PAD_X)
            pad_y = int((bottom - top) * CROP_PAD_Y)
            region = (
                max(left - pad_x, 0),
                max(top - pad_y, 0),
                min(right + pad_x, width),
                min(bottom + pad_y, height),
            )
            if region[2] <= region[0] or region[3] <= region[1]:
                continue
            cut = img.crop(region)
            key = _crop_key(digest, index)
            storage.save_image(key, cut)
            label_key = _labelled_key(digest, index)
            storage.save_image(label_key, _labelled(cut, index))
            path, labelled = storage.resolve(key), storage.resolve(label_key)
            assert path is not None and labelled is not None
            crops[index] = Crop(index=index, path=path, storage_key=key, labelled=labelled, box=box)
    return crops


def run(
    conn: Connection[DictRow],
    *,
    capture_id: str,
    patient_id: UUID,
    uploaded_by: UUID,
    doc_type: DocType,
    captured_at: datetime,
    data: bytes,
    detector: TextDetector,
    agent: DocumentAgent,
    settings: Settings,
) -> Outcome:
    """
    Read one page into the record. Raises if the detector or the agent
    cannot do its work; the caller turns that into a failed upload, and
    the page itself is already stored either way.
    """
    digest_bytes = hashlib.sha256(data).digest()
    digest = digest_bytes.hex()
    page_path, width, height = save_page(data, digest)

    # Everything after this reads the straightened page, and the boxes
    # are in its frame, so it is the page the record points at. The
    # photograph as it arrived stays beside it under its own name.
    if settings.normalise_deskew:
        straight = storage.resolve(_straight_key(digest))
        if straight is None:
            page_path, _ = straighten(page_path, _storage_path(_straight_key(digest)))
        else:
            page_path = straight
        with Image.open(page_path) as img:
            width, height = img.size

    boxes = detector.detect(page_path)
    if doc_type == "prescription":
        # A medicine is written across the line, not inside one run of
        # text. A laboratory value is the opposite and keeps its own cell.
        boxes = merge_lines(boxes)
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

    intake_id = open_intake(conn, capture_id, patient_id, captured_at, uploaded_by)
    page: StoredPage = store_page(
        conn,
        intake_id=intake_id,
        patient_id=patient_id,
        doc_type=doc_type,
        digest=digest_bytes,
        storage_key=_page_key(digest)
        if not settings.normalise_deskew or page_path.name == "page-1.png"
        else _straight_key(digest),
        width=width,
        height=height,
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
                    "reads": len(passes),
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
            agreed.disagreed,
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
