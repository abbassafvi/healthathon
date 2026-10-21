"""
Generated page images for the stand-in seed. Every page is a fictional
laboratory report drawn here; nothing comes from the document set.
"""

import random
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

PAGE_W, PAGE_H = 1240, 1754  # A4 at 150 dpi
ROW_TOP, ROW_H = 520, 78
COL_NAME, COL_VALUE, COL_UNIT = 110, 700, 900


@dataclass
class Row:
    analyte_name: str
    value_text: str
    unit_text: str
    degrade: str | None = None  # 'blur' or 'smudge': makes the region hard to read


@dataclass
class Box:
    """Normalised 0..1 region, as core.provenance stores it."""

    x: float
    y: float
    w: float
    h: float


def _font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for name in ("DejaVuSans.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default(size)


def draw_lab_report(
    path: Path, lab_name: str, patient_name: str, report_date: str, rows: list[Row], seed: int
) -> list[Box]:
    """Draw one report page to `path` and return the value box of each row."""
    rng = random.Random(seed)
    img = Image.new("L", (PAGE_W, PAGE_H), 248)
    d = ImageDraw.Draw(img)
    d.text((110, 110), lab_name, fill=20, font=_font(44))
    d.text((110, 180), "Department of Clinical Biochemistry", fill=60, font=_font(26))
    d.line((110, 240, PAGE_W - 110, 240), fill=90, width=3)
    d.text((110, 280), f"Patient: {patient_name}", fill=30, font=_font(28))
    d.text((110, 330), f"Report date: {report_date}", fill=30, font=_font(28))
    d.text((110, 380), "Specimen: venous blood", fill=60, font=_font(24))
    header = _font(26)
    for x, label in ((COL_NAME, "Test"), (COL_VALUE, "Result"), (COL_UNIT, "Unit")):
        d.text((x, ROW_TOP - 60), label, fill=40, font=header)
    d.line((110, ROW_TOP - 15, PAGE_W - 110, ROW_TOP - 15), fill=120, width=2)

    boxes: list[Box] = []
    body = _font(30)
    for i, row in enumerate(rows):
        y = ROW_TOP + i * ROW_H
        d.text((COL_NAME, y), row.analyte_name, fill=25, font=body)
        d.text((COL_VALUE, y), row.value_text, fill=15, font=body)
        d.text((COL_UNIT, y), row.unit_text, fill=40, font=body)
        left, top, right, bottom = d.textbbox((COL_VALUE, y), row.value_text, font=body)
        left, top, right, bottom = left - 12, top - 10, right + 12, bottom + 10
        if row.degrade:
            _degrade(img, (left, top, right, bottom), row.degrade, rng)
        boxes.append(
            Box(left / PAGE_W, top / PAGE_H, (right - left) / PAGE_W, (bottom - top) / PAGE_H)
        )

    d.text(
        (110, PAGE_H - 160),
        "This is a fictional report generated for testing.",
        fill=110,
        font=_font(22),
    )
    img = img.filter(ImageFilter.GaussianBlur(0.6)).rotate(rng.uniform(-0.4, 0.4), fillcolor=248)
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path)
    return boxes


def _degrade(
    img: Image.Image, box: tuple[int, int, int, int], kind: str, rng: random.Random
) -> None:
    region = img.crop(box)
    if kind == "blur":
        region = region.filter(ImageFilter.GaussianBlur(2.6))
    else:
        d = ImageDraw.Draw(region)
        for _ in range(6):
            x0, y0 = rng.randint(0, region.width), rng.randint(0, region.height)
            d.line(
                (x0, y0, x0 + rng.randint(20, 60), y0 + rng.randint(-8, 8)),
                fill=rng.randint(70, 140),
                width=rng.randint(3, 6),
            )
    img.paste(region, box[:2])


def cut_crop(page_path: Path, box: Box, out: Path, pad: float = 0.35) -> None:
    """
    Cut the value region out of the page, with some context around it so a
    reviewer can see the row it sits in.
    """
    with Image.open(page_path) as page:
        w, h = page.size
        px, py = box.w * w * pad, box.h * h * pad
        left = max(0, box.x * w - px - 620)  # include the test name to the left
        region = (
            left,
            max(0, box.y * h - py),
            min(w, (box.x + box.w) * w + px + 240),
            min(h, (box.y + box.h) * h + py),
        )
        out.parent.mkdir(parents=True, exist_ok=True)
        page.crop(tuple(int(v) for v in region)).save(out)
