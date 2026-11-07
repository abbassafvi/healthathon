"""
The reading pipeline: a photograph in, a document and its values out.

The rule these tests exist to hold is the project's first one: a value
reaches the record only when it can be pointed at a region of the page,
and anything else reaches a person instead.
"""

from collections.abc import Iterator
from typing import Any

import psycopg
import pytest

from healthathon.uploads.agent import DocumentReading, LabValue, RegimenLine, RequestedTest
from healthathon.uploads.detector import Box
from healthathon.uploads.factory import set_agent, set_detector
from healthathon.uploads.jobs import registry
from tests.fakes import FakeAgent, FakeDetector, page_image, upload, wait_for
from tests.helpers import patient_id

BOXES = [
    Box(0.10, 0.08, 0.60, 0.03),
    Box(0.10, 0.15, 0.60, 0.03),
    Box(0.10, 0.22, 0.60, 0.03),
]


@pytest.fixture(autouse=True)
def _reader() -> Iterator[None]:
    """Every test reads with the fakes, and leaves nothing installed behind it."""
    set_detector(FakeDetector(BOXES))
    registry().clear()
    yield
    set_detector(None)
    set_agent(None)


def lab(**over: Any) -> DocumentReading:
    base = DocumentReading(
        values=[
            LabValue(box_index=0, analyte_code="hba1c", value_text="7.4", unit_text="%"),
            LabValue(box_index=1, analyte_code="fpg", value_text="138", unit_text="mg/dL"),
        ],
        document_date=None,
        issuing_source="Lucknow Diagnostics (fictional)",
    )
    for key, value in over.items():
        setattr(base, key, value)
    return base


def test_a_lab_report_is_read_and_its_values_land_in_the_record(
    client: Any, db: psycopg.Connection[Any]
) -> None:
    set_agent(FakeAgent(lab()))
    pid = patient_id(db, "DEV-0001")

    created = upload(client, pid, page_image())
    assert created.status_code == 201, created.text
    body = wait_for(client, created.json()["id"])

    assert body["stage"] == "done", body
    assert body["outcome"]["values_in_record"] == 2
    assert body["outcome"]["sent_to_queue"] == []
    assert body["outcome"]["regimen_id"] is None


def test_every_value_written_carries_a_region_on_the_page(
    client: Any, db: psycopg.Connection[Any]
) -> None:
    set_agent(FakeAgent(lab()))
    pid = patient_id(db, "DEV-0001")
    doc = wait_for(client, upload(client, pid, page_image()).json()["id"])["outcome"]["document_id"]

    rows = db.execute(
        "SELECT p.kind, p.bbox_x, p.bbox_y, p.bbox_w, p.bbox_h, p.crop_sha256"
        " FROM core.extracted_value v JOIN core.provenance p ON p.id = v.provenance_id"
        " WHERE v.document_id = %s",
        (doc,),
    ).fetchall()
    assert len(rows) == 2
    for row in rows:
        assert row["kind"] == "source_document"
        assert row["bbox_x"] is not None and row["bbox_w"] is not None
        # The crop a person would be shown is identified, not merely re-derivable.
        assert row["crop_sha256"] is not None


def test_each_value_records_all_five_checks(client: Any, db: psycopg.Connection[Any]) -> None:
    set_agent(FakeAgent(lab()))
    pid = patient_id(db, "DEV-0001")
    doc = wait_for(client, upload(client, pid, page_image()).json()["id"])["outcome"]["document_id"]

    codes = db.execute(
        "SELECT c.check_code::text AS code, count(*) AS n FROM core.check_result c"
        " JOIN core.extracted_value v ON v.id = c.extracted_value_id"
        " WHERE v.document_id = %s GROUP BY 1",
        (doc,),
    ).fetchall()
    assert {r["code"] for r in codes} == {
        "grounding",
        "legibility",
        "well_formed",
        "reread_agreement",
        "cross_document",
    }


def test_an_unknown_unit_goes_to_a_person_and_not_into_the_record(
    client: Any, db: psycopg.Connection[Any]
) -> None:
    reading = lab(
        values=[LabValue(box_index=0, analyte_code="hba1c", value_text="7.4", unit_text="furlongs")]
    )
    set_agent(FakeAgent(reading))
    pid = patient_id(db, "DEV-0001")

    body = wait_for(client, upload(client, pid, page_image()).json()["id"])
    assert body["outcome"]["values_in_record"] == 0
    assert body["outcome"]["sent_to_queue"] == [{"reason": "unknown_unit", "count": 1}]

    row = db.execute(
        "SELECT v.state::text AS state, q.crop_storage_key FROM core.extracted_value v"
        " JOIN core.confirm_queue_item q ON q.extracted_value_id = v.id"
        " WHERE v.document_id = %s",
        (body["outcome"]["document_id"],),
    ).fetchone()
    assert row is not None
    assert row["state"] == "needs_confirm"
    # The queue renders this crop before it enables its controls.
    assert row["crop_storage_key"]


