from typing import Any

import psycopg
import pytest

from healthathon import clinic_time
from tests.helpers import patient_id, verify_audit_chain

MISSING = "00000000-0000-0000-0000-000000000000"


def _checklist(client: Any, pid: str) -> Any:
    res = client.get(f"/api/patients/{pid}/checklist")
    assert res.status_code == 200, res.text
    return res.json()


def _pending(client: Any, db: psycopg.Connection[Any], reg: str) -> Any:
    """The review of the patient's prescription that is waiting for review."""
    [waiting] = _checklist(client, patient_id(db, reg))["awaiting_review"]
    res = client.get(f"/api/regimens/{waiting['regimen_id']}/review")
    assert res.status_code == 200, res.text
    return res.json()


def _confirm(client: Any, item: str, **body: Any) -> Any:
    return client.post(
        f"/api/regimen-items/{item}/confirm", json={"decision_latency_ms": 900} | body
    )


def _activate(client: Any, regimen: str) -> Any:
    return client.post(f"/api/regimens/{regimen}/activate")


def test_returns_the_active_checklist_and_the_prescription_awaiting_review(
    client: Any, db: psycopg.Connection[Any]
) -> None:
    body = _checklist(client, patient_id(db, "DEV-0001"))
    active = body["active"]
    assert [i["drug_text"] for i in active["items"]] == [
        "Tab. Metformin",
        "Tab. Glimepiride",
        "Tab. Atorvastatin",
    ]
    assert active["activated_by_name"] == "Dr. Demo Clinician"
    assert active["source_document"]["issuing_source"] == "Dr. Kavita Rao, MD (fictional)"
    assert all(i["confirmed_by_name"] == "Dr. Demo Clinician" for i in active["items"])
    [waiting] = body["awaiting_review"]
    assert (waiting["item_count"], waiting["confirmed_count"]) == (4, 0)


def test_a_patient_without_prescriptions_has_an_empty_checklist(
    client: Any, db: psycopg.Connection[Any]
) -> None:
    body = _checklist(client, patient_id(db, "DEV-0004"))
    assert body == {"active": None, "awaiting_review": []}


def test_unknown_patients_prescriptions_and_items_are_404(client: Any) -> None:
    assert client.get(f"/api/patients/{MISSING}/checklist").status_code == 404
    assert client.get(f"/api/regimens/{MISSING}/review").status_code == 404
    assert _confirm(client, MISSING).status_code == 404
    assert client.delete(f"/api/regimen-items/{MISSING}").status_code == 404
    assert _activate(client, MISSING).status_code == 404
    assert client.get(f"/api/regimen-items/{MISSING}/crop").status_code == 404


def test_a_review_shows_the_page_every_box_in_page_order_and_what_it_replaces(
    client: Any, db: psycopg.Connection[Any]
) -> None:
    review = _pending(client, db, "DEV-0001")
    assert review["patient"]["registration_no"] == "DEV-0001"
    assert (review["page"]["width_px"], review["page"]["height_px"]) == (1240, 1754)
    assert client.get(review["page"]["url"]).content.startswith(b"\x89PNG")
    ys = [i["box"]["y"] for i in review["items"]]
    assert ys == sorted(ys)
    assert all(0 < i["box"]["w"] <= 1 for i in review["items"])
    assert review["items"][3]["drug_text"] == "Tab. Telmisartan"
    assert review["replaces"]["item_count"] == 3
    assert review["activated_at"] is None
    assert _pending(client, db, "DEV-0002")["replaces"] is None


def test_every_item_has_a_crop_of_its_own_line(client: Any, db: psycopg.Connection[Any]) -> None:
    from io import BytesIO

    from PIL import Image

    items = _pending(client, db, "DEV-0001")["items"]
    sizes = []
    for item in items:
        res = client.get(item["crop_url"])
        assert res.status_code == 200
        with Image.open(BytesIO(res.content)) as img:
            sizes.append(img.size)
            assert img.size[0] < 1240 and img.size[1] < 300  # a line, not the page
    assert len(set(sizes)) > 1
    again = client.get(items[0]["crop_url"]).content
    assert again == client.get(items[0]["crop_url"]).content


def test_a_confirmation_needs_its_decision_latency(
    client: Any, db: psycopg.Connection[Any]
) -> None:
    item = _pending(client, db, "DEV-0001")["items"][0]["id"]
    assert client.post(f"/api/regimen-items/{item}/confirm", json={}).status_code == 422
    assert _confirm(client, item, decision_latency_ms=-1).status_code == 422


