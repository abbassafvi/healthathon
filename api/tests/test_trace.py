from pathlib import Path
from typing import Any

import psycopg
import pytest
from PIL import Image, ImageStat

from tests.helpers import DEMO, decide, queue_item_for, value_id, verify_audit_chain


def _trace(client: Any, vid: str) -> dict[str, Any]:
    res = client.get(f"/api/values/{vid}/trace")
    assert res.status_code == 200, res.text
    return dict(res.json())


def test_traces_an_accepted_value_to_its_region(
    client: Any, db: psycopg.Connection[Any], storage_dir: Path
) -> None:
    vid = value_id(db, "DEV-0001", "hba1c", "accepted")
    t = _trace(client, vid)
    assert t["value"]["value_text"] == "8.4"
    assert t["provenance_kind"] == "source_document"
    assert t["history"] == {
        "kind": "accepted",
        "actor_name": None,
        "at": None,
        "original_value_text": None,
        "original_unit_text": None,
    }
    assert t["reader_name"] == "dev-seed"
    assert t["page"]["page_no"] == 1 and t["page"]["page_count"] == 1
    assert (t["page"]["width_px"], t["page"]["height_px"]) == (1240, 1754)
    box = t["box"]
    assert 0 <= box["x"] < box["x"] + box["w"] <= 1
    assert 0 <= box["y"] < box["y"] + box["h"] <= 1
    assert t["located_by_text"] is False
    assert client.get(t["page"]["url"]).status_code == 200


def test_every_box_sits_on_ink(client: Any, db: psycopg.Connection[Any], storage_dir: Path) -> None:
    """The box must point at printed text, not blank page. Checked in pixels."""
    rows = db.execute("SELECT id FROM proj.renderable_value").fetchall()
    assert len(rows) == 10
    for row in rows:
        t = _trace(client, str(row["id"]))
        page = Image.open(storage_dir / t["page"]["url"].removeprefix("/api/storage/"))
        w, h = page.size
        b = t["box"]
        region = page.crop(
            (
                int(b["x"] * w),
                int(b["y"] * h),
                int((b["x"] + b["w"]) * w),
                int((b["y"] + b["h"]) * h),
            )
        )
        assert ImageStat.Stat(region).extrema[0][0] < 100, t["value"]["value_text"]


def test_a_confirmed_value_names_who_confirmed_it(client: Any, db: psycopg.Connection[Any]) -> None:
    decide(client, queue_item_for(client, "DEV-0002", "hba1c")["id"], action="confirm")
    h = _trace(client, value_id(db, "DEV-0002", "hba1c", "confirmed"))["history"]
    assert h["kind"] == "confirmed" and h["actor_name"] == DEMO and h["at"]


def test_a_corrected_value_keeps_the_original_reading(
    client: Any, db: psycopg.Connection[Any]
) -> None:
    item = queue_item_for(client, "DEV-0001", "fpg")
    new_id = decide(client, item["id"], action="correct", value_text="168", unit_text="mg/dL")[
        "replacement_value_id"
    ]
    t = _trace(client, new_id)
    assert t["value"]["value_text"] == "168"
    assert t["history"]["kind"] == "corrected" and t["history"]["actor_name"] == DEMO
    assert t["history"]["original_value_text"] == "162"
    assert t["history"]["original_unit_text"] == "mg/dL"
    assert t["box"] is not None  # same region of the same page


@pytest.mark.parametrize("state", ["needs_confirm", "discarded", "superseded"])
def test_values_not_in_the_record_cannot_be_traced(
    client: Any, db: psycopg.Connection[Any], state: str
) -> None:
    item = queue_item_for(client, "DEV-0001", "fpg")
    if state == "discarded":
        decide(client, item["id"], action="discard")
    elif state == "superseded":
        decide(client, item["id"], action="correct", value_text="168")
    res = client.get(f"/api/values/{value_id(db, 'DEV-0001', 'fpg', state)}/trace")
    assert res.status_code == 404
    assert res.json()["detail"] == "This value is not shown in the record"


def test_unknown_value_is_404(client: Any) -> None:
    assert client.get("/api/values/00000000-0000-0000-0000-000000000000/trace").status_code == 404


def _insert_value(db: psycopg.Connection[Any], prov_sql: str, params: tuple[Any, ...]) -> str:
    base = db.execute(
        "SELECT patient_id, document_id FROM core.extracted_value WHERE state = 'accepted' LIMIT 1"
    ).fetchone()
    prov = db.execute(prov_sql + " RETURNING id", params).fetchone()["id"]
    return str(
        db.execute(
            "INSERT INTO core.extracted_value (patient_id, document_id, provenance_id,"
            " analyte_code, value_text, unit_text, state)"
            " VALUES (%s, %s, %s, 'hba1c', '7.0', '%%', 'confirmed')"
            " RETURNING id",
            (base["patient_id"], base["document_id"], prov),
        ).fetchone()["id"]
    )


def test_a_clinician_typed_value_has_no_page_but_names_who_typed_it(
    client: Any, db: psycopg.Connection[Any]
) -> None:
    user = db.execute("SELECT id FROM core.clinic_user").fetchone()["id"]
    vid = _insert_value(
        db,
        "INSERT INTO core.provenance (kind, entered_by_id) VALUES ('clinician_entered', %s)",
        (user,),
    )
    t = _trace(client, vid)
    assert t["provenance_kind"] == "clinician_entered"
    assert t["page"] is None and t["box"] is None and t["located_by_text"] is False
    assert t["entered_by_name"] == DEMO
    assert t["reader_name"] is None


def test_a_value_located_by_text_position_has_a_page_but_no_box(
    client: Any, db: psycopg.Connection[Any]
) -> None:
    page = db.execute("SELECT id, document_id FROM core.document_page LIMIT 1").fetchone()
    vid = _insert_value(
        db,
        "INSERT INTO core.provenance (kind, document_id, page_id, char_start,"
        " char_end) VALUES ('source_document', %s, %s, 10, 14)",
        (page["document_id"], page["id"]),
    )
    t = _trace(client, vid)
    assert t["page"] is not None and t["box"] is None and t["located_by_text"] is True


def test_tracing_is_audited(client: Any, db: psycopg.Connection[Any]) -> None:
    vid = value_id(db, "DEV-0003", "hba1c", "accepted")
    _trace(client, vid)
    rows = verify_audit_chain(db)
    assert [(r["action"], str(r["entity_id"])) for r in rows] == [("value.trace", vid)]