def test_a_value_that_is_not_a_number_never_reaches_the_record(
    client: Any, db: psycopg.Connection[Any]
) -> None:
    set_agent(
        FakeAgent(
            lab(values=[LabValue(box_index=0, analyte_code="fpg", value_text="one four two")])
        )
    )
    pid = patient_id(db, "DEV-0001")
    body = wait_for(client, upload(client, pid, page_image()).json()["id"])
    assert body["outcome"]["values_in_record"] == 0
    assert body["outcome"]["sent_to_queue"][0]["count"] == 1


def test_a_region_too_blurred_to_read_goes_to_a_person(
    client: Any, db: psycopg.Connection[Any]
) -> None:
    set_agent(FakeAgent(lab(values=[LabValue(box_index=0, analyte_code="fpg", value_text="138")])))
    pid = patient_id(db, "DEV-0001")

    body = wait_for(client, upload(client, pid, page_image(blurry=True)).json()["id"])
    assert body["outcome"]["sent_to_queue"] == [{"reason": "region_illegible", "count": 1}]


def test_a_reading_citing_a_region_that_does_not_exist_is_dropped(
    client: Any, db: psycopg.Connection[Any]
) -> None:
    """A model that invents an index has invented the value with it."""
    set_agent(
        FakeAgent(
            lab(
                values=[
                    LabValue(box_index=99, analyte_code="hba1c", value_text="7.4", unit_text="%")
                ]
            )
        )
    )
    pid = patient_id(db, "DEV-0001")
    body = wait_for(client, upload(client, pid, page_image()).json()["id"])

    assert body["outcome"]["values_in_record"] == 0
    count = db.execute(
        "SELECT count(*) AS n FROM core.extracted_value WHERE document_id = %s",
        (body["outcome"]["document_id"],),
    ).fetchone()
    assert count is not None and count["n"] == 0


def test_a_prescription_becomes_a_regimen_awaiting_review(
    client: Any, db: psycopg.Connection[Any]
) -> None:
    set_agent(
        FakeAgent(
            DocumentReading(
                lines=[
                    RegimenLine(0, "Tab. Metformin", "500 mg", "1-0-1"),
                    RegimenLine(1, "Tab. Vildagliptin", "50 mg", "1-0-1"),
                ]
            )
        )
    )
    pid = patient_id(db, "DEV-0001")

    body = wait_for(client, upload(client, pid, page_image(), doc_type="prescription").json()["id"])
    assert body["outcome"]["regimen_id"] is not None
    assert body["outcome"]["values_in_record"] == 0

    items = db.execute(
        "SELECT i.drug_text, i.dose_text, i.schedule_text, i.confirmed_at, p.bbox_x"
        " FROM core.regimen_item i JOIN core.provenance p ON p.id = i.provenance_id"
        " WHERE i.regimen_id = %s ORDER BY i.drug_text",
        (body["outcome"]["regimen_id"],),
    ).fetchall()
    assert [r["drug_text"] for r in items] == ["Tab. Metformin", "Tab. Vildagliptin"]
    # Nothing reaches a patient's checklist until a clinician confirms it.
    assert all(r["confirmed_at"] is None for r in items)
    assert all(r["bbox_x"] is not None for r in items)


def test_a_regimen_is_not_activated_by_reading_it(client: Any, db: psycopg.Connection[Any]) -> None:
    set_agent(
        FakeAgent(DocumentReading(lines=[RegimenLine(0, "Tab. Metformin", "500 mg", "1-0-1")]))
    )
    pid = patient_id(db, "DEV-0001")
    body = wait_for(client, upload(client, pid, page_image(), doc_type="prescription").json()["id"])
    row = db.execute(
        "SELECT activated_at, activated_by FROM core.regimen WHERE id = %s",
        (body["outcome"]["regimen_id"],),
    ).fetchone()
    assert row is not None
    assert row["activated_at"] is None and row["activated_by"] is None