def test_a_correction_is_trimmed_audited_and_never_blank(
    client: Any, db: psycopg.Connection[Any]
) -> None:
    item = _pending(client, db, "DEV-0001")["items"][0]
    assert _confirm(client, item["id"], drug_text="   ").status_code == 422
    assert _confirm(client, item["id"], dose_text="").status_code == 422
    res = _confirm(
        client, item["id"], drug_text=" Tab. Metformin SR ", dose_text="1000 mg", schedule_text=" "
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert (body["drug_text"], body["dose_text"], body["schedule_text"]) == (
        "Tab. Metformin SR",
        "1000 mg",
        None,
    )
    assert body["confirmed_by_name"] == "Dr. Demo Clinician"
    [event] = verify_audit_chain(db)
    assert event["action"] == "regimen_item.correct"
    assert event["old_value"] == {
        "drug_text": "Tab. Metformin",
        "dose_text": "1000 mg",
        "schedule_text": "1-0-1",
    }
    assert event["new_value"]["decision_latency_ms"] == 900


def test_a_plain_confirmation_keeps_the_text_as_read(
    client: Any, db: psycopg.Connection[Any]
) -> None:
    item = _pending(client, db, "DEV-0001")["items"][1]
    body = _confirm(client, item["id"]).json()
    assert body["drug_text"] == item["drug_text"] and body["confirmed_at"]
    [event] = verify_audit_chain(db)
    assert event["action"] == "regimen_item.confirm"
    assert event["new_value"] == {"decision_latency_ms": 900}


def test_activation_waits_for_every_line_then_supersedes_the_old_checklist(
    client: Any, db: psycopg.Connection[Any]
) -> None:
    pid = patient_id(db, "DEV-0001")
    review = _pending(client, db, "DEV-0001")
    regimen = review["regimen_id"]
    assert _activate(client, regimen).status_code == 409
    for item in review["items"]:
        assert _confirm(client, item["id"]).status_code == 200
    res = _activate(client, regimen)
    assert res.status_code == 200, res.text
    assert res.json()["activated_at"].endswith("+05:30")

    body = _checklist(client, pid)
    assert body["active"]["id"] == regimen
    assert len(body["active"]["items"]) == 4
    assert body["awaiting_review"] == []
    # Once active, nothing about it changes.
    item = review["items"][0]["id"]
    assert _activate(client, regimen).status_code == 409
    assert _confirm(client, item).status_code == 409
    assert client.delete(f"/api/regimen-items/{item}").status_code == 409
    actions = [e["action"] for e in verify_audit_chain(db)]
    assert actions[-1] == "regimen.activate"


def test_the_patient_app_and_the_entries_follow_the_new_checklist(
    client: Any, db: psycopg.Connection[Any]
) -> None:
    pid = patient_id(db, "DEV-0001")
    review = _pending(client, db, "DEV-0001")
    for item in review["items"]:
        _confirm(client, item["id"])
    _activate(client, review["regimen_id"])
    today = client.get(f"/api/app/patients/{pid}/today").json()
    assert [i["dose_text"] for i in today["items"]] == ["1000 mg", "1 mg", "10 mg", "40 mg"]
    day = clinic_time.today().isoformat()
    spans = client.get(f"/api/patients/{pid}/entries?to={day}").json()["regimen_items"]
    assert len(spans) == 7  # the old three, now ended, and the new four
    assert sum(1 for s in spans if s["active_until"] == day) == 3
    assert sum(1 for s in spans if s["active_from"] == day and s["active_until"] is None) == 4


def test_a_line_that_is_not_a_medicine_can_be_removed_and_one_must_remain(
    client: Any, db: psycopg.Connection[Any]
) -> None:
    review = _pending(client, db, "DEV-0002")
    for item in review["items"]:
        assert client.delete(f"/api/regimen-items/{item['id']}").status_code == 204
    assert _activate(client, review["regimen_id"]).status_code == 409
    assert {e["action"] for e in verify_audit_chain(db)} == {"regimen_item.remove"}


@pytest.mark.parametrize("reg", ["DEV-0002"])
def test_a_first_checklist_activates_with_nothing_to_replace(
    client: Any, db: psycopg.Connection[Any], reg: str
) -> None:
    review = _pending(client, db, reg)
    for item in review["items"]:
        _confirm(client, item["id"])
    assert _activate(client, review["regimen_id"]).status_code == 200
    pid = patient_id(db, reg)
    assert len(client.get(f"/api/app/patients/{pid}/today").json()["items"]) == 2
