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


@dataclass
class RxLine:
    drug: str
    dose: str
    schedule: str | None


# Drawn pages by everything that shapes them. The tests reseed before every
# test, and drawing is most of a seed's time.
_drawn: dict[tuple[object, ...], list[Box]] = {}


def draw_prescription(
    path: Path,
    doctor: str,
    clinic: str,
    patient_name: str,
    date_text: str,
    lines: list[RxLine],
    seed: int,
) -> list[Box]:
    """
    Draw one prescription page and return the box of each medicine line.
    Printed letterhead, with the lines set slightly askew as a hand would.
    """
    key = (path, doctor, clinic, patient_name, date_text, tuple(map(repr, lines)), seed)
    if key in _drawn and path.is_file():
        return _drawn[key]
    rng = random.Random(seed)
    img = Image.new("L", (PAGE_W, PAGE_H), 250)
    d = ImageDraw.Draw(img)
    d.text((110, 100), doctor, fill=20, font=_font(42))
    d.text((110, 165), clinic, fill=60, font=_font(26))
    d.line((110, 225, PAGE_W - 110, 225), fill=90, width=3)
    d.text((110, 270), f"Name: {patient_name}", fill=30, font=_font(30))
    d.text((PAGE_W - 420, 270), f"Date: {date_text}", fill=30, font=_font(30))
    d.text((110, 360), "Rx", fill=20, font=_font(56))

    boxes: list[Box] = []
    hand = _font(36)
    for i, line in enumerate(lines):
        x = 170 + rng.randint(-10, 10)
        y = 470 + i * 110 + rng.randint(-8, 8)
        text = f"{line.drug}  {line.dose}" + (f"   {line.schedule}" if line.schedule else "")
        d.text((x, y), text, fill=rng.randint(15, 45), font=hand)
        left, top, right, bottom = d.textbbox((x, y), text, font=hand)
        left, top, right, bottom = left - 14, top - 12, right + 14, bottom + 12
        boxes.append(
            Box(left / PAGE_W, top / PAGE_H, (right - left) / PAGE_W, (bottom - top) / PAGE_H)
        )

    d.text(
        (110, PAGE_H - 160),
        "This is a fictional prescription generated for testing.",
        fill=110,
        font=_font(22),
    )
    img = img.filter(ImageFilter.GaussianBlur(0.8)).rotate(rng.uniform(-0.6, 0.6), fillcolor=250)
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path)
    _drawn[key] = boxes
    return boxes


def draw_meal(path: Path, seed: str) -> None:
    """A drawn plate standing in for a meal photograph. Nothing is estimated from it."""
    if path.is_file():
        return  # the same seed always draws the same plate
    rng = random.Random(seed)
    img = Image.new("RGB", (640, 480), (196, 182, 166))
    d = ImageDraw.Draw(img)
    d.ellipse((120, 40, 520, 440), fill=(244, 242, 238), outline=(214, 210, 202), width=6)
    for i in range(4):
        cx = 320 + int(95 * [1, 0, -1, 0][i] + rng.randint(-20, 20))
        cy = 240 + int(85 * [0, 1, 0, -1][i] + rng.randint(-20, 20))
        rx, ry = rng.randint(55, 80), rng.randint(40, 60)
        colour = [(196, 140, 60), (210, 180, 80), (110, 160, 70), (190, 90, 60)][i]
        d.ellipse((cx - rx, cy - ry, cx + rx, cy + ry), fill=colour)
    d.text((20, 445), "Fictional meal photograph", fill=(58, 58, 58), font=_font(18))
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path)
