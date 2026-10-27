from datetime import timedelta
from typing import Any

import psycopg

from healthathon import clinic_time
from tests.helpers import BANNED_KEYS, patient_id, verify_audit_chain

TODAY = clinic_time.today()
FROM = (TODAY - timedelta(days=27)).isoformat()
RANGE = f"?from={FROM}&to={TODAY.isoformat()}"


def _page(client: Any, db: psycopg.Connection[Any], reg: str, query: str = RANGE) -> Any:
    res = client.get(f"/api/patients/{patient_id(db, reg)}/entries{query}")
    assert res.status_code == 200, res.text
    return res.json()


def _kind(page: Any, kind: str) -> list[dict[str, Any]]:
    return [e for e in page["entries"] if e["kind"] == kind]


def test_four_weeks_of_entries_in_time_order_inside_the_range(
    client: Any, db: psycopg.Connection[Any]
) -> None:
    page = _page(client, db, "DEV-0001")
    assert page["from"] == FROM and page["to"] == TODAY.isoformat()
    assert len(page["entries"]) > 60
    times = [e["occurred_at"] for e in page["entries"]]
    assert times == sorted(times)
    assert all(FROM <= t[:10] <= TODAY.isoformat() for t in times)


def test_times_are_clinic_wall_time_with_their_offset(
    client: Any, db: psycopg.Connection[Any]
) -> None:
    for e in _page(client, db, "DEV-0001")["entries"]:
        assert e["occurred_at"].endswith("+05:30")
        assert e["recorded_at"].endswith("+05:30")
    ticks = _kind(_page(client, db, "DEV-0001"), "medication_tick")
    # Seeded ticks are made at 21:xx on the day they are for.
    assert all(t["occurred_at"][:10] == t["tick_date"] for t in ticks)


def test_every_glucose_reading_has_its_context(client: Any, db: psycopg.Connection[Any]) -> None:
    readings = _kind(_page(client, db, "DEV-0001"), "glucose_reading")
    assert len(readings) > 10
    contexts = {"fasting", "before_meal", "after_meal", "bedtime", "overnight", "random"}
    for g in readings:
        assert g["context"] in contexts
        assert g["value_text"].isdigit()


def test_ticks_start_at_activation_with_gaps_and_unticked_days(
    client: Any, db: psycopg.Connection[Any]
) -> None:
    page = _page(client, db, "DEV-0001")
    ticks = _kind(page, "medication_tick")
    activated = (TODAY - timedelta(days=19)).isoformat()
    assert all(t["tick_date"] >= activated for t in ticks)
    assert any(not t["ticked"] for t in ticks)
    days = {t["tick_date"] for t in ticks}
    assert len(ticks) < len(days) * 3  # some item-days have no entry at all
    # Only the activated prescription; the one awaiting review is not a checklist.
    assert [i["drug_text"] for i in page["regimen_items"]] == [
        "Tab. Metformin",
        "Tab. Glimepiride",
        "Tab. Atorvastatin",
    ]
    assert [i["dose_text"] for i in page["regimen_items"]][0] == "500 mg"
    assert {i["active_from"] for i in page["regimen_items"]} == {activated}
    assert {i["active_until"] for i in page["regimen_items"]} == {None}


def test_answers_are_kept_as_given_with_the_question_in_both_languages(
    client: Any, db: psycopg.Connection[Any]
) -> None:
    answers = _kind(_page(client, db, "DEV-0001"), "survey_answer")
    daily = next(a for a in answers if a["set"] == "daily")
    assert daily["question_text"] == "Did you feel unwell today?"
    assert daily["question_text_shown"] == "क्या आज आपकी तबीयत ठीक नहीं थी?"
    assert daily["language"] == "hi"
    survey = [a for a in answers if a["set"] == "survey"]
    assert {a["question_key"] for a in survey} == {"walk_days_week", "skipped_meal_week"}


def test_each_entry_says_who_entered_it_and_through_which_route(
    client: Any, db: psycopg.Connection[Any]
) -> None:
    one = _page(client, db, "DEV-0001")["entries"]
    assert any(
        e["entered_by"] == "caregiver" and e["caregiver_name"] == "Priya Verma (daughter)"
        for e in one
    )
    assert any(e["channel"] == "paper_form" and e["entered_by"] == "clinic_staff" for e in one)
    assert all(e["caregiver_name"] is None for e in one if e["entered_by"] != "caregiver")
    two = _page(client, db, "DEV-0002")
    assert any(e["channel"] == "sms" for e in two["entries"])
    assert not _kind(two, "medication_tick")  # no activated checklist
    assert two["regimen_items"] == []


def test_meal_photographs_arrive_only_through_the_app_and_are_served(
    client: Any, db: psycopg.Connection[Any]
) -> None:
    for reg in ("DEV-0001", "DEV-0002", "DEV-0003"):
        meals = _kind(_page(client, db, reg), "meal_photo")
        assert meals
        assert all(m["channel"] == "patient_app" for m in meals)
        assert all(m["entered_by"] != "clinic_staff" for m in meals)
    res = client.get(meals[0]["photo_url"])
    assert res.status_code == 200
    assert res.content.startswith(b"\x89PNG")


def test_a_patient_who_recorded_nothing_gets_an_empty_page(
    client: Any, db: psycopg.Connection[Any]
) -> None:
    page = _page(client, db, "DEV-0004")
    assert page["entries"] == [] and page["regimen_items"] == []


def test_the_range_narrows_and_defaults_to_four_weeks(
    client: Any, db: psycopg.Connection[Any]
) -> None:
    day = (TODAY - timedelta(days=3)).isoformat()
    page = _page(client, db, "DEV-0001", f"?from={day}&to={day}")
    assert page["entries"]
    for e in page["entries"]:
        assert (e.get("tick_date") or e["occurred_at"][:10]) == day
    assert _page(client, db, "DEV-0001", "")["from"] == FROM


def test_bad_ranges_and_unknown_patients_are_refused(
    client: Any, db: psycopg.Connection[Any]
) -> None:
    pid = patient_id(db, "DEV-0001")
    later, earlier = TODAY.isoformat(), (TODAY - timedelta(days=5)).isoformat()
    assert client.get(f"/api/patients/{pid}/entries?from={later}&to={earlier}").status_code == 422
    assert client.get(f"/api/patients/{pid}/entries?from=yesterday").status_code == 422
    long_ago = (TODAY - timedelta(days=400)).isoformat()
    assert client.get(f"/api/patients/{pid}/entries?from={long_ago}").status_code == 422
    missing = "00000000-0000-0000-0000-000000000000"
    assert client.get(f"/api/patients/{missing}/entries").status_code == 404


def test_entries_carry_no_judgement_fields(client: Any, db: psycopg.Connection[Any]) -> None:
    page = _page(client, db, "DEV-0001")
    keys = {k for e in page["entries"] for k in e} | set(page)
    keys |= {k for i in page["regimen_items"] for k in i}
    assert not [k for k in keys if any(b in k for b in BANNED_KEYS)]


def test_reading_entries_is_audited(client: Any, db: psycopg.Connection[Any]) -> None:
    pid = patient_id(db, "DEV-0003")
    _page(client, db, "DEV-0003")
    rows = verify_audit_chain(db)
    assert [(r["action"], str(r["entity_id"])) for r in rows] == [("entries.read", pid)]


def test_paper_form_questions_are_the_daily_question_in_english(client: Any) -> None:
    res = client.get("/api/paper-form/questions")
    assert res.json() == [{"key": "felt_unwell_today", "text": "Did you feel unwell today?"}]
