import hashlib
from pathlib import Path

from healthathon.config import get_settings


def resolve(key: str) -> Path | None:
    """
    Map a storage key to a file under the storage root. Returns None for a
    missing file or for any key that would escape the root.
    """
    root = get_settings().storage_dir.resolve()
    path = (root / key).resolve()
    if not path.is_relative_to(root) or not path.is_file():
        return None
    return path


def sha256_of(key: str) -> bytes | None:
    path = resolve(key)
    return hashlib.sha256(path.read_bytes()).digest() if path else None


def url_for(key: str) -> str:
    return f"/api/storage/{key}"


def save(key: str, data: bytes) -> None:
    """Write a file under the storage root. The key is built by the caller, never sent in."""
    root = get_settings().storage_dir.resolve()
    path = (root / key).resolve()
    if not path.is_relative_to(root):
        raise ValueError(f"storage key escapes the root: {key!r}")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
