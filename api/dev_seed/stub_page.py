"""
Generates a page for the browser tests to upload.

No document image is ever committed, so the browser tests make the page
they need at the moment they need it. Bands of inked text, with the last
one optionally smeared, which is how a test produces a region the
legibility check will refuse.
"""

import argparse
import io
import sys

from PIL import Image, ImageDraw, ImageFilter

WIDTH, HEIGHT = 1240, 1754
BAND_TOP, BAND_GAP, BAND_HEIGHT = 150, 160, 46


def build(bands: int, blur_last: bool, salt: str = "") -> bytes:
    img = Image.new("RGB", (WIDTH, HEIGHT), "white")
    draw = ImageDraw.Draw(img)
    for i in range(bands):
        top = BAND_TOP + i * BAND_GAP
        draw.rectangle((120, top, 1050, top + BAND_HEIGHT), fill=(15, 15, 15))
        # Gaps in the bar, so a crop of it has the edges real writing has.
        for k in range(12):
            draw.rectangle((140 + k * 70, top + 10, 150 + k * 70, top + 36), fill=(250, 250, 250))
    if blur_last and bands:
        top = BAND_TOP + (bands - 1) * BAND_GAP
        region = (100, top - 20, 1070, top + BAND_HEIGHT + 24)
        img.paste(img.crop(region).filter(ImageFilter.GaussianBlur(6)), region[:2])
    if salt:
        # Changes the bytes without changing what the page says, so two
        # uploads of "the same page" can be told apart by their hash.
        draw.point((WIDTH - 1, HEIGHT - 1), fill=(255, 255, abs(hash(salt)) % 251))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


# The pages the browser tests upload, built in one call so no test body
# ever waits on a subprocess: a synchronous spawn cannot be interrupted
# when a test times out, and it hangs the whole run.
VARIANTS: dict[str, tuple[int, bool, str]] = {
    "lab": (4, True, "lab"),
    "rx": (2, False, "rx"),
    "single": (1, False, "single"),
    "blank": (0, False, "blank"),
    "p1": (4, False, "p1"),
    "p2": (4, False, "p2"),
}


def main() -> int:
    parser = argparse.ArgumentParser(description="Write a test page as PNG to stdout")
    parser.add_argument("--bands", type=int, default=4)
    parser.add_argument("--blur-last", action="store_true")
    parser.add_argument("--salt", default="")
    parser.add_argument(
        "--set", action="store_true", help="Write every named variant as JSON of base64"
    )
    args = parser.parse_args()
    if args.set:
        import base64
        import json

        pages = {
            name: base64.b64encode(build(bands, blur, salt)).decode("ascii")
            for name, (bands, blur, salt) in VARIANTS.items()
        }
        sys.stdout.write(json.dumps(pages))
        return 0
    sys.stdout.buffer.write(build(args.bands, args.blur_last, args.salt))
    return 0


if __name__ == "__main__":
    sys.exit(main())
