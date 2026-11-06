"""
Straightening the page before anything reads it.

A card photographed by hand is never square to the camera. A degree or
two of tilt is invisible to a person and costly to a detector: tilted
lines of writing produce regions that run into the line below, and a
reading then snaps onto its neighbour. That is how an HbA1c came to
point at a fasting glucose.

Measured on a real card, straightening cut the number of lines sitting
within 1.2% of the page of each other from 17 to 10.

The angle is found from the pixels, not from a detection pass, so the
page is still read once. Finding it costs about a seventh of a second
against a read of ten.

Nothing here invents detail. Upscaling was measured and changed
nothing, because interpolation adds no information the camera did not
capture, and a generative super-resolution model would write plausible
strokes into a dose. Neither belongs in front of a clinical reader.
"""

import logging
from pathlib import Path

from PIL import Image

log = logging.getLogger(__name__)

# Past this the estimate is more likely wrong than the page is tilted,
# and rotating on a bad estimate is worse than leaving it alone.
MAX_SKEW_DEG = 8.0
# Below this the rotation costs resampling and buys nothing.
MIN_SKEW_DEG = 0.15


def estimate_skew(page: Path) -> float:
    """
    The tilt of the writing, in degrees, from the pixels alone.

    Each line of text is smeared sideways into a streak, and the
    dominant streak angle is the page's tilt. Returns 0.0 when OpenCV is
    not installed or the page gives nothing to measure.
    """
    try:
        import cv2
        import numpy as np
    except ImportError:  # pragma: no cover - only without the ocr extra
        return 0.0

    grey = cv2.imread(str(page), cv2.IMREAD_GRAYSCALE)
    if grey is None:
        return 0.0
    small = cv2.resize(grey, None, fx=0.5, fy=0.5, interpolation=cv2.INTER_AREA)
    ink = cv2.adaptiveThreshold(
        small, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, 25, 15
    )
    smear = cv2.morphologyEx(
        ink, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_RECT, (40, 1))
    )
    found = cv2.HoughLinesP(
        smear,
        1,
        np.pi / 720,
        threshold=100,
        minLineLength=max(small.shape[1] // 8, 20),
        maxLineGap=20,
    )
    if found is None:
        return 0.0
    angles = []
    for x0, y0, x1, y1 in found[:, 0]:
        if abs(x1 - x0) > 20:
            angle = float(np.degrees(np.arctan2(y1 - y0, x1 - x0)))
            if abs(angle) < MAX_SKEW_DEG:
                angles.append(angle)
    if not angles:
        return 0.0
    return float(np.median(angles))


def straighten(page: Path, out: Path) -> tuple[Path, float]:
    """
    Write a straightened copy, and say by how much it was turned.

    Returns the original path unchanged when there is nothing worth
    correcting, so a page that is already square costs one measurement
    and no resampling.
    """
    angle = estimate_skew(page)
    if abs(angle) < MIN_SKEW_DEG or abs(angle) >= MAX_SKEW_DEG:
        return page, 0.0
    with Image.open(page) as img:
        turned = img.convert("RGB").rotate(
            angle,
            resample=Image.Resampling.BICUBIC,
            expand=True,
            fillcolor=(255, 255, 255),
        )
    out.parent.mkdir(parents=True, exist_ok=True)
    turned.save(out)
    log.info("straightened %s by %+.2f degrees", page.name, angle)
    return out, angle