def test_a_test_the_page_asks_for_is_recorded_with_its_own_region(
    client: Any, db: psycopg.Connection[Any]
) -> None:
    set_agent(FakeAgent(lab(orders=[RequestedTest(box_index=2, analyte_code="ldl")])))
    pid = patient_id(db, "DEV-0001")
    body = wait_for(client, upload(client, pid, page_image()).json()["id"])

    row = db.execute(
        "SELECT o.analyte_code, p.bbox_y FROM core.test_order o"
        " JOIN core.provenance p ON p.id = o.provenance_id WHERE o.source_document_id = %s",
        (body["outcome"]["document_id"],),
    ).fetchone()
    assert row is not None
    assert row["analyte_code"] == "ldl"
    assert float(row["bbox_y"]) == pytest.approx(BOXES[2].y)


def test_the_agent_is_shown_one_crop_for_every_region_found(
    client: Any, db: psycopg.Connection[Any]
) -> None:
    agent = FakeAgent(lab())
    set_agent(agent)
    pid = patient_id(db, "DEV-0001")
    wait_for(client, upload(client, pid, page_image()).json()["id"])

    assert [c.index for c in agent.seen] == [0, 1, 2]
    assert all(c.path.is_file() for c in agent.seen)


def test_the_same_capture_sent_twice_is_one_upload(
    client: Any, db: psycopg.Connection[Any]
) -> None:
    set_agent(FakeAgent(lab()))
    pid = patient_id(db, "DEV-0001")
    data = page_image()

    first = upload(client, pid, data, capture="cap-retry")
    wait_for(client, first.json()["id"])
    again = upload(client, pid, data, capture="cap-retry")

    assert again.json()["id"] == first.json()["id"]
    count = db.execute("SELECT count(*) AS n FROM core.intake").fetchone()
    assert count is not None


def test_a_photograph_already_in_the_record_is_recognised(
    client: Any, db: psycopg.Connection[Any]
) -> None:
    set_agent(FakeAgent(lab()))
    pid = patient_id(db, "DEV-0001")
    data = page_image()
    wait_for(client, upload(client, pid, data, capture="cap-a").json()["id"])

    second = upload(client, pid, data, capture="cap-b")
    assert second.json()["stage"] == "duplicate"


def test_a_page_with_no_writing_on_it_fails_and_says_so(
    client: Any, db: psycopg.Connection[Any]
) -> None:
    set_detector(FakeDetector([]))
    set_agent(FakeAgent(lab()))
    pid = patient_id(db, "DEV-0001")

    body = wait_for(client, upload(client, pid, page_image()).json()["id"])
    assert body["stage"] == "failed"
    assert "could not be found" in body["failure"]


def test_an_upload_for_an_unknown_patient_is_refused(client: Any) -> None:
    set_agent(FakeAgent(lab()))
    res = upload(client, "00000000-0000-0000-0000-000000000000", page_image())
    assert res.status_code == 404


def test_an_empty_file_is_refused(client: Any, db: psycopg.Connection[Any]) -> None:
    res = upload(client, patient_id(db, "DEV-0001"), b"")
    assert res.status_code == 422


def test_an_unknown_upload_is_not_found(client: Any) -> None:
    assert client.get("/api/uploads/does-not-exist").status_code == 404


def test_two_pages_read_at_once_both_finish(client: Any, db: psycopg.Connection[Any]) -> None:
    """
    Each read runs in its own thread with its own connection. With the
    pool's default size those two, the requests that started them and the
    polling behind them used every connection and waited on each other.
    """
    set_agent(FakeAgent(lab()))
    pid = patient_id(db, "DEV-0001")

    first = upload(client, pid, page_image(1240, 1754), capture="c-a")
    second = upload(client, pid, page_image(1200, 1700), capture="c-b")
    assert (first.status_code, second.status_code) == (201, 201)

    assert wait_for(client, first.json()["id"], timeout_s=60)["stage"] == "done"
    assert wait_for(client, second.json()["id"], timeout_s=60)["stage"] == "done"

    count = db.execute(
        "SELECT count(*) AS n FROM core.document WHERE storage_key LIKE 'documents/%'"
    ).fetchone()
    assert count is not None and count["n"] == 2


def test_the_page_is_read_three_times_by_default(client: Any, db: psycopg.Connection[Any]) -> None:
    agent = FakeAgent(lab())
    set_agent(agent)
    pid = patient_id(db, "DEV-0001")
    wait_for(client, upload(client, pid, page_image()).json()["id"])
    assert agent.reads == 3


