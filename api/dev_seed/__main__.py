"""
Stand-in seed for frontend work, until the seed script from Track A lands.

Writes four fictional patients, one generated lab report each, extracted
values with provenance pointing at real boxes on those pages, a few
confirm queue items with their crops, prescriptions and their regimens,
the question bank, and four weeks of patient-reported entries. Usage:

    uv run python -m dev_seed            # refuses if already seeded
    uv run python -m dev_seed --reset    # truncates every table first (dev only)
"""

import argparse
import hashlib
import sys
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from dev_seed.checks import seed_checks
from dev_seed.entries import seed_entries
from dev_seed.pages import Row, cut_crop, draw_lab_report
from dev_seed.patient_data import (
    seed_contacts,
    seed_question_set,
    seed_questions,
    seed_regimens,
    seed_visits,
)
from healthathon.config import get_settings

ANALYTES = [
    ("hba1c", "HbA1c", "%", 1),
    ("fpg", "Fasting plasma glucose", "mg/dL", 0),
    ("ppbg", "Post-prandial glucose", "mg/dL", 0),
    ("creatinine", "Serum creatinine", "mg/dL", 2),
    ("egfr", "eGFR", "mL/min/1.73m2", 0),
    ("ldl", "LDL cholesterol", "mg/dL", 0),
    ("tg", "Triglycerides", "mg/dL", 0),
    ("uacr", "Urine albumin/creatinine ratio", "mg/g", 1),
]

# (registration_no, name, year_of_birth, sex, language)
PATIENTS = [
    ("DEV-0001", "Asha Verma", 1968, "F", "hi"),
    ("DEV-0002", "Imran Qureshi", 1975, "M", "ur"),
    ("DEV-0003", "Meera Pillai", 1959, "F", "en"),
    ("DEV-0004", "Rakesh Yadav", 1981, "M", "hi"),
]

# Per patient: (analyte_code, value_text, degrade, queue reason, candidates)
REPORTS: list[list[tuple[str, str, str | None, str | None, list[str]]]] = [
    [
        ("hba1c", "8.4", None, None, []),
        ("fpg", "162", "blur", "region_illegible", []),
        ("creatinine", "0.92", None, None, []),
        ("ldl", "118", None, None, []),
    ],
    [
        ("hba1c", "7.1", "smudge", "readers_disagree", ["7.1", "7.7"]),
        ("ppbg", "214", None, None, []),
        ("egfr", "88", None, None, []),
        ("tg", "190", None, None, []),
    ],
    [
        ("hba1c", "9.0", None, None, []),
        ("fpg", "1410", None, "outside_assay_range", ["141", "1410"]),
        ("uacr", "42.5", None, None, []),
        ("creatinine", "1.31", "blur", "region_illegible", []),
    ],
    [
        ("hba1c", "6.8", None, None, []),
        ("ldl", "96", "smudge", "readers_disagree", ["96", "86"]),
        ("tg", "152", None, None, []),
    ],
]

TABLES = ("core", "pat", "proj", "audit", "eval")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--reset", action="store_true", help="truncate every table first")
    args = ap.parse_args()
    settings = get_settings()
    with psycopg.connect(settings.database_url, row_factory=dict_row) as conn:
        if args.reset:
            _truncate(conn)
        elif conn.execute("SELECT 1 FROM core.patient LIMIT 1").fetchone():
            print("Already seeded. Pass --reset to start again.", file=sys.stderr)
            return 1
        seed(conn, settings.storage_dir, settings.stub_user_email)
    print("Seeded 4 patients. Storage:", settings.storage_dir)
    return 0


def _truncate(conn: psycopg.Connection[Any]) -> None:
    rows = conn.execute(
        "SELECT format('%%I.%%I', schemaname, tablename) AS t FROM pg_tables"
        " WHERE schemaname = ANY(%s)",
        (list(TABLES),),
    ).fetchall()
    conn.execute("TRUNCATE " + ", ".join(r["t"] for r in rows) + " RESTART IDENTITY CASCADE")


