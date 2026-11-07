"""
Text detection: where the writing is on a page, never what it says.

PaddleOCR is used for detection only. Its recogniser is deliberately not
run: a crop is read by the document agent, which has the whole region in
front of it and the document's own conventions in its prompt. Detection
gives the box, and the box is what a value is later traced back to.
"""

from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from PIL import Image, ImageDraw


@dataclass(frozen=True)
class Box:
    """A region on a page, normalised to 0..1 so it survives any resize."""

    x: float
    y: float
    w: float
    h: float

    def clamped(self) -> "Box":
        x = min(max(self.x, 0.0), 1.0)
        y = min(max(self.y, 0.0), 1.0)
        return Box(x, y, min(self.w, 1.0 - x), min(self.h, 1.0 - y))

    def pixels(self, width: int, height: int) -> tuple[int, int, int, int]:
        return (
            int(self.x * width),
            int(self.y * height),
            int((self.x + self.w) * width),
            int((self.y + self.h) * height),
        )


class TextDetector(Protocol):
    """Finds the regions that hold writing. Returns them in reading order."""

    name: str
    version: str

    def detect(self, page: Path) -> list[Box]: ...


def sort_reading_order(boxes: list[Box], line_tolerance: float = 0.012) -> list[Box]:
    """
    Top to bottom, then left to right within a line. Two boxes are on the
    same line when their tops are within a tolerance of each other, which
    keeps a value beside the test it belongs to.

    The lines are built first and each is then sorted on its own. An
    earlier version compared each box against a single neighbour, which
    left a three-column row ordered value, name, unit: the crops then
    reached the agent out of order.
    """
    lines: list[list[Box]] = []
    for box in sorted(boxes, key=lambda b: b.y):
        if lines and abs(lines[-1][0].y - box.y) <= line_tolerance:
            lines[-1].append(box)
        else:
            lines.append([box])
    return [box for line in lines for box in sorted(line, key=lambda b: b.x)]


class PaddleDetector:
    """
    PaddleOCR's detection model. Imported lazily, because paddlepaddle is
    an optional install: nothing but a real read needs it.
    """

    name = "paddleocr-det"

    def __init__(self, use_onednn: bool = False, model_name: str = "") -> None:
        from paddleocr import TextDetection

        # oneDNN is off by default: paddlepaddle 3.3.1 cannot convert one of
        # the detection model's attributes under that backend and raises
        # NotImplementedError on the first page. Plain CPU inference reads
        # the same page without complaint.
        options: dict[str, object] = {"enable_mkldnn": use_onednn}
        if model_name:
            options["model_name"] = model_name
        self._model = TextDetection(**options)
        self.version = self._paddleocr_version()

    @staticmethod
    def _paddleocr_version() -> str:
        from importlib.metadata import PackageNotFoundError, version

        try:
            return version("paddleocr")
        except PackageNotFoundError:  # pragma: no cover - only without the extra
            return "unknown"

    def detect(self, page: Path) -> list[Box]:
        with Image.open(page) as img:
            width, height = img.size
        boxes: list[Box] = []
        for result in self._model.predict(str(page)):
            for poly in result["dt_polys"]:
                xs = [float(p[0]) for p in poly]
                ys = [float(p[1]) for p in poly]
                boxes.append(
                    Box(
                        x=min(xs) / width,
                        y=min(ys) / height,
                        w=(max(xs) - min(xs)) / width,
                        h=(max(ys) - min(ys)) / height,
                    ).clamped()
                )
        return sort_reading_order([b for b in boxes if b.w > 0 and b.h > 0])


def merge_lines(
    boxes: list[Box], line_tolerance: float = 0.012, max_gap: float = 0.08
) -> list[Box]:
    """
    One region per run of writing that belongs together.

    A prescription writes a medicine across the page: the drug on the
    left, the dose and schedule further right, and the detector finds
    each as its own region. Asked for a medicine with a drug and a dose
    citing one region, an agent shown those separately can only answer
    with nothing, which is what it did.

    Only neighbours join. A consultation card keeps measurements down
    one side and the prescribing on the other, and merging on height
    alone swept a whole row into one crop: the glucose on the left and
    the medicine on the right arrived as a single smear that read as
    neither. A gap wider than `max_gap` of the page is a column break,
    not a space.

    A laboratory report is never merged at all: its value belongs to its
    own cell, and a value pointing at a whole row points at the wrong
    number.
    """
    if not boxes:
        return []
    rows: list[list[Box]] = []
    for box in sorted(boxes, key=lambda b: b.y):
        if rows and abs(rows[-1][0].y - box.y) <= line_tolerance:
            rows[-1].append(box)
        else:
            rows.append([box])

    merged: list[Box] = []
    for row in rows:
        group: list[Box] = []
        for box in sorted(row, key=lambda b: b.x):
            if group and box.x - (group[-1].x + group[-1].w) > max_gap:
                merged.append(_span(group))
                group = []
            group.append(box)
        if group:
            merged.append(_span(group))
    return sort_reading_order(_without_overlap(merged))


def _without_overlap(boxes: list[Box]) -> list[Box]:
    """
    Trim a region so it stops where the next one starts.

    PaddleOCR returns tall polygons for slanted handwriting, and they
    swallow the line below. One crop on a real card held three
    medicines, so a reading could honestly be said to sit on any of
    three regions and the wrong one won. Only the vertical is trimmed:
    the columns were already separated by the gap rule above.
    """
    ordered = sorted(boxes, key=lambda b: b.y)
    trimmed: list[Box] = []
    for i, box in enumerate(ordered):
        bottom = box.y + box.h
        for other in ordered[i + 1 :]:
            # Only a region that starts lower and actually shares this
            # one's horizontal run can cut it short.
            if other.y <= box.y:
                continue
            if other.x >= box.x + box.w or other.x + other.w <= box.x:
                continue
            bottom = min(bottom, other.y)
            break
        height = max(bottom - box.y, 0.004)
        trimmed.append(Box(x=box.x, y=box.y, w=box.w, h=height))
    return trimmed


def _span(group: list[Box]) -> Box:
    left = min(b.x for b in group)
    top = min(b.y for b in group)
    right = max(b.x + b.w for b in group)
    bottom = max(b.y + b.h for b in group)
    return Box(x=left, y=top, w=right - left, h=bottom - top).clamped()


def draw_boxes(page: Path, boxes: list[Box], out: Path) -> None:
    """
    The detector's own view of the page: every region it found, outlined.
    Kept beside the page so a reader can see what was looked at, including
    any region the agent then declined to read.
    """
    with Image.open(page) as img:
        canvas = img.convert("RGB")
        draw = ImageDraw.Draw(canvas)
        for i, box in enumerate(boxes, start=1):
            left, top, right, bottom = box.pixels(*canvas.size)
            draw.rectangle((left, top, right, bottom), outline=(220, 38, 38), width=3)
            draw.text((left + 3, max(top - 12, 0)), str(i), fill=(220, 38, 38))
        out.parent.mkdir(parents=True, exist_ok=True)
        canvas.save(out)