def test_a_value_that_changes_between_reads_goes_to_a_person(
    client: Any, db: psycopg.Connection[Any]
) -> None:
    """Ask again: a reader that keeps changing its answer has not read it."""
    steady = LabValue(box_index=0, analyte_code="hba1c", value_text="7.4", unit_text="%")
    set_agent(
        FakeAgent(
            [
                lab(values=[steady, LabValue(1, "fpg", "138", "mg/dL")]),
                lab(values=[steady, LabValue(1, "fpg", "188", "mg/dL")]),
                lab(values=[steady, LabValue(1, "fpg", "138", "mg/dL")]),
            ]
        )
    )
    pid = patient_id(db, "DEV-0001")
    body = wait_for(client, upload(client, pid, page_image()).json()["id"])

    assert body["outcome"]["values_in_record"] == 1
    assert body["outcome"]["sent_to_queue"] == [{"reason": "readers_disagree", "count": 1}]

    row = db.execute(
        "SELECT v.value_text, c.outcome::text AS outcome, c.signal FROM core.extracted_value v"
        " JOIN core.check_result c ON c.extracted_value_id = v.id"
        " WHERE v.document_id = %s AND c.check_code = 'reread_agreement' AND c.outcome = 'fail'",
        (body["outcome"]["document_id"],),
    ).fetchone()
    assert row is not None and row["value_text"] == "138"


def test_a_line_two_reads_of_three_agree_on_is_written(
    client: Any, db: psycopg.Connection[Any], auto_accept: None
) -> None:
    """
    Three reads of handwriting differ somewhere nearly every time.
    Demanding all three meant a real prescription wrote nothing.
    """
    steady = RegimenLine(0, "Tab. Metformin", "500 mg", "1-0-1")
    set_agent(
        FakeAgent(
            [
                DocumentReading(lines=[steady, RegimenLine(1, "Tab. Glicazide", "80 mg", "1-0-0")]),
                DocumentReading(lines=[steady, RegimenLine(1, "Tab. Glicazide", "40 mg", "1-0-0")]),
                DocumentReading(lines=[steady, RegimenLine(1, "Tab. Glicazide", "80 mg", "1-0-0")]),
            ]
        )
    )
    pid = patient_id(db, "DEV-0001")
    body = wait_for(client, upload(client, pid, page_image(), doc_type="prescription").json()["id"])

    items = db.execute(
        "SELECT drug_text, dose_text FROM core.regimen_item WHERE regimen_id = %s"
        " ORDER BY drug_text",
        (body["outcome"]["regimen_id"],),
    ).fetchall()
    assert [(r["drug_text"], r["dose_text"]) for r in items] == [
        ("Tab. Glicazide", "80 mg"),
        ("Tab. Metformin", "500 mg"),
    ]


def test_a_line_no_two_reads_agree_on_waits_for_a_clinician(
    client: Any, db: psycopg.Connection[Any], auto_accept: None
) -> None:
    """
    Disagreement means a person should look, not that a medicine should
    vanish. Dropping it left a drug that is on the page in front of
    nobody at all.
    """
    steady = RegimenLine(0, "Tab. Metformin", "500 mg", "1-0-1")
    set_agent(
        FakeAgent(
            [
                DocumentReading(lines=[steady, RegimenLine(1, "Tab. Glicazide", "80 mg", "1-0-0")]),
                DocumentReading(lines=[steady, RegimenLine(1, "Tab. Glicazide", "40 mg", "1-0-0")]),
                DocumentReading(lines=[steady, RegimenLine(1, "Tab. Glicazide", "20 mg", "1-0-0")]),
            ]
        )
    )
    pid = patient_id(db, "DEV-0001")
    body = wait_for(client, upload(client, pid, page_image(), doc_type="prescription").json()["id"])

    assert body["outcome"]["lines_accepted"] == 1
    assert body["outcome"]["lines_for_a_person"] == 1

    rows = db.execute(
        "SELECT i.drug_text, i.accepted_at IS NOT NULL AS settled,"
        " (SELECT c.outcome::text FROM core.check_result c"
        "   WHERE c.regimen_item_id = i.id AND c.check_code = 'reread_agreement') AS reread"
        " FROM core.regimen_item i WHERE i.regimen_id = %s ORDER BY i.drug_text",
        (body["outcome"]["regimen_id"],),
    ).fetchall()
    # Both medicines are written. The one they argued over waits.
    assert [r["drug_text"] for r in rows] == ["Tab. Glicazide", "Tab. Metformin"]
    assert (rows[0]["settled"], rows[0]["reread"]) == (False, "fail")
    assert (rows[1]["settled"], rows[1]["reread"]) == (True, "pass")


