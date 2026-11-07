"""
Turning one agent reading into rows.

A laboratory value is written with its provenance, then its five checks,
and lands in the record only if every check it ran passed. Anything else
is written in `needs_confirm` and queued with the crop a person will be
shown. A prescription line is never written as a value: it becomes a
regimen item awaiting a clinician, because a drug name has no analyte to
hang a value on.
"""

from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal
from pathlib import Path
from uuid import UUID

from psycopg import Connection
from psycopg.rows import DictRow
from psycopg.types.json import Jsonb

from healthathon.config import Settings
from healthathon.uploads import checks as check_lib
from healthathon.uploads.agent import Crop, DocumentReading
from healthathon.uploads.detector import Box
from healthathon.uploads.writer import (
    StoredPage,
    analyte_units,
    reportable_ranges,
    same_day_values,
    write_provenance,
)


@dataclass
class Outcome:
    document_id: UUID
    values_in_record: int = 0
    queued: dict[str, int] = field(default_factory=dict)
    regimen_id: UUID | None = None
    # box index -> the deterministic layer's score for the reading there
    confidence: dict[int, float] = field(default_factory=dict)
    # Prescription lines the checks settled, and lines waiting for a person.
    lines_accepted: int = 0
    lines_for_a_person: int = 0

    @property
    def sent_to_queue(self) -> list[dict[str, object]]:
        return [{"reason": r, "count": c} for r, c in sorted(self.queued.items())]


def _line_reread(reads: int, box: int, disagreed: set[int]) -> check_lib.CheckOutcome:
    if reads <= 1:
        return check_lib.CheckOutcome("reread_agreement", "not_applicable")
    if box in disagreed:
        return check_lib.CheckOutcome(
            "reread_agreement", "fail", signal=0.0, detail={"why": "readers_disagree"}
        )
    return check_lib.CheckOutcome("reread_agreement", "pass", signal=1.0)


def _record_checks(
    conn: Connection[DictRow],
    outcomes: list[check_lib.CheckOutcome],
    *,
    value_id: UUID | None = None,
    item_id: UUID | None = None,
) -> None:
    """One row per check, against a laboratory value or a prescription line."""
    for check in outcomes:
        conn.execute(
            "INSERT INTO core.check_result (extracted_value_id, regimen_item_id, check_code,"
            " outcome, signal, detail) VALUES (%s, %s, %s, %s, %s, %s)",
            (
                value_id,
                item_id,
                check.code,
                check.outcome,
                check.signal,
                Jsonb(check.detail) if check.detail else None,
            ),
        )


def persist_lab_report(
    conn: Connection[DictRow],
    page: StoredPage,
    patient_id: UUID,
    reading: DocumentReading,
    boxes: list[Box],
    crops: dict[int, Crop],
    settings: Settings,
    other_reads: dict[int, list[str]] | None = None,
    with_orders: bool = True,
) -> Outcome:
    units = analyte_units(conn)
    ranges = reportable_ranges(conn)
    outcome = Outcome(document_id=page.document_id)
    observed = reading.document_date
    scores: dict[int, float] = {}

    unclear = set(reading.ungrounded)
    for value in reading.values:
        crop = crops.get(value.box_index)
        crop_path: Path | None = crop.path if crop else None
        provenance = write_provenance(conn, page, boxes[value.box_index], crop_path)

        reportable = ranges.get(value.analyte_code)
        results = [
            check_lib.grounding(value.box_index not in unclear),
            check_lib.legibility(crop_path, settings.legibility_min_sharpness)
            if crop_path
            else check_lib.CheckOutcome("legibility", "not_applicable"),
            check_lib.well_formed(
                value.value_text,
                value.unit_text,
                units.get(value.analyte_code, set()),
                observed,
                (Decimal(str(reportable[0])), Decimal(str(reportable[1]))) if reportable else None,
            ),
            check_lib.reread_agreement(
                value.value_text, (other_reads or {}).get(value.box_index, [])
            ),
            check_lib.cross_document(
                value.value_text, same_day_values(conn, patient_id, value.analyte_code, observed)
            ),
        ]
        # The deterministic layer's verdict: a score from the checks the
        # reading passed, against the threshold. The reason still names
        # the check that failed, so a person is told what went wrong
        # rather than only being shown a number.
        score = check_lib.confidence(results)
        reason = check_lib.first_failure(results) if score < settings.confidence_threshold else None
        scores[value.box_index] = score
        row = conn.execute(
            "INSERT INTO core.extracted_value (patient_id, document_id, extraction_run_id,"
            " provenance_id, analyte_code, value_text, unit_text, observed_at, state)"
            " VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id",
            (
                patient_id,
                page.document_id,
                page.run_id,
                provenance,
                value.analyte_code,
                value.value_text,
                value.unit_text,
                observed,
                "needs_confirm" if reason else "accepted",
            ),
        ).fetchone()
        assert row is not None
        value_id = UUID(str(row["id"]))
        _record_checks(conn, results, value_id=value_id)

        if reason and crop is not None:
            conn.execute(
                "INSERT INTO core.confirm_queue_item (extracted_value_id, reason,"
                " crop_storage_key, candidate_readings) VALUES (%s, %s, %s, %s)",
                (
                    value_id,
                    reason,
                    crop.storage_key,
                    Jsonb([{"value_text": value.value_text, "unit_text": value.unit_text}]),
                ),
            )
            outcome.queued[reason] = outcome.queued.get(reason, 0) + 1
        elif reason is None:
            outcome.values_in_record += 1

    if with_orders:
        _persist_orders(conn, page, patient_id, reading, boxes, crops, observed)
    outcome.confidence = scores
    return outcome


