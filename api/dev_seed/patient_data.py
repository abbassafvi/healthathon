"""
Prescriptions, questions and four weeks of patient-reported entries for the
stand-in seed. All fictional. Entries are drawn from a fixed seed per patient,
so every run writes the same pattern relative to today.
"""

import hashlib
import random
from datetime import date, time, timedelta
from pathlib import Path
from typing import Any
from uuid import UUID

import psycopg

from dev_seed.pages import RxLine, draw_meal, draw_prescription
from healthathon import clinic_time

DOCTOR = "Dr. Kavita Rao, MD (fictional)"
CLINIC = "Diabetes Clinic, Lucknow (fictional)"
DAYS = 28

# (registration_no, key, days ago written, activated, lines)
REGIMENS: list[tuple[str, str, int, bool, list[RxLine]]] = [
    ("DEV-0001", "a", 19, True, [
        RxLine("Tab. Metformin", "500 mg", "1-0-1"),
        RxLine("Tab. Glimepiride", "1 mg", "1-0-0"),
        RxLine("Tab. Atorvastatin", "10 mg", "0-0-1"),
    ]),
    ("DEV-0001", "b", 1, False, [
        RxLine("Tab. Metformin", "1000 mg", "1-0-1"),
        RxLine("Tab. Glimepiride", "1 mg", "1-0-0"),
        RxLine("Tab. Atorvastatin", "10 mg", "0-0-1"),
        RxLine("Tab. Telmisartan", "40 mg", "1-0-0"),
    ]),
    ("DEV-0002", "a", 3, False, [
        RxLine("Tab. Sitagliptin", "100 mg", "1-0-0"),
        RxLine("Inj. Insulin Glargine", "14 units", "at bedtime"),
    ]),
    ("DEV-0003", "a", 30, True, [
        RxLine("Tab. Metformin", "500 mg", "1-1-1"),
        RxLine("Tab. Empagliflozin", "10 mg", "1-0-0"),
    ]),
]  # fmt: skip

# The Hindi and Urdu texts are unreviewed drafts, like the app's strings.
QUESTIONS = [
    ("felt_unwell_today", "Did you feel unwell today?",
     "क्या आज आपकी तबीयत ठीक नहीं थी?", "کیا آج آپ کی طبیعت ٹھیک نہیں تھی؟"),
    ("walk_days_week", "On how many days this week did you walk for 30 minutes?",
     "इस हफ़्ते कितने दिन आपने 30 मिनट सैर की?", "اس ہفتے کتنے دن آپ نے 30 منٹ سیر کی؟"),
    ("skipped_meal_week", "Did you skip a meal this week?",
     "क्या इस हफ़्ते आपने कोई खाना छोड़ा?", "کیا اس ہفتے آپ نے کوئی کھانا چھوڑا؟"),
]  # fmt: skip
SURVEY_KEYS = ("walk_days_week", "skipped_meal_week")

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


def seed_questions(conn: psycopg.Connection[Any], clinician: UUID) -> dict[str, UUID]:
    ids: dict[str, UUID] = {}
    for order, (key, en, hi, ur) in enumerate(QUESTIONS, start=1):
        qid = conn.execute(
            "INSERT INTO pat.question_bank_item (question_key, version, approved_by, approved_at,"
            " display_order) VALUES (%s, 1, %s, now(), %s) RETURNING id",
            (key, clinician, order),
        ).fetchone()["id"]
        for lang, text in (("en", en), ("hi", hi), ("ur", ur)):
            conn.execute(
                "INSERT INTO pat.question_text (question_id, language, text) VALUES (%s, %s, %s)",
                (qid, lang, text),
            )
        ids[key] = qid
    return ids


def seed_question_set(
    conn: psycopg.Connection[Any], patient: UUID, clinician: UUID, questions: dict[str, UUID]
) -> UUID:
    set_id: UUID = conn.execute(
        "INSERT INTO pat.patient_question_set (patient_id, chosen_by, chosen_at)"
        " VALUES (%s, %s, now() - interval '60 days') RETURNING id",
        (patient, clinician),
    ).fetchone()["id"]
    for key in SURVEY_KEYS:
        conn.execute(
            "INSERT INTO pat.patient_question_set_item (set_id, question_id) VALUES (%s, %s)",
            (set_id, questions[key]),
        )
    return set_id


def seed_regimens(
    conn: psycopg.Connection[Any],
    storage: Path,
    clinician: UUID,
    patients: dict[str, UUID],
    names: dict[str, str],
) -> dict[str, tuple[date, list[UUID]]]:
    """Write each prescription as a document, and return the active regimens' items."""
    active: dict[str, tuple[date, list[UUID]]] = {}
    today = clinic_time.today()
    for n, (reg, key, ago, activated, lines) in enumerate(REGIMENS):
        written = today - timedelta(days=ago)
        page_key = f"dev/pages/{reg}-rx-{key}.png"
        boxes = draw_prescription(
            storage / page_key,
            DOCTOR,
            CLINIC,
            names[reg],
            written.strftime("%d/%m/%y"),
            lines,
            seed=100 + n,
        )
        pid = patients[reg]
        captured = clinic_time.at(written, time(10, 0))
        intake = _insert(conn, "core.intake", {
            "client_capture_id": f"dev-seed-{reg}-rx-{key}", "channel": "desk_scan",
            "patient_id": pid, "captured_at": captured, "uploaded_by": clinician,
        })  # fmt: skip
        document = _insert(conn, "core.document", {
            "intake_id": intake, "patient_id": pid, "doc_type": "prescription",
            "issuing_source": DOCTOR, "document_date": written,
            "sha256": hashlib.sha256((storage / page_key).read_bytes()).digest(),
            "storage_key": page_key, "page_count": 1,
        })  # fmt: skip
        page = _insert(conn, "core.document_page", {
            "document_id": document, "page_no": 1, "storage_key": page_key,
            "width_px": 1240, "height_px": 1754,
        })  # fmt: skip
        at = clinic_time.at(written, time(10, 5)) if activated else None
        regimen = _insert(conn, "core.regimen", {
            "patient_id": pid, "source_document_id": document,
            "activated_by": clinician if activated else None, "activated_at": at,
        })  # fmt: skip
        items: list[UUID] = []
        for line, box in zip(lines, boxes, strict=True):
            prov = _insert(conn, "core.provenance", {
                "kind": "source_document", "document_id": document, "page_id": page,
                "bbox_x": box.x, "bbox_y": box.y, "bbox_w": box.w, "bbox_h": box.h,
            })  # fmt: skip
            items.append(_insert(conn, "core.regimen_item", {
                "regimen_id": regimen, "drug_text": line.drug, "dose_text": line.dose,
                "schedule_text": line.schedule, "provenance_id": prov,
                "confirmed_by": clinician if activated else None, "confirmed_at": at,
            }))  # fmt: skip
        if activated:
            active[reg] = (written, items)
    return active


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
            _insert(conn, "pat.meal_photo", {
                "entry_id": eid, "storage_key": key,
                "taken_at": clinic_time.at(day, time(13, 0)),
            }, returning=None)  # fmt: skip


def _insert(
    conn: psycopg.Connection[Any], table: str, row: dict[str, Any], returning: str | None = "id"
) -> Any:
    cols = ", ".join(row)
    vals = ", ".join(f"%({c})s" for c in row)
    sql = f"INSERT INTO {table} ({cols}) VALUES ({vals})"
    if returning is None:
        conn.execute(sql, row)  # type: ignore[call-overload]
        return None
    return conn.execute(f"{sql} RETURNING {returning}", row).fetchone()[returning]  # type: ignore[call-overload]
