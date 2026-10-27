import io
from pathlib import Path

from PIL import Image, ImageOps, UnidentifiedImageError

from healthathon import storage


def thumbnail(key: str, width: int) -> Path | None:
    """
    A copy of a stored photograph no wider than `width`, for showing it small.

    The original is never changed and stays what the patient sent. The copy is
    turned the way the camera recorded, re-encoded as JPEG and written without
    the photograph's metadata, which can include where it was taken. Copies are
    kept under thumbs/ and rebuilt if the original is newer. Returns None when
    the key is missing or is not an image.
    """
    source = storage.resolve(key)
    if source is None:
        return None
    thumb_key = f"thumbs/{width}/{key}.jpg"
    cached = storage.resolve(thumb_key)
    if cached is not None and cached.stat().st_mtime >= source.stat().st_mtime:
        return cached
    try:
        with Image.open(source) as opened:
            img = ImageOps.exif_transpose(opened)
            img.thumbnail((width, width * 4))
            buf = io.BytesIO()
            img.convert("RGB").save(buf, format="JPEG", quality=82)
    except (UnidentifiedImageError, OSError):
        return None
    storage.save(thumb_key, buf.getvalue())
    return storage.resolve(thumb_key)