def test_the_threshold_decides_where_a_reading_goes(
    client: Any, db: psycopg.Connection[Any], auto_accept: None
) -> None:
    """
    One smeared region. Three checks apply (the report carries no date,
    so there is nothing to compare across documents) and two pass, so
    the reading scores 0.667. Strict, it goes to a person. Lower the
    threshold and the same reading joins the record instead.
    """
    from healthathon.config import get_settings

    reading = lab(values=[LabValue(0, "fpg", "138", "mg/dL")])
    pid = patient_id(db, "DEV-0001")

    set_agent(FakeAgent(reading))
    strict = wait_for(client, upload(client, pid, page_image(blurry=True)).json()["id"])
    assert strict["outcome"]["values_in_record"] == 0
    assert strict["outcome"]["sent_to_queue"] == [{"reason": "region_illegible", "count": 1}]

    settings = get_settings()
    was = settings.confidence_threshold
    settings.confidence_threshold = 0.6
    try:
        registry().clear()
        set_agent(FakeAgent(reading))
        lenient = wait_for(
            client,
            upload(client, pid, page_image(blurry=True, width=1000), capture="cap-2").json()["id"],
        )
        assert lenient["outcome"]["values_in_record"] == 1
        assert lenient["outcome"]["sent_to_queue"] == []
    finally:
        settings.confidence_threshold = was


def test_the_score_for_every_reading_is_kept_with_the_run(
    client: Any, db: psycopg.Connection[Any]
) -> None:
    set_agent(FakeAgent(lab()))
    pid = patient_id(db, "DEV-0001")
    body = wait_for(client, upload(client, pid, page_image()).json()["id"])

    row = db.execute(
        "SELECT raw_output FROM core.extraction_run WHERE document_id = %s",
        (body["outcome"]["document_id"],),
    ).fetchone()
    assert row is not None
    raw = row["raw_output"]
    assert raw["confidence_threshold"] == 1.0
    assert set(raw["confidence"]) == {"0", "1"}
    assert all(v == 1.0 for v in raw["confidence"].values())


def test_a_test_a_prescription_advises_is_recorded_too(
    client: Any, db: psycopg.Connection[Any]
) -> None:
    """A prescription prescribes and advises. Both carry their own box."""
    set_agent(
        FakeAgent(
            DocumentReading(
                lines=[RegimenLine(0, "Tab. Metformin", "500 mg", "1-0-1")],
                orders=[RequestedTest(box_index=1, analyte_code="hba1c")],
            )
        )
    )
    pid = patient_id(db, "DEV-0001")
    body = wait_for(client, upload(client, pid, page_image(), doc_type="prescription").json()["id"])

    row = db.execute(
        "SELECT o.analyte_code, p.bbox_y FROM core.test_order o"
        " JOIN core.provenance p ON p.id = o.provenance_id WHERE o.source_document_id = %s",
        (body["outcome"]["document_id"],),
    ).fetchone()
    assert row is not None
    assert row["analyte_code"] == "hba1c"
    assert float(row["bbox_y"]) == pytest.approx(BOXES[1].y)


# ---- a prescription line the checks can settle ----------------------


def test_a_clean_line_is_accepted_without_a_person(
    client: Any, db: psycopg.Connection[Any], auto_accept: None
) -> None:
    set_agent(
        FakeAgent(DocumentReading(lines=[RegimenLine(0, "Tab. Metformin", "500 mg", "1-0-1")]))
    )
    pid = patient_id(db, "DEV-0001")
    body = wait_for(client, upload(client, pid, page_image(), doc_type="prescription").json()["id"])

    assert body["outcome"]["lines_accepted"] == 1
    assert body["outcome"]["lines_for_a_person"] == 0
    row = db.execute(
        "SELECT accepted_at, confirmed_at, confirmed_by FROM core.regimen_item"
        " WHERE regimen_id = %s",
        (body["outcome"]["regimen_id"],),
    ).fetchone()
    assert row is not None
    assert row["accepted_at"] is not None
    # The record never says a person looked at a line nobody looked at.
    assert row["confirmed_at"] is None and row["confirmed_by"] is None


