from typing import Any
from uuid import UUID

import psycopg

# Which of the five checks a queue reason stands for. A stand-in for what the
# reading pipeline will record: a value with no reason passed every check.
REASON_CHECK = {
    "no_region_on_page": "grounding",
    "readers_disagree": "reread_agreement",
    "conflicting_documents": "cross_document",
    "unknown_unit": "well_formed",
    "outside_assay_range": "well_formed",
    "implausible_date": "well_formed",
    "region_illegible": "legibility",
    "handwritten": "legibility",
    "script_not_read": "legibility",
}
CHECKS = ("grounding", "reread_agreement", "cross_document", "well_formed", "legibility")


def seed_checks(conn: psycopg.Connection[Any], value_id: UUID, reason: str | None) -> None:
    """The five checks for one seeded value. Each patient has one report, so
    the cross-document check has nothing to compare with."""
    failed = REASON_CHECK.get(reason) if reason else None
    for code in CHECKS:
        outcome = (
            "fail" if code == failed else "not_applicable" if code == "cross_document" else "pass"
        )
        conn.execute(
            "INSERT INTO core.check_result (extracted_value_id, check_code, outcome)"
            " VALUES (%s, %s, %s)",
            (value_id, code, outcome),
        )
