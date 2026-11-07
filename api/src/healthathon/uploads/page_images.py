"""
The images one upload produces, and where each one is stored.

A photograph arrives, is stored the way up it was taken, is straightened
and is cut into one crop per detected region. Every name here is derived
from the page's own digest, so the same photograph uploaded twice makes
the same files and is read once.

Separate from `pipeline`, which decides what happens to the readings:
this module only turns pixels into files.
"""

import io
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps

from healthathon import storage
from healthathon.config import get_settings
from healthathon.uploads.agent import Crop
from healthathon.uploads.detector import Box


def page_key(digest: str) -> str:
    return f"documents/{digest[:2]}/{digest}/page-1.png"


def context_key(digest: str, widest: int) -> str:
    """
    The width is part of the key. It was not, so a page already stored
    kept the copy made at the old size and changing the setting did
    nothing to what the agent saw.
    """
    return f"documents/{digest[:2]}/{digest}/context-{widest}.jpg"


def context_page(page: Path, digest: str, widest: int) -> Path:
    """
    The copy of the page the agent is sent.

    Under "crops" it is context for the layout and the prompt forbids
    reading a value off it. Under "whole_page", the default, it is what
    the model reads, so `widest` is the resolution every reading is made
    at. A full-size photograph travels with every call, several times
    per document, which is what the ceiling is for.
    """
    key = context_key(digest, widest)
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


def straight_key(digest: str) -> str:
    return f"documents/{digest[:2]}/{digest}/straight.png"


def crop_key(digest: str, index: int) -> str:
    return f"documents/{digest[:2]}/{digest}/crops/{index:03d}.png"


def labelled_key(digest: str, index: int) -> str:
    """Only the agent reads these, so they live apart from what a person sees."""
    return f"documents/{digest[:2]}/{digest}/labelled/{index:03d}.png"


def storage_path(key: str) -> Path:
    """Where a key lives on disk, whether or not anything is there yet."""
    root = get_settings().storage_dir.resolve()
    return root / key


def save_page(data: bytes, digest: str) -> tuple[Path, int, int]:
    """
    Store the photograph as PNG and report its size. Re-encoding once
    here means every later crop reads the same pixels the detector saw.
    """
    key = page_key(digest)
    path = storage.resolve(key)
    if path is None:
        with Image.open(io.BytesIO(data)) as img:
            # A phone writes the orientation into EXIF rather than the
            # pixels, so a portrait photograph is stored sideways and
            # every box computed on it is wrong.
            storage.save_image(key, ImageOps.exif_transpose(img).convert("RGB"))
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
            region = box.padded(width, height)
            if region[2] <= region[0] or region[3] <= region[1]:
                continue
            cut = img.crop(region)
            key = crop_key(digest, index)
            storage.save_image(key, cut)
            label_key = labelled_key(digest, index)
            storage.save_image(label_key, _labelled(cut, index))
            path, labelled = storage.resolve(key), storage.resolve(label_key)
            assert path is not None and labelled is not None
            crops[index] = Crop(index=index, path=path, storage_key=key, labelled=labelled, box=box)
    return crops
