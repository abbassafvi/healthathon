from datetime import timedelta
from typing import Any

import psycopg
import pytest

from healthathon import clinic_time
from tests.helpers import patient_id, verify_audit_chain

TODAY = clinic_time.today()
WEEK_FROM, WEEK_TO = TODAY - timedelta(days=9), TODAY - timedelta(days=3)
DAY = (WEEK_FROM + timedelta(days=1)).isoformat()


def _form(**over: Any) -> dict[str, Any]:
    return {
        "client_capture_id": "cap-00000001",
        "week_from": WEEK_FROM.isoformat(),
        "week_to": WEEK_TO.isoformat(),
        "language": "hi",
        "ticks": [],
        "glucose": [],
        "answers": [],
    } | over


def _reading(**over: Any) -> dict[str, Any]:
    return (
        {"date": DAY, "time": None, "value_text": "150", "context": "random"}
        | {"insulin_units": None}
        | over
    )


def _post(client: Any, pid: str, form: dict[str, Any]) -> Any:
    return client.post(f"/api/patients/{pid}/paper-form", json=form)


def _week(client: Any, pid: str) -> Any:
    q = f"?from={WEEK_FROM.isoformat()}&to={WEEK_TO.isoformat()}"
    return client.get(f"/api/patients/{pid}/entries{q}").json()


def _free_cell(client: Any, pid: str) -> tuple[str, str]:
    page = _week(client, pid)
    taken = {
        (e["regimen_item"]["id"], e["tick_date"])
        for e in page["entries"]
        if e["kind"] == "medication_tick"
    }
    for item in page["regimen_items"]:
        for n in range(7):
            day = (WEEK_FROM + timedelta(days=n)).isoformat()
            if (item["id"], day) not in taken:
                return item["id"], day
    raise AssertionError("no free cell in the seed")


@pytest.fixture
def pid(db: psycopg.Connection[Any]) -> str:
    return patient_id(db, "DEV-0001")


def test_stores_entries_as_written_marked_paper_form(client: Any, pid: str) -> None:
    item, day = _free_cell(client, pid)
    res = _post(client, pid, _form(
        ticks=[{"regimen_item_id": item, "date": day, "ticked": False}],
        glucose=[_reading(time="07:15", value_text=" 142 ", context="fasting")],
        answers=[{"date": DAY, "question_key": "felt_unwell_today", "answer_text": " नहीं "}],
    ))  # fmt: skip
    assert res.status_code == 200, res.text
    assert res.json() == {"created": 3, "duplicate": False}

    page = _week(client, pid)
    mine = [e for e in page["entries"] if e["recorded_at"][:10] == TODAY.isoformat()]
    assert len(mine) == 3
    assert all(e["channel"] == "paper_form" and e["entered_by"] == "clinic_staff" for e in mine)
    reading = next(e for e in mine if e["kind"] == "glucose_reading")
    assert reading["value_text"] == "142"
    assert reading["occurred_at"].startswith(f"{DAY}T07:15:00")
    answer = next(e for e in mine if e["kind"] == "survey_answer")
    assert answer["answer_text"] == "नहीं" and answer["language"] == "hi"
    assert answer["set"] == "daily"
    tick = next(e for e in mine if e["kind"] == "medication_tick")
    assert (tick["regimen_item"]["id"], tick["tick_date"], tick["ticked"]) == (item, day, False)


def test_a_form_is_saved_once_per_capture_id(client: Any, pid: str) -> None:
    form = _form(glucose=[_reading()])
    assert _post(client, pid, form).json() == {"created": 1, "duplicate": False}
    assert _post(client, pid, form).json() == {"created": 1, "duplicate": True}
    page = _week(client, pid)
    assert len([e for e in page["entries"] if e["recorded_at"][:10] == TODAY.isoformat()]) == 1


def test_refuses_a_tick_for_a_day_already_recorded(client: Any, pid: str) -> None:
    page = _week(client, pid)
    taken = next(e for e in page["entries"] if e["kind"] == "medication_tick")
    res = _post(client, pid, _form(
        ticks=[{"regimen_item_id": taken["regimen_item"]["id"], "date": taken["tick_date"],
                "ticked": True}],
    ))  # fmt: skip
    assert res.status_code == 409