def test_a_dose_nobody_could_act_on_waits_for_a_person(
    client: Any, db: psycopg.Connection[Any], auto_accept: None
) -> None:
    set_agent(
        FakeAgent(
            DocumentReading(
                lines=[
                    RegimenLine(0, "Tab. Metformin", "500 mg", "1-0-1"),
                    RegimenLine(1, "Tab. Something", "as directed", None),
                ]
            )
        )
    )
    pid = patient_id(db, "DEV-0001")
    body = wait_for(client, upload(client, pid, page_image(), doc_type="prescription").json()["id"])

    assert body["outcome"]["lines_accepted"] == 1
    assert body["outcome"]["lines_for_a_person"] == 1
    waiting = db.execute(
        "SELECT drug_text FROM core.regimen_item WHERE regimen_id = %s AND accepted_at IS NULL",
        (body["outcome"]["regimen_id"],),
    ).fetchall()
    assert [r["drug_text"] for r in waiting] == ["Tab. Something"]


def test_a_line_read_off_a_smeared_region_waits_for_a_person(
    client: Any, db: psycopg.Connection[Any]
) -> None:
    set_agent(
        FakeAgent(DocumentReading(lines=[RegimenLine(0, "Tab. Metformin", "500 mg", "1-0-1")]))
    )
    pid = patient_id(db, "DEV-0001")
    body = wait_for(
        client,
        upload(client, pid, page_image(blurry=True), doc_type="prescription").json()["id"],
    )
    assert body["outcome"]["lines_accepted"] == 0
    assert body["outcome"]["lines_for_a_person"] == 1


def test_every_line_records_the_checks_it_ran(client: Any, db: psycopg.Connection[Any]) -> None:
    set_agent(
        FakeAgent(DocumentReading(lines=[RegimenLine(0, "Tab. Metformin", "500 mg", "1-0-1")]))
    )
    pid = patient_id(db, "DEV-0001")
    body = wait_for(client, upload(client, pid, page_image(), doc_type="prescription").json()["id"])
    codes = db.execute(
        "SELECT c.check_code::text AS code, c.outcome::text AS outcome FROM core.check_result c"
        " JOIN core.regimen_item i ON i.id = c.regimen_item_id WHERE i.regimen_id = %s",
        (body["outcome"]["regimen_id"],),
    ).fetchall()
    assert {r["code"] for r in codes} == {
        "grounding",
        "legibility",
        "well_formed",
        "reread_agreement",
        "cross_document",
    }
    # A prescription line has no second document to be compared against.
    assert next(r for r in codes if r["code"] == "cross_document")["outcome"] == "not_applicable"


def test_a_checklist_of_accepted_lines_activates_with_nobody_confirming(
    client: Any, db: psycopg.Connection[Any], auto_accept: None
) -> None:
    set_agent(
        FakeAgent(
            DocumentReading(
                lines=[
                    RegimenLine(0, "Tab. Metformin", "500 mg", "1-0-1"),
                    RegimenLine(1, "Tab. Vildagliptin", "50 mg", "1-0-1"),
                ]
            )
        )
    )
    pid = patient_id(db, "DEV-0001")
    body = wait_for(client, upload(client, pid, page_image(), doc_type="prescription").json()["id"])
    res = client.post(f"/api/regimens/{body['outcome']['regimen_id']}/activate")
    assert res.status_code == 200, res.text


def test_a_checklist_still_refuses_to_activate_with_a_line_nobody_settled(
    client: Any, db: psycopg.Connection[Any]
) -> None:
    set_agent(
        FakeAgent(
            DocumentReading(
                lines=[
                    RegimenLine(0, "Tab. Metformin", "500 mg", "1-0-1"),
                    RegimenLine(1, "Tab. Something", "as directed", None),
                ]
            )
        )
    )
    pid = patient_id(db, "DEV-0001")
    body = wait_for(client, upload(client, pid, page_image(), doc_type="prescription").json()["id"])
    res = client.post(f"/api/regimens/{body['outcome']['regimen_id']}/activate")
    assert res.status_code == 409
    assert "confirmed" in res.json()["detail"]


