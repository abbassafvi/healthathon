"""
Review probes for PR 12. Not part of the PR. Each test asserts what the PR's
own comments, the schema or the project rules promise, so a failure here
demonstrates a defect.
"""

import hashlib
import io
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import psycopg
import pytest
from PIL import Image

from healthathon.uploads import pipeline
from healthathon.uploads.agent import DocumentReading, LabValue, RegimenLine, drop_ungrounded
from healthathon.uploads.detector import Box
from healthathon.uploads.factory import set_agent, set_detector
from healthathon.uploads.jobs import registry
from healthathon.uploads.whole_page import WholePageAgent
from tests.fakes import FakeAgent, FakeDetector, page_image, upload, wait_for
from tests.helpers import patient_id
from tests.test_uploads_reader import CODES, StubClient, whole_crops

BOXES = [
    Box(0.10, 0.08, 0.60, 0.03),
    Box(0.10, 0.15, 0.60, 0.03),
    Box(0.10, 0.22, 0.60, 0.03),
]


@pytest.fixture(autouse=True)
def _reader() -> Iterator[None]:
    set_detector(FakeDetector(BOXES))
    registry().clear()
    yield
    set_detector(None)
    set_agent(None)


def _read(client: Any, db: Any, reading: Any, doc_type: str = "lab_report") -> dict[str, Any]:
    set_agent(FakeAgent(reading))
    pid = patient_id(db, "DEV-0001")
    body = wait_for(client, upload(client, pid, page_image(), doc_type=doc_type).json()["id"])
    assert body["stage"] == "done", body
    return body


def _value(db: Any, document_id: str) -> dict[str, Any]:
    row = db.execute(
        "SELECT v.state::text AS state, c.outcome::text AS grounding,"
        " r.outcome::text AS reread"
        " FROM core.extracted_value v"
        " JOIN core.check_result c ON c.extracted_value_id = v.id AND c.check_code = 'grounding'"
        " JOIN core.check_result r ON r.extracted_value_id = v.id"
        "  AND r.check_code = 'reread_agreement'"
        " WHERE v.document_id = %s",
        (document_id,),
    ).fetchone()
    assert row is not None
    return dict(row)


def test_drop_ungrounded_keeps_the_regions_marked_unclear() -> None:
    reading = DocumentReading(values=[LabValue(0, "hba1c", "7.4", "%")], ungrounded=[0])
    assert drop_ungrounded(reading, 3).ungrounded == [0]


def test_a_reading_with_no_clear_region_goes_to_a_person(
    client: Any, db: psycopg.Connection[Any]
) -> None:
    """agent.py: 'The reading is kept; its grounding check is what fails.'"""
    reading = DocumentReading(values=[LabValue(0, "hba1c", "7.4", "%")], ungrounded=[0])
    body = _read(client, db, reading)
    row = _value(db, body["outcome"]["document_id"])
    assert (row["grounding"], row["state"]) == ("fail", "needs_confirm"), row


def test_two_medicines_on_one_region_are_both_written(
    client: Any, db: psycopg.Connection[Any]
) -> None:
    """detector.py records one crop holding three medicines on a real card."""
    reading = DocumentReading(
        lines=[
            RegimenLine(0, "Tab. Metformin", "500 mg", "1-0-1"),
            RegimenLine(0, "Tab. Amlodipine", "5 mg", "1-0-0"),
        ]
    )
    body = _read(client, db, reading, doc_type="prescription")
    rows = db.execute(
        "SELECT drug_text, accepted_at FROM core.regimen_item WHERE regimen_id = %s",
        (body["outcome"]["regimen_id"],),
    ).fetchall()
    assert sorted(r["drug_text"] for r in rows) == ["Tab. Amlodipine", "Tab. Metformin"], [
        (r["drug_text"], r["accepted_at"] is not None) for r in rows
    ]


def test_a_value_on_a_prescription_that_changes_between_reads_goes_to_a_person(
    client: Any, db: psycopg.Connection[Any]
) -> None:
    """The lab report path already does this. The same value on a card should too."""
    passes = [DocumentReading(values=[LabValue(0, "hba1c", v, "%")]) for v in ("7.4", "8.4", "9.4")]
    body = _read(client, db, passes, doc_type="prescription")
    row = _value(db, body["outcome"]["document_id"])
    assert (row["reread"], row["state"]) == ("fail", "needs_confirm"), row


def test_a_value_with_no_unit_goes_to_a_person(client: Any, db: psycopg.Connection[Any]) -> None:
    """schema.sql: well_formed means 'unit known, value inside the assay range, date real'."""
    body = _read(client, db, DocumentReading(values=[LabValue(0, "fpg", "138", None)]))
    row = _value(db, body["outcome"]["document_id"])
    assert row["state"] == "needs_confirm", row