def _persist_orders(
    conn: Connection[DictRow],
    page: StoredPage,
    patient_id: UUID,
    reading: DocumentReading,
    boxes: list[Box],
    crops: dict[int, Crop],
    observed: date | None,
) -> None:
    """
    A test the page asks for. Its own box, so the order can be pointed at
    on the page like anything else.
    """
    for order in reading.orders:
        crop = crops.get(order.box_index)
        provenance = write_provenance(
            conn, page, boxes[order.box_index], crop.path if crop else None
        )
        conn.execute(
            "INSERT INTO core.test_order (patient_id, analyte_code, ordered_on,"
            " source_document_id, provenance_id) VALUES (%s, %s, %s, %s, %s)",
            (
                patient_id,
                order.analyte_code,
                observed or date.today(),
                page.document_id,
                provenance,
            ),
        )


def persist_prescription(
    conn: Connection[DictRow],
    page: StoredPage,
    patient_id: UUID,
    reading: DocumentReading,
    boxes: list[Box],
    crops: dict[int, Crop],
    settings: Settings,
    reads: int = 1,
    disagreed: set[int] | None = None,
) -> Outcome:
    """
    One regimen per prescription, one line per medicine, each with the
    box it was read from and the checks it passed.

    A line that passes every check it ran is accepted here. A line that
    does not waits for a clinician, who sees it beside its crop. Nothing
    reaches a patient's checklist either way until the regimen is
    activated.
    """
    unclear = set(reading.ungrounded)
    outcome = Outcome(document_id=page.document_id)
    # A prescription often advises tests as well as prescribing, and a
    # consultation card often writes a result down beside it. Both are
    # recorded whether or not any medicine line could be read.
    _persist_orders(conn, page, patient_id, reading, boxes, crops, reading.document_date)
    values = persist_lab_report(
        conn, page, patient_id, reading, boxes, crops, settings, with_orders=False
    )
    outcome.values_in_record = values.values_in_record
    outcome.queued = values.queued
    if not reading.lines:
        return outcome

    row = conn.execute(
        "INSERT INTO core.regimen (patient_id, source_document_id) VALUES (%s, %s) RETURNING id",
        (patient_id, page.document_id),
    ).fetchone()
    assert row is not None
    regimen_id = UUID(str(row["id"]))

    for line in reading.lines:
        crop = crops.get(line.box_index)
        crop_path: Path | None = crop.path if crop else None
        provenance = write_provenance(conn, page, boxes[line.box_index], crop_path)
        item = conn.execute(
            "INSERT INTO core.regimen_item (regimen_id, drug_text, dose_text, schedule_text,"
            " provenance_id) VALUES (%s, %s, %s, %s, %s) RETURNING id",
            (regimen_id, line.drug_text, line.dose_text, line.schedule_text, provenance),
        ).fetchone()
        assert item is not None
        item_id = UUID(str(item["id"]))

        # Four of the five apply to a medicine. There is no second
        # document to compare a prescription line against.
        results = [
            check_lib.grounding(line.box_index not in unclear),
            check_lib.legibility(crop_path, settings.legibility_min_sharpness)
            if crop_path
            else check_lib.CheckOutcome("legibility", "not_applicable"),
            check_lib.dose_well_formed(line.dose_text, line.schedule_text),
            # A line the passes read differently is still written, and
            # fails here. That is what puts it in front of a clinician
            # instead of dropping a medicine that is on the page.
            _line_reread(reads, line.box_index, disagreed or set()),
            check_lib.CheckOutcome("cross_document", "not_applicable"),
        ]
        _record_checks(conn, results, item_id=item_id)

        score = check_lib.confidence(results)
        outcome.confidence[line.box_index] = score
        if score >= settings.confidence_threshold:
            conn.execute(
                "UPDATE core.regimen_item SET accepted_at = now() WHERE id = %s", (item_id,)
            )
            outcome.lines_accepted += 1
        else:
            outcome.lines_for_a_person += 1

    outcome.regimen_id = regimen_id
    return outcome
