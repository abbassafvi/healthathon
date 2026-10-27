from typing import Any

from PIL import Image

from healthathon import storage

# Context around the line, as a share of the page, so the reviewer sees the
# line in its place and not a lone word.
_PAD_X, _PAD_Y = 0.03, 0.012


def crop_key(item_id: Any) -> str:
    return f"crops/regimen-items/{item_id}.png"


def ensure_crop(item: dict[str, Any]) -> str | None:
    """
    Cut a regimen item's line out of its page, once, and return the storage
    key. The crop is derived only from the page and the stored box, so it can
    always be cut again. None if the page is missing.
    """
    key = crop_key(item["id"])
    if storage.resolve(key):
        return key
    page = storage.resolve(item["page_key"]) if item["page_key"] else None
    if page is None or item["bbox_x"] is None:
        return None
    with Image.open(page) as img:
        w, h = img.size
        x, y = float(item["bbox_x"]), float(item["bbox_y"])
        bw, bh = float(item["bbox_w"]), float(item["bbox_h"])
        region = (
            int(max(0.0, x - _PAD_X) * w),
            int(max(0.0, y - _PAD_Y) * h),
            int(min(1.0, x + bw + _PAD_X) * w),
            int(min(1.0, y + bh + _PAD_Y) * h),
        )
        out = img.crop(region)
        storage.save_image(key, out)
    return key
