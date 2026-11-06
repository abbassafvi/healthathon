import json
from typing import Any

import psycopg

from tests.helpers import DEMO, decide, patient_id, queue_item_for, verify_audit_chain

FIVE = ["grounding", "reread_agreement", "cross_document", "well_formed", "legibility"]


def _without_ids(value: Any) -> Any:
    """The response with every identifier dropped, leaving what is rendered."""
    if isinstance(value, dict):
        return {k: _without_ids(v) for k, v in value.items() if not k.endswith("id")}
    if isinstance(value, list):
        return [_without_ids(v) for v in value]
    return value


def _document(db: psycopg.Connection[Any], registration_no: str, doc_type: str) -> str:
    row = db.execute(
        "SELECT d.id FROM core.document d JOIN core.patient p ON p.id = d.patient_id"
        " WHERE p.registration_no = %s AND d.doc_type = %s ORDER BY d.document_date DESC LIMIT 1",
        (registration_no, doc_type),
    ).fetchone()
    return str(row["id"])


def _reading(client: Any, document_id: str) -> dict[str, Any]:
    res = client.get(f"/api/documents/{document_id}/reading")
    assert res.status_code == 200, res.text
    return dict(res.json())


def _value(reading: dict[str, Any], analyte: str) -> dict[str, Any]:
    return next(v for v in reading["values"] if v["analyte_name"] == analyte)


def test_every_value_read_says_where_it_went(client: Any, db: psycopg.Connection[Any]) -> None:
    reading = _reading(client, _document(db, "DEV-0001", "lab_report"))
    assert reading["patient"]["registration_no"] == "DEV-0001"
    assert reading["run"]["reader_name"] == "dev-seed"
    went = {v["analyte_name"]: v["went_to"] for v in reading["values"]}
    assert went == {
        "HbA1c": "record", "Fasting plasma glucose": "person",
        "Serum creatinine": "record", "LDL cholesterol": "record",
    }  # fmt: skip
    # In the order they are printed, each with its box on the page.
    assert [v["box"]["y"] for v in reading["values"]] == sorted(
        v["box"]["y"] for v in reading["values"]
    )
    assert all(v["page_no"] == 1 for v in reading["values"])
    page = reading["pages"][0]
    assert client.get(page["url"]).status_code == 200


def test_a_value_through_the_record_passed_every_check_and_is_shown(
    client: Any, db: psycopg.Connection[Any]
) -> None:
    hba1c = _value(_reading(client, _document(db, "DEV-0001", "lab_report")), "HbA1c")
    assert [c["code"] for c in hba1c["checks"]] == FIVE
    assert {c["outcome"] for c in hba1c["checks"]} <= {"pass", "not_applicable"}
    assert hba1c["shown"] == {"value_text": "8.4", "unit_text": "%"}
    assert hba1c["settled"] is None and hba1c["waiting"] is False


def test_a_value_sent_to_a_person_names_the_reason_and_the_check_but_is_not_shown(
    client: Any, db: psycopg.Connection[Any]
) -> None:
    reading = _reading(client, _document(db, "DEV-0001", "lab_report"))
    fpg = _value(reading, "Fasting plasma glucose")
    assert (fpg["reason"], fpg["waiting"], fpg["shown"]) == ("region_illegible", True, None)
    assert [c["code"] for c in fpg["checks"] if c["outcome"] == "fail"] == ["legibility"]
    # The unconfirmed value appears nowhere in the response. Identifiers are
    # left out of the search: a random uuid contains "162" often enough to
    # fail this on its own.
    assert "162" not in json.dumps(_without_ids(reading))


