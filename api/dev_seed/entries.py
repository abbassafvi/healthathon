"""
Four weeks of patient-reported entries for the stand-in seed, up to
yesterday, drawn from a fixed seed per patient so every run writes the
same pattern relative to today. All fictional.
"""

import random
from datetime import date, time, timedelta
from pathlib import Path
from typing import Any
from uuid import UUID

import psycopg

from dev_seed.pages import draw_meal
from dev_seed.patient_data import DAYS, SURVEY_KEYS, _insert
from healthathon import clinic_time

ANSWERS: dict[str, dict[str, list[str]]] = {
    "felt_unwell_today": {
        "en": ["No", "No", "No", "A little dizzy in the morning"],
        "hi": ["नहीं", "नहीं", "नहीं", "सुबह थोड़ा चक्कर आया"],
        "ur": ["نہیں", "نہیں", "نہیں", "صبح تھوڑا چکر آیا"],
    },
    "walk_days_week": {lang: ["4", "2", "5"] for lang in ("en", "hi", "ur")},
    "skipped_meal_week": {
        "en": ["No", "Yes, twice"],
        "hi": ["नहीं", "हाँ, दो बार"],
        "ur": ["نہیں", "ہاں، دو بار"],
    },
}

# registration_no: (language, caregiver, readings per day, low, high, sends SMS)
PROFILES = {
    "DEV-0001": ("hi", ("Priya Verma", "daughter"), 1.4, 118, 214, False),
    "DEV-0002": ("ur", None, 0.8, 104, 188, True),
    "DEV-0003": ("en", None, 1.1, 96, 176, False),
}
CONTEXTS = ["fasting", "after_meal", "before_meal", "bedtime", "fasting", "after_meal"]
HOUR = {"fasting": 7, "bedtime": 22, "before_meal": 13, "after_meal": 15}


def seed_entries(
    conn: psycopg.Connection[Any],
    storage: Path,
    patients: dict[str, UUID],
    active: dict[str, tuple[date, list[UUID]]],
    questions: dict[str, UUID],
    question_sets: dict[str, UUID],
) -> None:
    """
    Four weeks up to yesterday. Today is left empty, so the patient app
    starts a demonstration with nothing recorded yet.
    """
    for reg in PROFILES:
        _seed_patient(conn, storage, reg, patients[reg], active.get(reg), questions,
                      question_sets[reg])  # fmt: skip


def _seed_patient(
    conn: psycopg.Connection[Any],
    storage: Path,
    reg: str,
    pid: UUID,
    regimen: tuple[date, list[UUID]] | None,
    questions: dict[str, UUID],
    set_id: UUID,
) -> None:
    lang, carer, per_day, low, high, sms = PROFILES[reg]
    today = clinic_time.today()
    rng = random.Random(reg)
    caregiver = None
    if carer:
        caregiver = _insert(conn, "core.caregiver", {
            "patient_id": pid, "full_name": carer[0], "relationship": carer[1],
        })  # fmt: skip
    n = 0

    def entry(kind: str, day: date, hh: int, mm: int, who: tuple[str, str]) -> UUID:
        nonlocal n
        n += 1
        occurred = clinic_time.at(day, time(hh, mm))
        return _insert(conn, "pat.entry", {
            "patient_id": pid, "kind": kind, "channel": who[0], "entered_by": who[1],
            "caregiver_id": caregiver if who[1] == "caregiver" else None,
            "language": lang, "client_capture_id": f"dev-seed-{reg}-{n}",
            "occurred_at": occurred, "recorded_at": occurred + timedelta(minutes=5),
        })  # fmt: skip

    def who() -> tuple[str, str]:
        x = rng.random()
        if caregiver and x < 0.15:
            return ("patient_app", "caregiver")
        if x < 0.25:
            return ("paper_form", "clinic_staff")
        if sms and x < 0.45:
            return ("sms", "patient")
        return ("patient_app", "patient")

    for back in range(DAYS, 0, -1):
        day = today - timedelta(days=back)
        if regimen and day >= regimen[0]:
            source = who()
            for item in regimen[1]:
                x = rng.random()
                if x < 0.08:
                    continue  # no entry: a gap, never filled in
                eid = entry("medication_tick", day, 21, rng.randint(0, 49), source)
                _insert(conn, "pat.medication_tick", {
                    "entry_id": eid, "regimen_item_id": item, "tick_date": day,
                    "ticked": x >= 0.15,
                }, returning=None)  # fmt: skip

        for _ in range(int(per_day + rng.random() - 0.3)):
            context = rng.choice(CONTEXTS)
            value = round(low + rng.random() * (high - low))
            eid = entry("glucose_reading", day, HOUR[context], rng.randint(0, 58), who())
            _insert(conn, "pat.glucose_reading", {
                "entry_id": eid, "value_text": str(value), "context": context,
                "insulin_units": 14 if reg == "DEV-0002" and context == "bedtime" else None,
            }, returning=None)  # fmt: skip

        keys = ["felt_unwell_today"] if rng.random() < 0.8 else []
        if day.weekday() == 6:
            keys += list(SURVEY_KEYS)
        for key in keys:
            eid = entry("survey_answer", day, 20, rng.randint(0, 58), who())
            _insert(conn, "pat.survey_answer", {
                "entry_id": eid, "question_id": questions[key],
                "answer_text": rng.choice(ANSWERS[key][lang]),
                "set_id": set_id if key in SURVEY_KEYS else None,
            }, returning=None)  # fmt: skip

        if rng.random() < 0.3:
            # A photograph only arrives through the app.
            by = "caregiver" if caregiver and rng.random() < 0.2 else "patient"
            eid = entry("meal_photo", day, 13, rng.randint(0, 58), ("patient_app", by))
            key = f"dev/meals/{reg}-{n}.png"
            draw_meal(storage / key, key)
            # Lunch, and now and then the calories the patient knew from a label.
            _insert(conn, "pat.meal_photo", {
                "entry_id": eid, "storage_key": key,
                "taken_at": clinic_time.at(day, time(13, 0)), "meal": "lunch",
                "calories_text": "420" if n % 4 == 0 else None,
            }, returning=None)  # fmt: skip
