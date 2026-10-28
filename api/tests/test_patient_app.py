from datetime import datetime, timedelta
from typing import Any

import psycopg
import pytest

from healthathon import clinic_time
from tests.helpers import BANNED_KEYS, patient_id, verify_audit_chain

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
MISSING = "00000000-0000-0000-0000-000000000000"


@pytest.fixture
def pid(db: psycopg.Connection[Any]) -> str:
    return patient_id(db, "DEV-0001")


def _today(client: Any, pid: str) -> Any:
    res = client.get(f"/api/app/patients/{pid}/today")
    assert res.status_code == 200, res.text
    return res.json()


def _tick(client: Any, pid: str, item: str, ticked: bool | None, cap: str) -> Any:
    return client.put(
        f"/api/app/patients/{pid}/ticks/{item}", json={"ticked": ticked, "capture_id": cap}
    )


def _reading(client: Any, pid: str, cap: str = "cap-reading-1", **over: Any) -> Any:
    body = {"value_text": "132", "context": "fasting", "capture_id": cap} | over
    return client.post(f"/api/app/patients/{pid}/readings", json=body)


def test_a_phone_is_given_no_list_of_patients(client: Any) -> None:
    # A phone signs in by its own number; it never sees who else is enrolled.
    assert client.get("/api/app/patients").status_code in (404, 405)


def test_today_starts_empty_with_the_checklist_as_printed(client: Any, pid: str) -> None:
    t = _today(client, pid)
    assert t["date"] == clinic_time.today().isoformat()
    assert t["patient"]["full_name"] == "Asha Verma"
    assert [(i["drug_text"], i["dose_text"], i["schedule_text"]) for i in t["items"]] == [
        ("Tab. Metformin", "500 mg", "1-0-1"),
        ("Tab. Glimepiride", "1 mg", "1-0-0"),
        ("Tab. Atorvastatin", "10 mg", "0-0-1"),
    ]
    assert t["ticks"] == {} and t["readings"] == [] and t["meals"] == []
    assert t["answer"] is None
    assert t["question"]["key"] == "felt_unwell_today"
    assert set(t["question"]["text"]) == {"en", "hi", "ur"}
    assert t["survey"] == {"open": True, "done": False}


def test_a_prescription_awaiting_review_is_not_a_checklist(
    client: Any, db: psycopg.Connection[Any]
) -> None:
    assert _today(client, patient_id(db, "DEV-0002"))["items"] == []


def test_today_returns_nothing_interpretive(client: Any, pid: str) -> None:
    _reading(client, pid)
    t = _today(client, pid)
    keys = set(t) | {k for r in t["readings"] for k in r} | set(t["survey"])
    assert not [k for k in keys if any(b in k for b in BANNED_KEYS)]


def test_a_tick_is_recorded_changed_and_cleared(
    client: Any, db: psycopg.Connection[Any], pid: str
) -> None:
    item = _today(client, pid)["items"][0]["id"]
    assert _tick(client, pid, item, True, "cap-tick-0001").status_code == 204
    assert _tick(client, pid, item, True, "cap-tick-0001").status_code == 204  # a retry
    assert _today(client, pid)["ticks"] == {item: True}
    n = db.execute("SELECT count(*) AS n FROM pat.medication_tick").fetchone()["n"]

    assert _tick(client, pid, item, False, "cap-tick-0002").status_code == 204
    assert _today(client, pid)["ticks"] == {item: False}
    assert db.execute("SELECT count(*) AS n FROM pat.medication_tick").fetchone()["n"] == n

    assert _tick(client, pid, item, None, "cap-tick-0003").status_code == 204
    assert _today(client, pid)["ticks"] == {}
    actions = [r["action"] for r in verify_audit_chain(db)]
    assert actions == ["tick.record", "tick.change", "tick.clear"]
    assert all(r["actor_id"] is None for r in verify_audit_chain(db))


def test_an_app_tick_reaches_the_clinician_as_the_patients(
    client: Any, db: psycopg.Connection[Any], pid: str
) -> None:
    item = _today(client, pid)["items"][1]["id"]
    _tick(client, pid, item, True, "cap-tick-0001")
    day = clinic_time.today().isoformat()
    page = client.get(f"/api/patients/{pid}/entries?from={day}&to={day}").json()
    [tick] = [e for e in page["entries"] if e["kind"] == "medication_tick"]
    assert (tick["channel"], tick["entered_by"], tick["language"]) == (
        "patient_app",
        "patient",
        "hi",
    )
    assert tick["regimen_item"]["id"] == item and tick["ticked"] is True