def test_a_confirmed_value_names_who_settled_it_and_how_long_it_took(
    client: Any, db: psycopg.Connection[Any]
) -> None:
    decide(client, queue_item_for(client, "DEV-0001", "fpg")["id"], action="confirm")
    fpg = _value(
        _reading(client, _document(db, "DEV-0001", "lab_report")), "Fasting plasma glucose"
    )
    assert fpg["waiting"] is False
    assert fpg["shown"] == {"value_text": "162", "unit_text": "mg/dL"}
    settled = fpg["settled"]
    assert (settled["action"], settled["by_name"], settled["decision_latency_ms"]) == (
        "confirmed", DEMO, 1200,
    )  # fmt: skip


def test_a_corrected_value_shows_the_correction_and_what_the_reader_had(
    client: Any, db: psycopg.Connection[Any]
) -> None:
    item = queue_item_for(client, "DEV-0002", "hba1c")
    decide(client, item["id"], action="correct", value_text="7.7", unit_text="%")
    hba1c = _value(_reading(client, _document(db, "DEV-0002", "lab_report")), "HbA1c")
    assert hba1c["shown"] == {"value_text": "7.7", "unit_text": "%"}
    assert hba1c["settled"]["action"] == "corrected"
    assert hba1c["settled"]["original_value_text"] == "7.1"
    assert [c["code"] for c in hba1c["checks"] if c["outcome"] == "fail"] == ["reread_agreement"]


def test_a_discarded_value_is_never_shown(client: Any, db: psycopg.Connection[Any]) -> None:
    decide(client, queue_item_for(client, "DEV-0003", "fpg")["id"], action="discard")
    reading = _reading(client, _document(db, "DEV-0003", "lab_report"))
    fpg = _value(reading, "Fasting plasma glucose")
    assert (fpg["settled"]["action"], fpg["shown"]) == ("discarded", None)
    assert [c["code"] for c in fpg["checks"] if c["outcome"] == "fail"] == ["well_formed"]
    assert "1410" not in json.dumps(reading)


def test_prescription_lines_waiting_for_review_are_not_shown(
    client: Any, db: psycopg.Connection[Any]
) -> None:
    reading = _reading(client, _document(db, "DEV-0002", "prescription"))
    assert reading["values"] == []
    assert reading["lines"] and all(line["state"] == "waiting" for line in reading["lines"])
    assert all(line["drug_text"] is None for line in reading["lines"])
    checklist = client.get(f"/api/patients/{patient_id(db, 'DEV-0002')}/checklist").json()
    assert {line["regimen_id"] for line in reading["lines"]} == {
        checklist["awaiting_review"][0]["regimen_id"]
    }


def test_reviewed_lines_show_who_confirmed_and_what_a_correction_replaced(
    client: Any, db: psycopg.Connection[Any]
) -> None:
    doc = _document(db, "DEV-0002", "prescription")
    first, second = _reading(client, doc)["lines"][:2]
    assert (
        client.post(
            f"/api/regimen-items/{first['id']}/confirm", json={"decision_latency_ms": 900}
        ).status_code
        == 200
    )
    assert (
        client.post(
            f"/api/regimen-items/{second['id']}/confirm",
            json={"decision_latency_ms": 900, "dose_text": "12 units"},
        ).status_code
        == 200
    )
    lines = {line["id"]: line for line in _reading(client, doc)["lines"]}
    confirmed, corrected = lines[first["id"]], lines[second["id"]]
    assert (confirmed["state"], confirmed["by_name"]) == ("confirmed", DEMO)
    assert confirmed["drug_text"]
    assert corrected["state"] == "corrected" and corrected["dose_text"] == "12 units"
    assert corrected["original_text"] and "12 units" not in corrected["original_text"]


def test_reading_a_document_is_audited_and_a_missing_one_is_404(
    client: Any, db: psycopg.Connection[Any]
) -> None:
    doc = _document(db, "DEV-0001", "lab_report")
    _reading(client, doc)
    [event] = verify_audit_chain(db)
    assert (event["action"], str(event["entity_id"])) == ("document.reading_read", doc)
    missing = "00000000-0000-0000-0000-000000000000"
    assert client.get(f"/api/documents/{missing}/reading").status_code == 404