def test_a_refused_form_stores_nothing(client: Any, pid: str) -> None:
    page = _week(client, pid)
    taken = next(e for e in page["entries"] if e["kind"] == "medication_tick")
    before = len(page["entries"])
    res = _post(client, pid, _form(
        glucose=[_reading()],
        ticks=[{"regimen_item_id": taken["regimen_item"]["id"], "date": taken["tick_date"],
                "ticked": True}],
    ))  # fmt: skip
    assert res.status_code == 409
    assert len(_week(client, pid)["entries"]) == before


BAD: list[tuple[str, dict[str, Any]]] = [
    ("a reading without context", {"glucose": [_reading(context="soon")]}),
    ("a reading that is not a number", {"glucose": [_reading(value_text="high")]}),
    ("a reading outside the week", {"glucose": [_reading(date=TODAY.isoformat())]}),
    ("a bad time", {"glucose": [_reading(time="7pm")]}),
    ("an empty answer", {"answers": [
        {"date": DAY, "question_key": "felt_unwell_today", "answer_text": "  "}]}),
    ("an unknown question", {"answers": [
        {"date": DAY, "question_key": "made_up", "answer_text": "yes"}]}),
    ("a backwards week", {"week_from": WEEK_TO.isoformat(), "week_to": WEEK_FROM.isoformat()}),
    ("a week longer than seven days",
     {"week_from": (WEEK_FROM - timedelta(days=1)).isoformat()}),
    ("a bad capture id", {"client_capture_id": "x"}),
    ("an unknown language", {"language": "fr"}),
]  # fmt: skip


@pytest.mark.parametrize(("name", "over"), BAD, ids=[b[0] for b in BAD])
def test_rejects(client: Any, pid: str, name: str, over: dict[str, Any]) -> None:
    assert _post(client, pid, _form(**over)).status_code == 422, name


def test_rejects_a_date_after_today(client: Any, pid: str) -> None:
    form = _form(
        week_from=(TODAY - timedelta(days=2)).isoformat(),
        week_to=(TODAY + timedelta(days=4)).isoformat(),
        glucose=[_reading(date=(TODAY + timedelta(days=1)).isoformat())],
    )
    assert _post(client, pid, form).status_code == 422


def test_rejects_ticks_the_checklist_does_not_allow(
    client: Any, db: psycopg.Connection[Any], pid: str
) -> None:
    item, day = _free_cell(client, pid)
    unknown = "00000000-0000-0000-0000-000000000000"
    for ticks in (
        [{"regimen_item_id": unknown, "date": day, "ticked": True}],
        [{"regimen_item_id": item, "date": day, "ticked": True}] * 2,
    ):
        assert _post(client, pid, _form(ticks=ticks)).status_code == 422
    # Another patient's medicine.
    other = patient_id(db, "DEV-0003")
    theirs = _form(ticks=[{"regimen_item_id": item, "date": day, "ticked": True}])
    assert _post(client, other, theirs).status_code == 422
    # A day before the checklist was activated.
    early = (TODAY - timedelta(days=24)).isoformat()
    form = _form(
        week_from=(TODAY - timedelta(days=25)).isoformat(),
        week_to=(TODAY - timedelta(days=19)).isoformat(),
        ticks=[{"regimen_item_id": item, "date": early, "ticked": True}],
    )
    assert _post(client, pid, form).status_code == 422


def test_any_number_is_accepted_as_written(client: Any, pid: str) -> None:
    res = _post(client, pid, _form(glucose=[_reading(value_text="1410")]))
    assert res.status_code == 200


def test_unknown_patient_is_404(client: Any) -> None:
    res = _post(client, "00000000-0000-0000-0000-000000000000", _form())
    assert res.status_code == 404


def test_entering_a_form_is_audited(client: Any, db: psycopg.Connection[Any], pid: str) -> None:
    _post(client, pid, _form(glucose=[_reading()]))
    rows = verify_audit_chain(db)
    assert [r["action"] for r in rows] == ["paper_form.enter"]
    assert rows[0]["new_value"]["readings"] == 1
    assert rows[0]["actor_role"] == "clinician"
