from typing import Any

import psycopg

from tests.helpers import DEMO, decide, patient_id, queue_item_for


def _log(client: Any, **params: Any) -> dict[str, Any]:
    res = client.get("/api/audit-log", params=params)
    assert res.status_code == 200, res.text
    return dict(res.json())


def test_lists_the_chain_newest_first_and_checks_it_end_to_end(client: Any) -> None:
    decide(client, queue_item_for(client, "DEV-0001", "fpg")["id"], action="confirm")
    log = _log(client)
    ids = [e["id"] for e in log["entries"]]
    assert ids == sorted(ids, reverse=True)
    # Reading the log is itself an event, and the newest one.
    assert log["entries"][0]["action"] == "audit.read"
    assert log["chain"] == {"checked": len(ids), "intact": True, "first_broken_id": None}


def test_a_decision_names_who_made_it_the_patient_and_the_reason(
    client: Any, db: psycopg.Connection[Any]
) -> None:
    decide(client, queue_item_for(client, "DEV-0001", "fpg")["id"], action="confirm")
    [entry] = _log(client, kind="decision")["entries"]
    assert (entry["action"], entry["kind"], entry["actor_name"], entry["actor_role"]) == (
        "value.confirm", "decision", DEMO, "clinician",
    )  # fmt: skip
    assert entry["patient"]["id"] == patient_id(db, "DEV-0001")
    assert (entry["reason_code"], entry["decision_latency_ms"]) == ("region_illegible", 1200)


def test_a_patient_s_own_entry_has_no_clinic_user(client: Any, db: psycopg.Connection[Any]) -> None:
    pid = patient_id(db, "DEV-0001")
    client.post(
        f"/api/app/patients/{pid}/readings",
        json={"value_text": "131", "context": "fasting", "capture_id": "cap-log-0001"},
    )
    [entry] = _log(client, kind="patient")["entries"]
    assert (entry["action"], entry["actor_name"], entry["actor_role"]) == (
        "reading.record",
        None,
        None,
    )
    assert entry["patient"]["registration_no"] == "DEV-0001"


def test_reads_are_logged_and_listed_with_the_patient_read(
    client: Any, db: psycopg.Connection[Any]
) -> None:
    pid = patient_id(db, "DEV-0003")
    client.get(f"/api/patients/{pid}/record")
    reads = _log(client, kind="read")["entries"]
    assert [e["action"] for e in reads] == ["audit.read", "record.read"]
    assert reads[1]["patient"]["id"] == pid


def test_pages_go_back_through_older_events(client: Any) -> None:
    for analyte in ("hba1c",):
        decide(client, queue_item_for(client, "DEV-0002", analyte)["id"], action="confirm")
    for _ in range(4):
        client.get("/api/clinic-day")
    first = _log(client, limit=3)
    assert len(first["entries"]) == 3 and first["next_before"] == first["entries"][-1]["id"]
    second = _log(client, limit=3, before=first["next_before"])
    assert all(e["id"] < first["next_before"] for e in second["entries"])
    everything = _log(client, limit=200)
    assert everything["next_before"] is None


def test_a_changed_row_breaks_the_chain_at_that_row(
    client: Any, db: psycopg.Connection[Any]
) -> None:
    decide(client, queue_item_for(client, "DEV-0001", "fpg")["id"], action="confirm")
    client.get("/api/clinic-day")
    first = db.execute("SELECT min(id) AS id FROM audit.event").fetchone()["id"]
    # Nothing in the app updates an audit row; editing one here stands in for tampering.
    db.execute("UPDATE audit.event SET reason_code = 'edited' WHERE id = %s", (first,))
    chain = _log(client)["chain"]
    assert (chain["intact"], chain["first_broken_id"], chain["checked"]) == (False, first, 0)


def test_the_kind_and_paging_are_bounded(client: Any) -> None:
    assert client.get("/api/audit-log", params={"kind": "everything"}).status_code == 422
    assert client.get("/api/audit-log", params={"limit": 0}).status_code == 422
    assert client.get("/api/audit-log", params={"limit": 500}).status_code == 422
