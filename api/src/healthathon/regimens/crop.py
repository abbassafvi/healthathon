from typing import Any

from PIL import Image

from healthathon import storage
from healthathon.uploads.detector import Box


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
        # The pipeline's padding, not a second one. The crop hash stored
        # on the line is documented as the crop a human was shown, and
        # a different padding here made that untrue.
        box = Box(
            float(item["bbox_x"]),
            float(item["bbox_y"]),
            float(item["bbox_w"]),
            float(item["bbox_h"]),
        )
        out = img.crop(box.padded(w, h))
        storage.save_image(key, out)
    return key
