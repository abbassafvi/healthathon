from typing import Any, cast, get_args
from uuid import UUID

from fastapi import HTTPException
from psycopg import Connection
from psycopg.rows import DictRow

from healthathon import clinic_time, storage
from healthathon.audit import record_event
from healthathon.auth import CurrentUser
from healthathon.reading import repository as repo
from healthathon.reading.models import (
    Check,
    CheckCode,
    DocumentReading,
    ReaderRun,
    ReadingDocument,
    ReadingPage,
    ReadingPatient,
    ReadLine,
    ReadValue,
    Settled,
    ShownValue,
)
from healthathon.record.models import Box

# The five checks, always in this order, so every value reads the same way.
CHECK_ORDER: tuple[CheckCode, ...] = get_args(CheckCode)
_SETTLED = {
    "value.confirm": "confirmed",
    "value.correct": "corrected",
    "value.discard": "discarded",
}


def reading(conn: Connection[DictRow], user: CurrentUser, document_id: UUID) -> DocumentReading:
    """
    Everything the reader found on one document and what became of it.
    Answers, for one page, how much reached the record as fact and how
    much went to a person, and why.
    """
    doc = repo.document(conn, document_id)
    if doc is None:
        raise HTTPException(404, "No such document")
    rows = repo.read_values(conn, document_id)
    ids = [r["id"] for r in rows]
    shown = repo.renderable(conn, ids + [r["superseded_by"] for r in rows if r["superseded_by"]])
    checks = repo.checks(conn, ids)
    decisions = repo.decisions(conn, ids)
    run = repo.latest_run(conn, document_id)

    record_event(conn, user, "document.reading_read", "core.document", document_id)
    return DocumentReading(
        document=ReadingDocument(
            id=doc["id"],
            doc_type=doc["doc_type"],
            document_date=doc["document_date"],
            issuing_source=doc["issuing_source"],
            received_at=clinic_time.local(doc["created_at"]),
            page_count=doc["page_count"],
            sent_from=doc["sent_from"],
        ),
        patient=ReadingPatient(
            id=doc["patient_id"], registration_no=doc["registration_no"], full_name=doc["full_name"]
        ),
        pages=[
            ReadingPage(
                page_no=p["page_no"],
                url=storage.url_for(p["storage_key"]),
                width_px=p["width_px"],
                height_px=p["height_px"],
            )
            for p in repo.pages(conn, document_id)
        ],
        run=ReaderRun(
            reader_name=run["reader_name"],
            reader_version=run["reader_version"],
            profile_version=run["profile_version"],
            code_commit=run["code_commit"],
            started_at=clinic_time.local(run["started_at"]),
            finished_at=clinic_time.local(run["finished_at"]) if run["finished_at"] else None,
        )
        if run
        else None,
        values=[_value(r, shown, checks.get(r["id"], []), decisions.get(r["id"])) for r in rows],
        lines=[_line(r) for r in repo.lines(conn, document_id)],
    )


def _value(
    r: dict[str, Any],
    shown: dict[UUID, dict[str, Any]],
    checks: list[dict[str, Any]],
    decision: dict[str, Any] | None,
) -> ReadValue:
    by_code = {c["code"]: c["outcome"] for c in checks}
    visible = shown.get(r["superseded_by"] or r["id"])
    went_to = (
        "person" if r["queue_item_id"] else "record" if r["state"] == "accepted" else "checking"
    )
    settled = None
    if decision is not None:
        new = decision["new_value"] or {}
        old = decision["old_value"] or {}
        settled = Settled(
            action=_SETTLED[decision["action"]],  # type: ignore[arg-type]
            by_name=decision["by_name"],
            at=clinic_time.local(decision["occurred_at"]),
            decision_latency_ms=new.get("decision_latency_ms"),
            original_value_text=old.get("value_text")
            if decision["action"] == "value.correct"
            else None,
            original_unit_text=old.get("unit_text")
            if decision["action"] == "value.correct"
            else None,
        )
    return ReadValue(
        id=r["id"],
        analyte_name=r["analyte_name"],
        page_no=r["page_no"],
        box=_box(r),
        went_to=cast(Any, went_to),
        reason=r["reason"],
        checks=[Check(code=code, outcome=by_code[code]) for code in CHECK_ORDER if code in by_code],
        waiting=r["queue_item_id"] is not None and r["resolved_at"] is None,
        shown=ShownValue(value_text=visible["value_text"], unit_text=visible["unit_text"])
        if visible
        else None,
        settled=settled,
    )


def _line(r: dict[str, Any]) -> ReadLine:
    original = r["original"]
    # A line the checks settled is not waiting, and its text is shown:
    # hiding it left the page claiming nothing had been read.
    if r["confirmed_at"] is not None:
        state = "corrected" if original else "confirmed"
    elif r.get("accepted_at") is not None:
        state = "accepted"
    else:
        state = "waiting"
    reviewed = state != "waiting"
    return ReadLine(
        id=r["id"],
        page_no=r["page_no"],
        box=_box(r),
        state=cast(Any, state),
        drug_text=r["drug_text"] if reviewed else None,
        dose_text=r["dose_text"] if reviewed else None,
        schedule_text=r["schedule_text"] if reviewed else None,
        by_name=r["confirmed_by_name"],
        at=clinic_time.local(r["confirmed_at"]) if r["confirmed_at"] else None,
        original_text=" ".join(
            str(original[k]) for k in ("drug_text", "dose_text", "schedule_text") if original.get(k)
        )
        if original
        else None,
        regimen_id=r["regimen_id"],
    )


def _box(r: dict[str, Any]) -> Box | None:
    if r["bbox_x"] is None:
        return None
    return Box(
        x=float(r["bbox_x"]), y=float(r["bbox_y"]), w=float(r["bbox_w"]), h=float(r["bbox_h"])
    )
