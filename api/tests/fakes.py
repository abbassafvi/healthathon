"""
Stand-ins for the two halves of the reader.

Every upload test runs through these, so no test needs paddlepaddle
installed and no test reaches a model provider over the network.
"""

import io
import time
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw

from healthathon.uploads.agent import Crop, DocType, DocumentReading
from healthathon.uploads.detector import Box


class FakeDetector:
    """Returns the boxes it was built with, in the order given."""

    name = "fake-detector"
    version = "1"

    def __init__(self, boxes: list[Box]) -> None:
        self.boxes = boxes
        self.pages: list[Path] = []

    def detect(self, page: Path) -> list[Box]:
        self.pages.append(page)
        return list(self.boxes)


class FakeAgent:
    """
    Returns a reading prepared by the test, and records what it was
    shown. Given several readings it returns one per pass, which is how
    a reader that changes its answer is tested.
    """

    name = "fake-agent"
    version = "1"

    def __init__(self, reading: DocumentReading | Exception | list[DocumentReading]) -> None:
        self.reading = reading
        self.seen: list[Crop] = []
        self.doc_types: list[str] = []
        self.reads = 0

    def read(self, doc_type: DocType, page: Path, crops: list[Crop]) -> DocumentReading:
        self.seen = list(crops)
        self.doc_types.append(doc_type)
        self.reads += 1
        if isinstance(self.reading, Exception):
            raise self.reading
        if isinstance(self.reading, list):
            return self.reading[min(self.reads - 1, len(self.reading) - 1)]
        return self.reading


def page_image(width: int = 1240, height: int = 1754, blurry: bool = False) -> bytes:
    """
    A page with some marks on it. Sharp by default; `blurry` makes a flat
    grey page, which scores near zero on the legibility check.
    """
    img = Image.new("RGB", (width, height), "white")
    if not blurry:
        draw = ImageDraw.Draw(img)
        for row in range(10):
            y = 120 + row * 130
            draw.rectangle((100, y, 1100, y + 60), fill=(20, 20, 20))
            draw.rectangle((140, y + 12, 1060, y + 44), fill=(245, 245, 245))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def upload(client: Any, patient: str, data: bytes, **over: Any) -> Any:
    fields = {
        "client_capture_id": over.pop("capture", "cap-1"),
        "patient_id": patient,
        "doc_type": over.pop("doc_type", "lab_report"),
        "captured_at": "2026-10-20T09:30:00+05:30",
    }
    fields.update({k: str(v) for k, v in over.items()})
    return client.post(
        "/api/uploads",
        data=fields,
        files={"file": ("page.png", data, "image/png")},
    )


def wait_for(client: Any, upload_id: str, timeout_s: float = 30.0) -> dict[str, Any]:
    """Poll until the read finishes, as the screen does."""
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        body = client.get(f"/api/uploads/{upload_id}").json()
        if body["stage"] in ("done", "duplicate", "failed"):
            return dict(body)
        time.sleep(0.05)
    raise AssertionError(f"upload {upload_id} did not finish: {body}")
