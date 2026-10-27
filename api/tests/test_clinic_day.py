from datetime import timedelta
from typing import Any

import psycopg

from healthathon import clinic_time
from tests.helpers import BANNED_KEYS, decide, patient_id, queue_item_for, verify_audit_chain


def _day(client: Any, **params: str) -> dict[str, Any]:
    res = client.get("/api/clinic-day", params=params)
    assert res.status_code == 200, res.text
    return dict(res.json())


def _visit(day: dict[str, Any], registration_no: str) -> dict[str, Any]:
    return next(v for v in day["visits"] if v["patient"]["registration_no"] == registration_no)


def test_lists_today_s_visits_in_time_order_and_by_nothing_else(client: Any) -> None:
    day = _day(client)
    assert day["date"] == clinic_time.today().isoformat()
    times = [v["scheduled_for"] for v in day["visits"]]
    assert len(times) == 4 and times == sorted(times)
    assert all(t.startswith(clinic_time.today().isoformat()) for t in times)


def test_the_period_and_counts_match_the_visit_page(
    client: Any, db: psycopg.Connection[Any]
) -> None:
    pid = patient_id(db, "DEV-0001")
    visit = _visit(_day(client), "DEV-0001")
    page = client.get(f"/api/patients/{pid}/visit").json()
    assert visit["period_from"] == page["period"]["from"]
    assert visit["previous_visit"] == page["period"]["previous_visit"]

    entries = client.get(
        f"/api/patients/{pid}/entries",
        params={"from": page["period"]["from"], "to": page["period"]["to"]},
    ).json()["entries"]
    kinds = [e["kind"] for e in entries]
    assert visit["entries"]["medicine_ticks"] == kinds.count("medication_tick")
    assert visit["entries"]["glucose_readings"] == kinds.count("glucose_reading")
    assert visit["entries"]["answers"] == kinds.count("survey_answer")
    assert visit["entries"]["meal_photos"] == kinds.count("meal_photo")
    assert visit["entries"]["last_at"] == max(e["occurred_at"] for e in entries)

    record = client.get(f"/api/patients/{pid}/record").json()["documents"]
    in_period = [
        d for d in record if page["period"]["from"] <= d["document_date"] <= page["period"]["to"]
    ]
    assert visit["documents"]["lab_reports"] == sum(
        d["doc_type"] == "lab_report" for d in in_period
    )


def test_values_waiting_for_a_person_drop_as_they_are_settled(client: Any) -> None:
    before = _visit(_day(client), "DEV-0001")["waiting"]["values"]
    open_items = [
        i
        for i in client.get("/api/confirm-queue").json()["items"]
        if i["patient"]["registration_no"] == "DEV-0001"
    ]
    assert before == len(open_items) > 0
    decide(client, queue_item_for(client, "DEV-0001", open_items[0]["analyte_code"])["id"],
           action="confirm")  # fmt: skip
    assert _visit(_day(client), "DEV-0001")["waiting"]["values"] == before - 1


def test_prescription_lines_waiting_lead_to_their_review(
    client: Any, db: psycopg.Connection[Any]
) -> None:
    visit = _visit(_day(client), "DEV-0002")
    checklist = client.get(f"/api/patients/{patient_id(db, 'DEV-0002')}/checklist").json()
    [waiting] = checklist["awaiting_review"]
    assert visit["waiting"]["prescription_lines"] == waiting["item_count"]
    assert visit["waiting"]["review_regimen_id"] == waiting["regimen_id"]
    assert visit["checklist"] == {"active_since": None, "medicines": 0}


def test_an_active_checklist_is_stated_with_its_date_and_size(
    client: Any, db: psycopg.Connection[Any]
) -> None:
    visit = _visit(_day(client), "DEV-0001")
    active = client.get(f"/api/patients/{patient_id(db, 'DEV-0001')}/checklist").json()["active"]
    assert visit["checklist"] == {
        "active_since": active["activated_at"][:10],
        "medicines": len(active["items"]),
    }


def test_another_day_has_its_own_visits(client: Any, db: psycopg.Connection[Any]) -> None:
    tomorrow = (clinic_time.today() + timedelta(days=1)).isoformat()
    assert _day(client, date=tomorrow) == {"date": tomorrow, "visits": []}
    past = (clinic_time.today() - timedelta(days=29)).isoformat()
    assert len(_day(client, date=past)["visits"]) == 4
    assert client.get("/api/clinic-day", params={"date": "not-a-day"}).status_code == 422


def test_a_patient_who_left_the_clinic_is_not_listed(
    client: Any, db: psycopg.Connection[Any]
) -> None:
    db.execute("UPDATE core.patient SET exited_at = now() WHERE registration_no = 'DEV-0004'")
    regs = [v["patient"]["registration_no"] for v in _day(client)["visits"]]
    assert "DEV-0004" not in regs and len(regs) == 3


def test_reading_the_day_is_audited(client: Any, db: psycopg.Connection[Any]) -> None:
    _day(client)
    [event] = verify_audit_chain(db)
    assert event["action"] == "clinic_day.read"
    assert event["new_value"] == {"date": clinic_time.today().isoformat()}


def test_the_day_carries_no_judgement(client: Any) -> None:
    def keys(o: Any) -> set[str]:
        if isinstance(o, dict):
            return set(o) | {k for v in o.values() for k in keys(v)}
        if isinstance(o, list):
            return {k for v in o for k in keys(v)}
        return set()

    found = keys(_day(client))
    assert not [k for k in found if any(b in k for b in BANNED_KEYS)]