def test_a_tick_off_the_checklist_is_refused(
    client: Any, db: psycopg.Connection[Any], pid: str
) -> None:
    pending = db.execute(
        "SELECT ri.id FROM core.regimen_item ri JOIN core.regimen r ON r.id = ri.regimen_id"
        " WHERE r.patient_id = %s AND r.activated_at IS NULL LIMIT 1",
        (pid,),
    ).fetchone()["id"]
    assert _tick(client, pid, str(pending), True, "cap-tick-0001").status_code == 404
    assert _tick(client, pid, MISSING, True, "cap-tick-0001").status_code == 404
    other = patient_id(db, "DEV-0003")
    item = _today(client, pid)["items"][0]["id"]
    assert _tick(client, other, item, True, "cap-tick-0001").status_code == 404


def test_the_app_cannot_change_a_tick_the_clinic_recorded(
    client: Any, db: psycopg.Connection[Any], pid: str
) -> None:
    item = _today(client, pid)["items"][0]["id"]
    today = clinic_time.today().isoformat()
    res = client.post(f"/api/patients/{pid}/paper-form", json={
        "client_capture_id": "cap-paper-01", "week_from": today, "week_to": today,
        "language": "hi", "ticks": [{"regimen_item_id": item, "date": today, "ticked": False}],
        "glucose": [], "answers": [],
    })  # fmt: skip
    assert res.status_code == 200, res.text
    assert _tick(client, pid, item, True, "cap-tick-0001").status_code == 409
    assert _tick(client, pid, item, None, "cap-tick-0002").status_code == 409
    assert _today(client, pid)["ticks"] == {item: False}


def test_a_reading_is_stored_as_typed_with_its_context(client: Any, pid: str) -> None:
    res = _reading(client, pid, value_text=" 132 ")
    assert res.status_code == 200, res.text
    assert res.json()["value_text"] == "132" and res.json()["context"] == "fasting"
    again = _reading(client, pid, value_text=" 132 ")  # a retry of the same capture
    assert again.json()["id"] == res.json()["id"]
    assert [r["id"] for r in _today(client, pid)["readings"]] == [res.json()["id"]]


@pytest.mark.parametrize(
    "over",
    [
        {"context": None},
        {"context": "soon"},
        {"value_text": "high"},
        {"value_text": ""},
        {"value_text": "-5"},
        {"capture_id": "short"},
        {"language": "fr"},
    ],
)
def test_a_reading_without_a_number_or_context_is_refused(
    client: Any, pid: str, over: dict[str, Any]
) -> None:
    assert _reading(client, pid, **over).status_code == 422


def test_a_capture_id_cannot_be_reused_for_another_write(client: Any, pid: str) -> None:
    item = _today(client, pid)["items"][0]["id"]
    _tick(client, pid, item, True, "cap-shared-01")
    assert _reading(client, pid, cap="cap-shared-01").status_code == 409


def test_the_days_answer_is_kept_in_the_language_shown(client: Any, pid: str) -> None:
    body = {"question_key": "felt_unwell_today", "answer_text": " ठीक हूँ ",
            "capture_id": "cap-answer-1", "language": "en"}  # fmt: skip
    assert client.post(f"/api/app/patients/{pid}/answers", json=body).status_code == 204
    assert client.post(f"/api/app/patients/{pid}/answers", json=body).status_code == 204
    assert _today(client, pid)["answer"] == "ठीक हूँ"
    day = clinic_time.today().isoformat()
    page = client.get(f"/api/patients/{pid}/entries?from={day}&to={day}").json()
    [a] = [e for e in page["entries"] if e["kind"] == "survey_answer"]
    assert (a["set"], a["language"], a["question_text_shown"]) == (
        "daily",
        "en",
        "Did you feel unwell today?",
    )
    for bad in ({"answer_text": "  "}, {"question_key": "walk_days_week"}):
        res = client.post(f"/api/app/patients/{pid}/answers", json=body | bad)
        assert res.status_code == 422


def test_the_survey_needs_every_answer_and_is_saved_once(
    client: Any, db: psycopg.Connection[Any], pid: str
) -> None:
    qs = client.get(f"/api/app/patients/{pid}/survey").json()
    assert [q["key"] for q in qs] == ["walk_days_week", "skipped_meal_week"]
    assert qs[0]["text"]["en"] == "On how many days this week did you walk for 30 minutes?"
    url = f"/api/app/patients/{pid}/survey"
    full = {"walk_days_week": "3", "skipped_meal_week": "No"}
    for answers in (
        {"walk_days_week": "3"},
        full | {"made_up": "x"},
        full | {"walk_days_week": " "},
    ):
        res = client.post(url, json={"answers": answers, "capture_id": "cap-survey-1"})
        assert res.status_code == 422
    for _ in range(2):
        res = client.post(url, json={"answers": full, "capture_id": "cap-survey-1"})
        assert res.status_code == 204
    assert _today(client, pid)["survey"] == {"open": True, "done": True}
    n = db.execute(
        "SELECT count(*) AS n FROM pat.entry WHERE client_capture_id LIKE 'cap-survey-1:%'"
    ).fetchone()["n"]
    assert n == 2