def test_a_provider_failure_never_reaches_the_screen_raw(
    client: Any, db: psycopg.Connection[Any]
) -> None:
    """
    A clinician was once shown "Server error '503 Service Unavailable'
    for url https://generativelanguage.googleapis.com/..." with a link to
    an HTTP status page. That names a host and a status code, and says
    nothing about the page in their hand or what to do next.
    """
    from healthathon.uploads.providers import ModelUnavailable

    set_agent(
        FakeAgent(
            ModelUnavailable(
                "Server error '503 Service Unavailable' for url "
                "'https://generativelanguage.googleapis.com/v1beta/models/x:generateContent"
                "?key=REDACTED' For more information check: "
                "https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/503"
            )
        )
    )
    pid = patient_id(db, "DEV-0001")
    body = wait_for(client, upload(client, pid, page_image()).json()["id"])

    assert body["stage"] == "failed"
    failure = body["failure"]
    for leaked in ("503", "http", "googleapis", "mozilla", "url"):
        assert leaked not in failure.lower(), f"{leaked!r} reached the screen: {failure}"
    # It names the problem and the recovery.
    assert "could not be reached" in failure
    assert "try again" in failure


def test_a_page_with_no_writing_still_says_so_in_its_own_words(
    client: Any, db: psycopg.Connection[Any]
) -> None:
    """The pipeline's own sentences survive; only provider noise is replaced."""
    set_detector(FakeDetector([]))
    set_agent(FakeAgent(lab()))
    pid = patient_id(db, "DEV-0001")
    body = wait_for(client, upload(client, pid, page_image()).json()["id"])
    assert body["stage"] == "failed"
    assert "could not be found in this photograph" in body["failure"]


def test_a_result_written_on_a_consultation_card_reaches_the_record(
    client: Any, db: psycopg.Connection[Any]
) -> None:
    """
    A card prescribes and reports in the same hand: "F = 180" beside the
    prescribing. The medicine becomes a regimen line and the result
    becomes a value, each with its own region.
    """
    set_agent(
        FakeAgent(
            DocumentReading(
                lines=[RegimenLine(0, "Tab. Oxra", "10 mg", "1-0-0")],
                values=[
                    LabValue(1, "fpg", "180", "mg/dL"),
                    LabValue(2, "ppbg", "205", "mg/dL"),
                ],
            )
        )
    )
    pid = patient_id(db, "DEV-0001")
    body = wait_for(client, upload(client, pid, page_image(), doc_type="prescription").json()["id"])

    assert body["outcome"]["regimen_id"] is not None
    assert body["outcome"]["values_in_record"] == 2

    rows = db.execute(
        "SELECT v.analyte_code, v.value_text, p.bbox_y IS NOT NULL AS has_box"
        " FROM core.extracted_value v JOIN core.provenance p ON p.id = v.provenance_id"
        " WHERE v.document_id = %s ORDER BY v.analyte_code",
        (body["outcome"]["document_id"],),
    ).fetchall()
    assert [(r["analyte_code"], r["value_text"]) for r in rows] == [
        ("fpg", "180"),
        ("ppbg", "205"),
    ]
    assert all(r["has_box"] for r in rows)


def test_a_card_records_a_test_it_advises_only_once(
    client: Any, db: psycopg.Connection[Any]
) -> None:
    """Both write paths run on a prescription; the order must not double."""
    set_agent(
        FakeAgent(
            DocumentReading(
                lines=[RegimenLine(0, "Tab. Oxra", "10 mg", "1-0-0")],
                orders=[RequestedTest(box_index=1, analyte_code="hba1c")],
            )
        )
    )
    pid = patient_id(db, "DEV-0001")
    body = wait_for(client, upload(client, pid, page_image(), doc_type="prescription").json()["id"])
    count = db.execute(
        "SELECT count(*) AS n FROM core.test_order WHERE source_document_id = %s",
        (body["outcome"]["document_id"],),
    ).fetchone()
    assert count is not None and count["n"] == 1


def test_one_medicine_landing_on_two_regions_across_reads_is_written_once(
    client: Any, db: psycopg.Connection[Any]
) -> None:
    """
    Each read folds its own repeats, but the reads are then put together
    by region. The same drug landing on two regions in two reads came
    through as two medicines on a real card.
    """
    steady = RegimenLine(0, "Tab. Rybelsus", "14 mg", "OD")
    set_agent(
        FakeAgent(
            [
                DocumentReading(lines=[steady, RegimenLine(1, "Tab. Cilacar", "10", "OD")]),
                DocumentReading(lines=[steady, RegimenLine(2, "Tab. Cilacar", "10", "OD")]),
                DocumentReading(lines=[steady, RegimenLine(1, "Tab. Cilacar", "10", "OD")]),
            ]
        )
    )
    pid = patient_id(db, "DEV-0001")
    body = wait_for(client, upload(client, pid, page_image(), doc_type="prescription").json()["id"])

    rows = db.execute(
        "SELECT drug_text FROM core.regimen_item WHERE regimen_id = %s ORDER BY drug_text",
        (body["outcome"]["regimen_id"],),
    ).fetchall()
    assert [r["drug_text"] for r in rows] == ["Tab. Cilacar", "Tab. Rybelsus"]


