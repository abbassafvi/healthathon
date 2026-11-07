"""
A reader for development and the browser tests.

Neither half needs paddlepaddle or a network. The detector is real, if
crude: it finds bands of dark pixels, which is enough for a generated
page. The agent is not real, and says so. Both are reached only when
configuration asks for them by name, never as a silent fallback from a
provider that failed, because a page read by a stand-in must never be
mistaken for a page that was read.
"""

from pathlib import Path

from PIL import Image

from healthathon.uploads.agent import Crop, DocType, DocumentReading, LabValue, RegimenLine
from healthathon.uploads.detector import Box, sort_reading_order

# A row counts as writing when this fraction of it is darker than the threshold.
INK = 160
MIN_ROW_COVERAGE = 0.02
MIN_BAND_PX = 4


class StubDetector:
    """Horizontal bands of ink. Enough for a page this repository generated."""

    name = "stub-detector"
    version = "1"

    def detect(self, page: Path) -> list[Box]:
        with Image.open(page) as img:
            grey = img.convert("L")
            width, height = grey.size
            # One byte per pixel in mode L, so a row is a flat slice.
            data = grey.tobytes()

        rows = [
            sum(1 for x in range(0, width, 4) if data[y * width + x] < INK) / max(width / 4, 1)
            >= MIN_ROW_COVERAGE
            for y in range(height)
        ]

        boxes: list[Box] = []
        start: int | None = None
        for y, inked in enumerate([*rows, False]):
            if inked and start is None:
                start = y
            elif not inked and start is not None:
                if y - start >= MIN_BAND_PX:
                    boxes.append(self._band(data, width, height, start, y))
                start = None
        return sort_reading_order(boxes)

    @staticmethod
    def _band(data: bytes, width: int, height: int, top: int, bottom: int) -> Box:
        left, right = width, 0
        for y in range(top, bottom):
            row = y * width
            for x in range(0, width, 2):
                if data[row + x] < INK:
                    left = min(left, x)
                    right = max(right, x)
        if right <= left:
            left, right = 0, width
        return Box(
            x=left / width,
            y=top / height,
            w=(right - left) / width,
            h=(bottom - top) / height,
        ).clamped()


class StubAgent:
    """
    Canned readings, keyed to what the page actually holds rather than to
    a file name. Every value it returns still goes through the five
    checks, so what reaches the record is decided by the checks and not
    by this class.
    """

    name = "stub-agent"
    version = "1"

    ANALYTES = ("hba1c", "fpg", "creatinine", "ldl")

    def read(self, doc_type: DocType, page: Path, crops: list[Crop]) -> DocumentReading:
        if doc_type == "prescription":
            return self._prescription(crops)
        return self._lab(crops)

    def _lab(self, crops: list[Crop]) -> DocumentReading:
        texts = ("7.4", "162", "0.92", "118")
        units = ("%", "mg/dL", "mg/dL", "mg/dL")
        values = [
            LabValue(
                box_index=crop.index,
                analyte_code=self.ANALYTES[i],
                value_text=texts[i],
                unit_text=units[i],
            )
            for i, crop in enumerate(crops[: len(self.ANALYTES)])
        ]
        return DocumentReading(values=values, issuing_source="Stub reader (development)")

    def _prescription(self, crops: list[Crop]) -> DocumentReading:
        # One band is a page with nothing this reader can stand behind.
        if len(crops) < 2:
            return DocumentReading()
        lines = [
            RegimenLine(crops[0].index, "Tab. Metformin", "500 mg", "1-0-1"),
            RegimenLine(crops[1].index, "Tab. Vildagliptin", "50 mg", "1-0-1"),
        ]
        return DocumentReading(lines=lines, issuing_source="Stub reader (development)")
