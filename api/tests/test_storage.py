from pathlib import Path

import pytest

from healthathon import storage
from healthathon.config import get_settings


@pytest.fixture
def root(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setenv("HEALTHATHON_STORAGE_DIR", str(tmp_path / "root"))
    get_settings.cache_clear()
    (tmp_path / "root" / "dev").mkdir(parents=True)
    (tmp_path / "root" / "dev" / "a.png").write_bytes(b"png")
    (tmp_path / "secret.txt").write_text("outside")
    yield tmp_path / "root"
    get_settings.cache_clear()


def test_resolves_a_file_under_the_root(root: Path) -> None:
    assert storage.resolve("dev/a.png") == (root / "dev" / "a.png").resolve()


@pytest.mark.parametrize(
    "key", ["../secret.txt", "dev/../../secret.txt", "/etc/passwd", "dev", "dev/missing.png"]
)
def test_refuses_escapes_directories_and_missing_files(root: Path, key: str) -> None:
    assert storage.resolve(key) is None