def test_a_medicine_with_no_dose_reaches_a_clinician(
    client: Any, db: psycopg.Connection[Any]
) -> None:
    """Written, not discarded, and failing the dose check so a person looks."""
    set_agent(
        FakeAgent(
            DocumentReading(
                lines=[
                    RegimenLine(0, "Tab. Rybelsus", "14 mg", "OD"),
                    RegimenLine(1, "Tab. Nebimed", "", None),
                ]
            )
        )
    )
    pid = patient_id(db, "DEV-0001")
    body = wait_for(client, upload(client, pid, page_image(), doc_type="prescription").json()["id"])

    rows = db.execute(
        "SELECT i.drug_text, i.accepted_at IS NOT NULL AS settled,"
        " (SELECT c.outcome::text FROM core.check_result c"
        "   WHERE c.regimen_item_id=i.id AND c.check_code='well_formed') AS dose_check"
        " FROM core.regimen_item i WHERE i.regimen_id=%s ORDER BY i.drug_text",
        (body["outcome"]["regimen_id"],),
    ).fetchall()
    assert [r["drug_text"] for r in rows] == ["Tab. Nebimed", "Tab. Rybelsus"]
    assert (rows[0]["settled"], rows[0]["dose_check"]) == (False, "fail")


def test_advice_is_written_apart_from_the_medicines(
    client: Any, db: psycopg.Connection[Any], auto_accept: None
) -> None:
    """
    A walk the patient ticks must never be counted as a dose. Advice
    lives in its own table so the compliance score, which reads
    medication ticks, can only ever see medicines.
    """
    from healthathon.uploads.agent import Advice

    set_agent(
        FakeAgent(
            DocumentReading(
                lines=[RegimenLine(0, "Tab. Rybelsus", "14 mg", "OD")],
                advice=[Advice(1, "Diet = 1000 kcal/day"), Advice(2, "Daily walk")],
            )
        )
    )
    pid = patient_id(db, "DEV-0001")
    body = wait_for(client, upload(client, pid, page_image(), doc_type="prescription").json()["id"])
    regimen = body["outcome"]["regimen_id"]

    notes = db.execute(
        "SELECT a.advice_text, a.accepted_at IS NOT NULL AS settled, p.bbox_y IS NOT NULL AS boxed"
        " FROM core.regimen_advice a JOIN core.provenance p ON p.id = a.provenance_id"
        " WHERE a.regimen_id = %s ORDER BY a.advice_text",
        (regimen,),
    ).fetchall()
    assert [n["advice_text"] for n in notes] == ["Daily walk", "Diet = 1000 kcal/day"]
    # Written as given, with its own region, and never summarised.
    assert all(n["boxed"] for n in notes)

    # The medicines table holds only the medicine.
    meds = db.execute(
        "SELECT drug_text FROM core.regimen_item WHERE regimen_id = %s", (regimen,)
    ).fetchall()
    assert [m["drug_text"] for m in meds] == ["Tab. Rybelsus"]


def test_a_weight_and_a_blood_pressure_reach_the_record(
    client: Any, db: psycopg.Connection[Any]
) -> None:
    """A blood pressure is one reading of two numbers, kept as written."""
    set_agent(
        FakeAgent(
            DocumentReading(
                lines=[RegimenLine(0, "Tab. Rybelsus", "14 mg", "OD")],
                values=[LabValue(1, "weight", "88", "kg"), LabValue(2, "bp", "108/74", "mmHg")],
            )
        )
    )
    pid = patient_id(db, "DEV-0001")
    body = wait_for(client, upload(client, pid, page_image(), doc_type="prescription").json()["id"])

    rows = db.execute(
        "SELECT analyte_code, value_text FROM core.extracted_value WHERE document_id = %s"
        " ORDER BY analyte_code",
        (body["outcome"]["document_id"],),
    ).fetchall()
    assert [(r["analyte_code"], r["value_text"]) for r in rows] == [
        ("bp", "108/74"),
        ("weight", "88"),
    ]
