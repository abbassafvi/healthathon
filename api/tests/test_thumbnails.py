import io
from pathlib import Path
from typing import Any

from PIL import Image

from healthathon import storage

# EXIF tags: Orientation, and the pointer to the GPS block.
ORIENTATION, GPS_IFD = 0x0112, 0x8825


def _phone_photo(storage_dir: Path, key: str) -> bytes:
    """A 1200x800 JPEG saved sideways, as phones do, with a location in its EXIF."""
    img = Image.new("RGB", (1200, 800), (200, 120, 40))
    img.paste((20, 60, 200), (0, 0, 300, 800))  # a blue band on the left edge
    exif = Image.Exif()
    exif[ORIENTATION] = 6  # shown turned 90 degrees clockwise
    exif.get_ifd(GPS_IFD)[2] = (28.0, 36.0, 0.0)  # a latitude
    buf = io.BytesIO()
    img.save(buf, format="JPEG", exif=exif)
    storage.save(key, buf.getvalue())
    return buf.getvalue()


def _image(res: Any) -> Image.Image:
    return Image.open(io.BytesIO(res.content))


def test_a_photo_is_sent_smaller_and_upright(client: Any, storage_dir: Path) -> None:
    original = _phone_photo(storage_dir, "meals/p1/photo.jpg")
    res = client.get("/api/storage/meals/p1/photo.jpg?width=320")
    assert res.status_code == 200
    assert res.headers["content-type"] == "image/jpeg"
    img = _image(res)
    # Turned upright first: 800x1200, so 320 wide keeps the aspect.
    assert img.size == (320, 480)
    # The blue band, on the left as saved, is at the top once turned upright.
    r, g, b = img.getpixel((160, 10))  # type: ignore[misc]
    assert b > 150 and r < 80
    assert len(res.content) < len(original)


def test_the_small_copy_carries_no_location(client: Any, storage_dir: Path) -> None:
    _phone_photo(storage_dir, "meals/p1/located.jpg")
    exif = _image(client.get("/api/storage/meals/p1/located.jpg?width=320")).getexif()
    assert exif.get_ifd(GPS_IFD) == {}
    assert ORIENTATION not in exif


def test_the_original_is_unchanged_and_still_sent_as_it_is(client: Any, storage_dir: Path) -> None:
    original = _phone_photo(storage_dir, "meals/p1/kept.jpg")
    client.get("/api/storage/meals/p1/kept.jpg?width=320")
    assert (storage_dir / "meals/p1/kept.jpg").read_bytes() == original
    assert client.get("/api/storage/meals/p1/kept.jpg").content == original


def test_a_small_photo_is_never_enlarged(client: Any, storage_dir: Path) -> None:
    buf = io.BytesIO()
    Image.new("RGB", (100, 80), (1, 2, 3)).save(buf, format="PNG")
    storage.save("meals/p1/tiny.png", buf.getvalue())
    assert _image(client.get("/api/storage/meals/p1/tiny.png?width=320")).size == (100, 80)


def test_the_copy_is_made_once_and_remade_when_the_original_changes(
    client: Any, storage_dir: Path
) -> None:
    _phone_photo(storage_dir, "meals/p1/again.jpg")
    client.get("/api/storage/meals/p1/again.jpg?width=320")
    thumb = storage_dir / "thumbs/320/meals/p1/again.jpg.jpg"
    made = thumb.stat().st_mtime_ns
    client.get("/api/storage/meals/p1/again.jpg?width=320")
    assert thumb.stat().st_mtime_ns == made
    buf = io.BytesIO()
    Image.new("RGB", (640, 640), (0, 0, 0)).save(buf, format="JPEG")
    storage.save("meals/p1/again.jpg", buf.getvalue())
    assert _image(client.get("/api/storage/meals/p1/again.jpg?width=320")).size == (320, 320)


def test_only_an_image_can_be_sent_smaller(client: Any, storage_dir: Path) -> None:
    storage.save("meals/p1/notes.txt", b"not a photograph")
    assert client.get("/api/storage/meals/p1/notes.txt?width=320").status_code == 415
    assert client.get("/api/storage/meals/p1/missing.jpg?width=320").status_code == 404


def test_the_width_is_bounded(client: Any, storage_dir: Path) -> None:
    _phone_photo(storage_dir, "meals/p1/bounds.jpg")
    for width in ("10", "5000", "wide"):
        res = client.get(f"/api/storage/meals/p1/bounds.jpg?width={width}")
        assert res.status_code == 422, width
