from typing import Any

import psycopg

from tests.helpers import decide, patient_id, queue_item_for, verify_audit_chain


def _record(client: Any, pid: str) -> dict[str, Any]:
    res = client.get(f"/api/patients/{pid}/record")
    assert res.status_code == 200, res.text
    return dict(res.json())


def _analytes(record: dict[str, Any]) -> list[str]:
    return [v["analyte_code"] for d in record["documents"] for v in d["values"]]


def test_lists_patients_by_registration_number(client: Any) -> None:
    res = client.get("/api/patients").json()
    assert [p["registration_no"] for p in res] == ["DEV-0001", "DEV-0002", "DEV-0003", "DEV-0004"]
    assert res[0]["full_name"] == "Asha Verma"


def test_record_holds_only_renderable_values_in_page_order(
    client: Any, db: psycopg.Connection[Any]
) -> None:
    record = _record(client, patient_id(db, "DEV-0001"))
    assert record["patient"]["registration_no"] == "DEV-0001"
    assert len(record["documents"]) == 1
    doc = record["documents"][0]
    assert doc["doc_type"] == "lab_report"
    # fpg is in the confirm queue, so it is not in the record.
    assert _analytes(record) == ["hba1c", "creatinine", "ldl"]
    assert [v["value_text"] for v in doc["values"]] == ["8.4", "0.92", "118"]


def test_a_confirmed_value_joins_the_record_in_page_order(
    client: Any, db: psycopg.Connection[Any]
) -> None:
    decide(client, queue_item_for(client, "DEV-0001", "fpg")["id"], action="confirm")
    record = _record(client, patient_id(db, "DEV-0001"))
    assert _analytes(record) == ["hba1c", "fpg", "creatinine", "ldl"]


def test_only_the_replacement_of_a_correction_is_shown(
    client: Any, db: psycopg.Connection[Any]
) -> None:
    decide(
        client,
        queue_item_for(client, "DEV-0001", "fpg")["id"],
        action="correct",
        value_text="168",
        unit_text="mg/dL",
    )
    values = _record(client, patient_id(db, "DEV-0001"))["documents"][0]["values"]
    assert [v["value_text"] for v in values if v["analyte_code"] == "fpg"] == ["168"]


def test_a_discarded_value_never_appears(client: Any, db: psycopg.Connection[Any]) -> None:
    decide(client, queue_item_for(client, "DEV-0001", "fpg")["id"], action="discard")
    assert "fpg" not in _analytes(_record(client, patient_id(db, "DEV-0001")))


def test_record_of_unknown_patient_is_404(client: Any) -> None:
    res = client.get("/api/patients/00000000-0000-0000-0000-000000000000/record")
    assert res.status_code == 404


def test_reading_a_record_is_audited(client: Any, db: psycopg.Connection[Any]) -> None:
    pid = patient_id(db, "DEV-0002")
    _record(client, pid)
    rows = verify_audit_chain(db)
    assert [(r["action"], str(r["entity_id"])) for r in rows] == [("record.read", pid)]


def test_record_contains_no_judgement_fields(client: Any, db: psycopg.Connection[Any]) -> None:
    """The record carries values as printed and nothing derived from them."""
    banned = ("flag", "abnormal", "range", "severity", "score", "trend", "risk", "status")
    record = _record(client, patient_id(db, "DEV-0003"))
    keys = {k for d in record["documents"] for v in d["values"] for k in v} | {
        k for d in record["documents"] for k in d
    }
    assert not [k for k in keys if any(b in k for b in banned)]