def test_a_meal_photograph_is_stored_and_served_unchanged(client: Any, pid: str) -> None:
    url = f"/api/app/patients/{pid}/meals?capture_id=cap-meal-0001&meal=lunch"
    res = client.post(url, content=PNG, headers={"Content-Type": "image/png"})
    assert res.status_code == 200, res.text
    meal = res.json()
    assert client.get(meal["uri"]).content == PNG
    assert client.post(url, content=PNG, headers={"Content-Type": "image/png"}).json() == meal
    assert [m["id"] for m in _today(client, pid)["meals"]] == [meal["id"]]
    # The meal as chosen, and nothing estimated: calories only if typed.
    assert set(meal) == {"id", "uri", "occurred_at", "meal", "calories_text"}
    assert (meal["meal"], meal["calories_text"]) == ("lunch", None)


def test_a_meal_happened_when_its_photograph_was_taken(client: Any, pid: str) -> None:
    taken = (clinic_time.now() - timedelta(hours=5)).replace(microsecond=0)
    url = (f"/api/app/patients/{pid}/meals?capture_id=cap-meal-0003&meal=breakfast"
           f"&taken_at={taken.isoformat().replace('+', '%2B')}&calories=350")  # fmt: skip
    meal = client.post(url, content=PNG).json()
    assert datetime.fromisoformat(meal["occurred_at"]) == taken
    assert (meal["meal"], meal["calories_text"]) == ("breakfast", "350")
    entries = client.get(f"/api/patients/{pid}/entries?from={taken.date()}&to={taken.date()}")
    shown = next(e for e in entries.json()["entries"] if e["kind"] == "meal_photo")
    assert (shown["meal"], shown["calories_text"], shown["occurred_at"]) == (
        "breakfast", "350", meal["occurred_at"])  # fmt: skip


def test_a_time_without_an_offset_is_the_clinics_wall_time(client: Any, pid: str) -> None:
    wall = (clinic_time.now() - timedelta(hours=1)).replace(microsecond=0, tzinfo=None)
    url = (f"/api/app/patients/{pid}/meals?capture_id=cap-meal-0004&meal=snack"
           f"&taken_at={wall.isoformat()}")  # fmt: skip
    meal = client.post(url, content=PNG).json()
    assert datetime.fromisoformat(meal["occurred_at"]).replace(tzinfo=None) == wall


def test_only_a_photograph_with_its_meal_is_accepted(client: Any, pid: str) -> None:
    url = f"/api/app/patients/{pid}/meals?capture_id=cap-meal-0002&meal=dinner"
    assert client.post(url, content=b"not an image").status_code == 415
    big = PNG + b"\x00" * (8 * 1024 * 1024)
    assert client.post(url, content=big).status_code == 413
    assert client.post(f"/api/app/patients/{pid}/meals", content=PNG).status_code == 422
    no_meal = f"/api/app/patients/{pid}/meals?capture_id=cap-meal-0005"
    assert client.post(no_meal, content=PNG).status_code == 422
    assert client.post(f"{no_meal}&meal=supper", content=PNG).status_code == 422
    for calories in ("about 300", "12345", "-5", "3.5"):
        assert client.post(f"{url}&calories={calories}", content=PNG).status_code == 422, calories


def test_a_meal_photograph_cannot_be_dated_ahead_or_long_ago(client: Any, pid: str) -> None:
    for i, when in enumerate((timedelta(hours=1), -timedelta(days=4))):
        t = (clinic_time.now() + when).isoformat().replace("+", "%2B")
        url = f"/api/app/patients/{pid}/meals?capture_id=cap-meal-01{i}&meal=lunch&taken_at={t}"
        assert client.post(url, content=PNG).status_code == 422


def test_unknown_patients_are_404(client: Any) -> None:
    base = f"/api/app/patients/{MISSING}"
    assert client.get(f"{base}/today").status_code == 404
    assert client.get(f"{base}/survey").status_code == 404
    assert _reading(client, MISSING).status_code == 404
    assert _tick(client, MISSING, MISSING, True, "cap-tick-0001").status_code == 404