def seed(conn: psycopg.Connection[Any], storage: Path, user_email: str) -> None:
    clinician = conn.execute(
        "INSERT INTO core.clinic_user (full_name, role, email)"
        " VALUES ('Dr. Demo Clinician', 'clinician', %s) RETURNING id",
        (user_email,),
    ).fetchone()["id"]
    conn.cursor().executemany(
        "INSERT INTO core.analyte (code, display_name, canonical_unit, decimal_places)"
        " VALUES (%s, %s, %s, %s) ON CONFLICT DO NOTHING",
        ANALYTES,
    )
    names = {code: (name, unit) for code, name, unit, _ in ANALYTES}
    now = datetime.now(UTC)
    questions = seed_questions(conn, clinician)
    patients: dict[str, Any] = {}
    question_sets: dict[str, Any] = {}

    for i, ((reg, name, yob, sex, lang), report) in enumerate(zip(PATIENTS, REPORTS, strict=True)):
        patient = conn.execute(
            "INSERT INTO core.patient (registration_no, full_name, year_of_birth, sex,"
            " preferred_language) VALUES (%s, %s, %s, %s, %s) RETURNING id",
            (reg, name, yob, sex, lang),
        ).fetchone()["id"]
        patients[reg] = patient
        question_sets[reg] = seed_question_set(conn, patient, clinician, questions)
        report_date = date.today() - timedelta(days=9 + 4 * i)
        page_key = f"dev/pages/{reg}-lab.png"
        page_path = storage / page_key
        rows = [Row(names[c][0], v, names[c][1], deg) for c, v, deg, _, _ in report]
        boxes = draw_lab_report(
            page_path,
            "Sunrise Diagnostics (fictional)",
            name,
            report_date.strftime("%d/%m/%Y"),
            rows,
            seed=i,
        )

        intake = conn.execute(
            "INSERT INTO core.intake (client_capture_id, channel, patient_id, captured_at,"
            " uploaded_by) VALUES (%s, 'desk_scan', %s, %s, %s) RETURNING id",
            (f"dev-seed-{reg}", patient, now - timedelta(hours=6 - i), clinician),
        ).fetchone()["id"]
        document = conn.execute(
            "INSERT INTO core.document (intake_id, patient_id, doc_type, issuing_source,"
            " document_date, sha256, storage_key, page_count) VALUES"
            " (%s, %s, 'lab_report', 'Sunrise Diagnostics (fictional)', %s, %s, %s, 1)"
            " RETURNING id",
            (
                intake,
                patient,
                report_date,
                hashlib.sha256(page_path.read_bytes()).digest(),
                page_key,
            ),
        ).fetchone()["id"]
        page = conn.execute(
            "INSERT INTO core.document_page (document_id, page_no, storage_key, width_px,"
            " height_px) VALUES (%s, 1, %s, 1240, 1754) RETURNING id",
            (document, page_key),
        ).fetchone()["id"]
        run = conn.execute(
            "INSERT INTO core.extraction_run (document_id, reader_name, reader_version,"
            " profile_version, code_commit, finished_at)"
            " VALUES (%s, 'dev-seed', '0', 'dev', 'dev-seed', now()) RETURNING id",
            (document,),
        ).fetchone()["id"]

        for j, ((code, value, _deg, reason, cands), box) in enumerate(
            zip(report, boxes, strict=True)
        ):
            crop_key = f"dev/crops/{reg}-{code}.png" if reason else None
            if crop_key:
                cut_crop(page_path, box, storage / crop_key)
            prov = conn.execute(
                "INSERT INTO core.provenance (kind, document_id, page_id, bbox_x, bbox_y,"
                " bbox_w, bbox_h, crop_sha256) VALUES ('source_document', %s, %s, %s, %s,"
                " %s, %s, %s) RETURNING id",
                (
                    document,
                    page,
                    box.x,
                    box.y,
                    box.w,
                    box.h,
                    hashlib.sha256((storage / crop_key).read_bytes()).digest()
                    if crop_key
                    else None,
                ),
            ).fetchone()["id"]
            value_id = conn.execute(
                "INSERT INTO core.extracted_value (patient_id, document_id,"
                " extraction_run_id, provenance_id, analyte_code, value_text, unit_text,"
                " observed_at, state) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)"
                " RETURNING id",
                (
                    patient,
                    document,
                    run,
                    prov,
                    code,
                    value,
                    names[code][1],
                    report_date,
                    "needs_confirm" if reason else "accepted",
                ),
            ).fetchone()["id"]
            seed_checks(conn, value_id, reason)
            if reason:
                conn.execute(
                    "INSERT INTO core.confirm_queue_item (extracted_value_id, reason,"
                    " crop_storage_key, candidate_readings, created_at)"
                    " VALUES (%s, %s, %s, %s, %s)",
                    (
                        value_id,
                        reason,
                        crop_key,
                        Jsonb([{"value_text": c, "unit_text": names[code][1]} for c in cands]),
                        now - timedelta(minutes=50 - 7 * i, seconds=-j),
                    ),
                )

    full_names = {reg: name for reg, name, *_ in PATIENTS}
    active = seed_regimens(conn, storage, clinician, patients, full_names)
    seed_entries(conn, storage, patients, active, questions, question_sets)
    seed_visits(conn, clinician, patients)
    seed_contacts(conn, clinician, patients)


if __name__ == "__main__":
    sys.exit(main())
