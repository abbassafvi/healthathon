"""
Prescriptions, test orders, questions and visits for the stand-in seed.
All fictional.
"""

import hashlib
from datetime import date, time, timedelta
from pathlib import Path
from typing import Any
from uuid import UUID

import psycopg

from dev_seed.pages import RxLine, draw_prescription
from healthathon import clinic_time, phones

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

# Tests advised on a prescription: (analyte code, as written).
ORDERS: dict[tuple[str, str], tuple[tuple[str, str], ...]] = {
    ("DEV-0001", "a"): (("hba1c", "HbA1c"), ("uacr", "Urine ACR")),
    ("DEV-0003", "a"): (("creatinine", "S. Creatinine"),),
}

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
            advice=tuple(text for _, text in ORDERS.get((reg, key), ())),
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
        for line, box in zip(lines, boxes[: len(lines)], strict=True):
            prov = _insert(conn, "core.provenance", {
                "kind": "source_document", "document_id": document, "page_id": page,
                "bbox_x": box.x, "bbox_y": box.y, "bbox_w": box.w, "bbox_h": box.h,
            })  # fmt: skip
            items.append(_insert(conn, "core.regimen_item", {
                "regimen_id": regimen, "drug_text": line.drug, "dose_text": line.dose,
                "schedule_text": line.schedule, "provenance_id": prov,
                "confirmed_by": clinician if activated else None, "confirmed_at": at,
            }))  # fmt: skip
        for (code, _), box in zip(ORDERS.get((reg, key), ()), boxes[len(lines) :], strict=True):
            prov = _insert(conn, "core.provenance", {
                "kind": "source_document", "document_id": document, "page_id": page,
                "bbox_x": box.x, "bbox_y": box.y, "bbox_w": box.w, "bbox_h": box.h,
            })  # fmt: skip
            # Matched to the patient's report for that test, if the record has one.
            match = conn.execute(
                "SELECT id FROM core.extracted_value WHERE patient_id = %s AND analyte_code = %s"
                " AND superseded_by IS NULL ORDER BY created_at DESC LIMIT 1",
                (pid, code),
            ).fetchone()
            _insert(conn, "core.test_order", {
                "patient_id": pid, "analyte_code": code, "ordered_on": written,
                "source_document_id": document, "provenance_id": prov,
                "matched_value_id": match["id"] if match else None,
            })  # fmt: skip
        if activated:
            active[reg] = (written, items)
    return active


def seed_visits(conn: psycopg.Connection[Any], clinician: UUID, patients: dict[str, UUID]) -> None:
    """A visit that took place four weeks ago, and one booked for today, for every patient."""
    today = clinic_time.today()
    for pid in patients.values():
        before = clinic_time.at(today - timedelta(days=29), time(11, 0))
        _insert(conn, "proj.visit", {
            "patient_id": pid, "scheduled_for": before, "started_at": before,
            "clinician_id": clinician,
        })  # fmt: skip
        _insert(conn, "proj.visit", {
            "patient_id": pid, "scheduled_for": clinic_time.at(today, time(11, 30)),
            "clinician_id": clinician,
        })  # fmt: skip


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


# Fictional numbers: Indian mobile numbers start 6 to 9, so none of these
# can belong to anyone. Rakesh Yadav has not agreed to SMS.
PHONES = {f"DEV-000{n}": f"+91 55500 0000{n}" for n in range(1, 5)}
SMS_CONSENT = ("DEV-0001", "DEV-0002", "DEV-0003")


def seed_contacts(
    conn: psycopg.Connection[Any], clinician: UUID, patients: dict[str, UUID]
) -> None:
    """A phone per patient, stored only as its HMAC, and who has agreed to SMS."""
    for reg, number in PHONES.items():
        normalised = phones.normalise(number)
        assert normalised is not None
        _insert(conn, "core.patient_phone", {
            "patient_id": patients[reg], "phone_hmac": phones.phone_hmac(normalised),
            "phone_last4": normalised[-4:], "is_primary": True,
        })  # fmt: skip
        if reg in SMS_CONSENT:
            lang = conn.execute(
                "SELECT preferred_language FROM core.patient WHERE id = %s", (patients[reg],)
            ).fetchone()["preferred_language"]
            _insert(conn, "core.consent", {
                "patient_id": patients[reg], "item": "sms", "granted": True,
                "language": lang, "captured_by": clinician,
            })  # fmt: skip
