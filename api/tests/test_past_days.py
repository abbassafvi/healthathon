from datetime import date, timedelta
from typing import Any

import psycopg

from healthathon import clinic_time
from tests.helpers import BANNED_KEYS, patient_id


def _days(client: Any, pid: str, **params: Any) -> dict[str, Any]:
    res = client.get(f"/api/app/patients/{pid}/days", params=params)
    assert res.status_code == 200, res.text
    return dict(res.json())


def test_earlier_days_come_newest_first_starting_yesterday(
    client: Any, db: psycopg.Connection[Any]
) -> None:
    page = _days(client, patient_id(db, "DEV-0001"))
    today = clinic_time.today()
    assert [d["date"] for d in page["days"]] == [
        (today - timedelta(days=n)).isoformat() for n in range(1, 8)
    ]
    assert page["next_before"] == (today - timedelta(days=7)).isoformat()


def test_a_day_holds_what_was_recorded_exactly_as_recorded(
    client: Any, db: psycopg.Connection[Any]
) -> None:
    pid = patient_id(db, "DEV-0001")
    yesterday = (clinic_time.today() - timedelta(days=1)).isoformat()
    day = _days(client, pid)["days"][0]
    entries = client.get(
        f"/api/patients/{pid}/entries", params={"from": yesterday, "to": yesterday}
    ).json()["entries"]
    ticks = {
        e["regimen_item"]["id"]: e["ticked"] for e in entries if e["kind"] == "medication_tick"
    }
    assert {t["item"]["id"]: t["ticked"] for t in day["ticks"]} == ticks
    assert sorted(r["value_text"] for r in day["readings"]) == sorted(
        e["value_text"] for e in entries if e["kind"] == "glucose_reading"
    )
    assert len(day["meals"]) == sum(e["kind"] == "meal_photo" for e in entries)
    assert len(day["answers"]) == sum(e["kind"] == "survey_answer" for e in entries)
    for answer in day["answers"]:
        assert set(answer["question"]["text"]) == {"en", "hi", "ur"}


def test_today_is_not_an_earlier_day(client: Any, db: psycopg.Connection[Any]) -> None:
    pid = patient_id(db, "DEV-0001")
    client.post(
        f"/api/app/patients/{pid}/readings",
        json={"value_text": "131", "context": "fasting", "capture_id": "cap-days-0001"},
    )
    page = _days(client, pid)
    assert clinic_time.today().isoformat() not in [d["date"] for d in page["days"]]
    assert all(r["value_text"] != "131" or d["date"] != clinic_time.today().isoformat()
               for d in page["days"] for r in d["readings"])  # fmt: skip


def test_paging_goes_back_to_the_first_entry_and_stops(
    client: Any, db: psycopg.Connection[Any]
) -> None:
    pid = patient_id(db, "DEV-0001")
    seen: list[str] = []
    before: str | None = None
    for _ in range(10):
        page = _days(client, pid, **({"before": before} if before else {}))
        seen += [d["date"] for d in page["days"]]
        before = page["next_before"]
        if before is None:
            break
    assert before is None
    assert seen == sorted(seen, reverse=True) and len(seen) == len(set(seen))
    first = db.execute(
        "SELECT min(COALESCE(t.tick_date, (e.occurred_at AT TIME ZONE 'Asia/Kolkata')::date)) AS d"
        " FROM pat.entry e LEFT JOIN pat.medication_tick t ON t.entry_id = e.id"
        " WHERE e.patient_id = %s",
        (pid,),
    ).fetchone()["d"]
    assert date.fromisoformat(seen[-1]) == first


def test_a_patient_with_nothing_recorded_has_no_earlier_days(
    client: Any, db: psycopg.Connection[Any]
) -> None:
    pid = patient_id(db, "DEV-0004")
    db.execute("DELETE FROM pat.entry WHERE patient_id = %s", (pid,))
    assert _days(client, pid) == {"days": [], "next_before": None}


def test_the_count_is_bounded_and_unknown_patients_are_404(
    client: Any, db: psycopg.Connection[Any]
) -> None:
    pid = patient_id(db, "DEV-0001")
    assert len(_days(client, pid, count=3)["days"]) == 3
    assert client.get(f"/api/app/patients/{pid}/days", params={"count": 0}).status_code == 422
    assert client.get(f"/api/app/patients/{pid}/days", params={"count": 40}).status_code == 422
    missing = "00000000-0000-0000-0000-000000000000"
    assert client.get(f"/api/app/patients/{missing}/days").status_code == 404


def test_nothing_is_added_up_or_judged(client: Any, db: psycopg.Connection[Any]) -> None:
    def keys(o: Any) -> set[str]:
        if isinstance(o, dict):
            return set(o) | {k for v in o.values() for k in keys(v)}
        if isinstance(o, list):
            return {k for v in o for k in keys(v)}
        return set()

    found = keys(_days(client, patient_id(db, "DEV-0001")))
    assert not [k for k in found if any(b in k for b in BANNED_KEYS)]
    assert not found & {"count", "sum", "mean", "percent"}