def test_a_reread_signal_says_what_the_reads_did(client: Any, db: psycopg.Connection[Any]) -> None:
    """checks.reread_agreement records same/total. A 2 of 3 line should not record 1.0."""
    passes = [
        DocumentReading(lines=[RegimenLine(0, "Tab. Metformin", d, "1-0-1")])
        for d in ("500 mg", "500 mg", "850 mg")
    ]
    body = _read(client, db, passes, doc_type="prescription")
    row = db.execute(
        "SELECT ri.dose_text, ri.accepted_at, c.outcome::text AS outcome, c.signal"
        " FROM core.regimen_item ri JOIN core.check_result c ON c.regimen_item_id = ri.id"
        " AND c.check_code = 'reread_agreement' WHERE ri.regimen_id = %s",
        (body["outcome"]["regimen_id"],),
    ).fetchone()
    assert row is not None
    assert float(row["signal"]) < 1.0, dict(row)


def _waiting_lines(client: Any, pid: str) -> int:
    got = client.get("/api/patients").json()
    items = got if isinstance(got, list) else got["items"]
    return int(next(p["waiting_lines"] for p in items if p["id"] == pid))


def test_a_line_the_checks_settled_is_not_counted_as_waiting(
    client: Any, db: psycopg.Connection[Any], auto_accept: None
) -> None:
    """
    Written against a build that settled a clean line by itself. The
    review changed that default: settling is off until there is a gold
    set, so the probe asks for it and still checks the path works.
    """
    pid = patient_id(db, "DEV-0001")
    before = _waiting_lines(client, pid)
    reading = DocumentReading(lines=[RegimenLine(0, "Tab. Metformin", "500 mg", "1-0-1")])
    body = _read(client, db, reading, doc_type="prescription")
    assert body["outcome"]["lines_accepted"] == 1
    assert _waiting_lines(client, pid) == before


def test_the_reading_page_shows_a_line_the_checks_settled(
    client: Any, db: psycopg.Connection[Any], auto_accept: None
) -> None:
    """Settling is off by default now, so this asks for it. See above."""
    reading = DocumentReading(lines=[RegimenLine(0, "Tab. Metformin", "500 mg", "1-0-1")])
    body = _read(client, db, reading, doc_type="prescription")
    line = client.get(f"/api/documents/{body['outcome']['document_id']}/reading").json()["lines"][0]
    assert line["state"] != "waiting" and line["drug_text"] == "Tab. Metformin", line


def test_one_drug_prescribed_at_two_times_stays_two_lines(tmp_path: Path) -> None:
    boxes = [Box(0.10, 0.30, 0.60, 0.02), Box(0.10, 0.40, 0.60, 0.02)]
    client = StubClient(
        {
            "medicines": [
                {
                    "box": [300, 100, 320, 700],
                    "drug": "Tab. Metformin",
                    "dose": "500 mg",
                    "schedule": "morning",
                },
                {
                    "box": [400, 100, 420, 700],
                    "drug": "Tab. Metformin",
                    "dose": "500 mg",
                    "schedule": "night",
                },
            ]
        }
    )
    reading = WholePageAgent(client, CODES).read(
        "prescription", tmp_path / "p.png", whole_crops(tmp_path, boxes)
    )
    assert [line.schedule_text for line in reading.lines] == ["morning", "night"], reading.lines


def test_two_different_drugs_sharing_a_dose_stay_two_lines(tmp_path: Path) -> None:
    boxes = [Box(0.10, 0.30, 0.60, 0.02), Box(0.10, 0.33, 0.60, 0.02)]
    client = StubClient(
        {
            "medicines": [
                {
                    "box": [300, 100, 320, 700],
                    "drug": "Tab. Telmisartan",
                    "dose": "40 mg",
                    "schedule": "morning",
                },
                {
                    "box": [330, 100, 350, 700],
                    "drug": "Tab. Olmesartan",
                    "dose": "40 mg",
                    "schedule": "night",
                },
            ]
        }
    )
    reading = WholePageAgent(client, CODES).read(
        "prescription", tmp_path / "p.png", whole_crops(tmp_path, boxes)
    )
    assert [line.drug_text for line in reading.lines] == [
        "Tab. Telmisartan",
        "Tab. Olmesartan",
    ], reading.lines


def test_a_phone_photograph_is_stored_the_way_up_it_was_taken(client: Any) -> None:
    """A phone stores portrait as landscape pixels plus an EXIF orientation of 6."""
    exif = Image.Exif()
    exif[0x0112] = 6
    buf = io.BytesIO()
    Image.new("RGB", (400, 200), "white").save(buf, format="JPEG", exif=exif)
    data = buf.getvalue()
    _, width, height = pipeline.save_page(data, hashlib.sha256(data).hexdigest())
    assert (width, height) == (200, 400), (width, height)
