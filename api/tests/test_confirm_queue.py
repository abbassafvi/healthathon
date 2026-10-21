import hashlib
from typing import Any

import psycopg


def _open(client: Any) -> list[dict[str, Any]]:
    res = client.get("/api/confirm-queue")
    assert res.status_code == 200
    items: list[dict[str, Any]] = res.json()["items"]
    return items


def _decide(client: Any, item_id: str, **body: Any) -> Any:
    return client.post(
        f"/api/confirm-queue/{item_id}/decision", json={"decision_latency_ms": 1800, **body}
    )


def _value(db: psycopg.Connection[Any], value_id: str) -> dict[str, Any]:
    row = db.execute("SELECT * FROM core.extracted_value WHERE id = %s", (value_id,)).fetchone()
    assert row is not None
    return row


def _value_id(db: psycopg.Connection[Any], item_id: str) -> str:
    row = db.execute(
        "SELECT extracted_value_id FROM core.confirm_queue_item WHERE id = %s", (item_id,)
    ).fetchone()
    return str(row["extracted_value_id"])


def test_lists_open_items_in_arrival_order(client: Any) -> None:
    res = client.get("/api/confirm-queue").json()
    assert res["open_count"] == 5
    times = [i["created_at"] for i in res["items"]]
    assert times == sorted(times)
    first = res["items"][0]
    assert first["crop_url"].startswith("/api/storage/dev/crops/")
    assert first["patient"]["registration_no"].startswith("DEV-")


def test_crop_is_served(client: Any) -> None:
    item = _open(client)[0]
    res = client.get(item["crop_url"])
    assert res.status_code == 200
    assert res.content[:8] == b"\x89PNG\r\n\x1a\n"


def test_storage_rejects_paths_outside_root(client: Any) -> None:
    assert client.get("/api/storage/../pyproject.toml").status_code == 404
    assert client.get("/api/storage/%2e%2e/%2e%2e/etc/passwd").status_code == 404


def test_confirm_makes_value_renderable(client: Any, db: psycopg.Connection[Any]) -> None:
    item = _open(client)[0]
    value_id = _value_id(db, item["id"])
    renderable = "SELECT 1 FROM proj.renderable_value WHERE id = %s"
    assert db.execute(renderable, (value_id,)).fetchone() is None

    res = _decide(client, item["id"], action="confirm")
    assert res.status_code == 200, res.text
    assert _value(db, value_id)["state"] == "confirmed"
    assert db.execute(renderable, (value_id,)).fetchone() is not None
    assert len(_open(client)) == 4


def test_correct_supersedes_and_records_crop(
    client: Any, db: psycopg.Connection[Any], storage_dir: Any
) -> None:
    item = _open(client)[0]
    value_id = _value_id(db, item["id"])
    res = _decide(client, item["id"], action="correct", value_text=" 168 ", unit_text="mg/dL")
    assert res.status_code == 200, res.text
    new_id = res.json()["replacement_value_id"]

    old, new = _value(db, value_id), _value(db, new_id)
    assert old["state"] == "superseded" and str(old["superseded_by"]) == new_id
    assert old["value_text"] == item["value_text"]  # the original is never edited
    assert new["state"] == "confirmed" and new["value_text"] == "168"
    assert new["provenance_id"] == old["provenance_id"]

    corr = db.execute(
        "SELECT * FROM core.value_correction WHERE original_value_id = %s", (value_id,)
    ).fetchone()
    crop = (storage_dir / item["crop_url"].removeprefix("/api/storage/")).read_bytes()
    assert bytes(corr["crop_sha256"]) == hashlib.sha256(crop).digest()
    assert corr["decision_latency_ms"] == 1800
    assert str(corr["replacement_value_id"]) == new_id


def test_discard(client: Any, db: psycopg.Connection[Any]) -> None:
    item = _open(client)[0]
    assert _decide(client, item["id"], action="discard").status_code == 200
    assert _value(db, _value_id(db, item["id"]))["state"] == "discarded"


def test_second_decision_is_rejected(client: Any) -> None:
    item = _open(client)[0]
    assert _decide(client, item["id"], action="confirm").status_code == 200
    assert _decide(client, item["id"], action="discard").status_code == 409


def test_invalid_decisions(client: Any) -> None:
    item = _open(client)[0]
    assert _decide(client, item["id"], action="correct").status_code == 422
    assert _decide(client, item["id"], action="correct", value_text="  ").status_code == 422
    assert _decide(client, item["id"], action="confirm", value_text="9").status_code == 422
    res = client.post(f"/api/confirm-queue/{item['id']}/decision", json={"action": "confirm"})
    assert res.status_code == 422  # latency is required
    missing = "00000000-0000-0000-0000-000000000000"
    assert _decide(client, missing, action="confirm").status_code == 404


def test_missing_crop_blocks_decision(
    client: Any, db: psycopg.Connection[Any], storage_dir: Any
) -> None:
    item = _open(client)[0]
    (storage_dir / item["crop_url"].removeprefix("/api/storage/")).unlink()
    assert _decide(client, item["id"], action="confirm").status_code == 409
    assert _value(db, _value_id(db, item["id"]))["state"] == "needs_confirm"
