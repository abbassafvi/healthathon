from datetime import datetime
from itertools import groupby
from typing import Any
from uuid import UUID

from fastapi import HTTPException
from psycopg import Connection
from psycopg.rows import DictRow

from healthathon import clinic_time, storage
from healthathon.audit import record_event
from healthathon.auth import CurrentUser
from healthathon.record import repository as repo
from healthathon.record.models import (
    Box,
    Caregiver,
    DocumentInfo,
    PatientListItem,
    PatientRecord,
    PatientSummary,
    RecordDocument,
    RecordValue,
    SurveyForm,
    Trace,
    TraceHistory,
    TracePage,
)

NOT_SHOWN = "This value is not shown in the record"

_COUNTS = ("checklist_medicines", "waiting_values", "waiting_lines", "documents")


def patient_list(conn: Connection[DictRow]) -> list[PatientListItem]:
    def local(t: datetime | None) -> datetime | None:
        return clinic_time.local(t) if t else None

    return [
        PatientListItem(
            id=r["id"], registration_no=r["registration_no"], full_name=r["full_name"],
            year_of_birth=r["year_of_birth"], sex=r["sex"],
            preferred_language=r["preferred_language"],
            enrolled_at=clinic_time.local(r["enrolled_at"]),
            caregiver=Caregiver(full_name=r["caregiver_name"],
                                relationship=r["caregiver_relationship"])
            if r["caregiver_name"] else None,
            last_visit=local(r["last_visit"]), next_visit=local(r["next_visit"]),
            checklist_since=local(r["checklist_since"]),
            last_entry_at=local(r["last_entry_at"]),
            sms_phone_last4=r["sms_phone_last4"],
            **{k: int(r[k]) for k in _COUNTS},
        )
        for r in repo.list_patients(conn)
    ]  # fmt: skip


def patient_record(conn: Connection[DictRow], user: CurrentUser, patient_id: UUID) -> PatientRecord:
    patient = repo.get_patient(conn, patient_id)
    if patient is None:
        raise HTTPException(404, "No such patient")
    documents = [
        RecordDocument(
            **_document(rows[0]),
            values=[_value(r) for r in rows],
        )
        for rows in (
            list(group)
            for _, group in groupby(
                repo.record_values(conn, patient_id), key=lambda r: r["document_id"]
            )
        )
    ]
    # Reads are audited: on a shared terminal this is the access evidence.
    record_event(conn, user, "record.read", "core.patient", patient_id)
    survey_forms = [
        SurveyForm(
            id=r["id"],
            photographed_at=clinic_time.local(r["photographed_at"]),
            url=storage.url_for(r["storage_key"]),
            width_px=r["width_px"],
            height_px=r["height_px"],
        )
        for r in repo.survey_forms(conn, patient_id)
    ]
    return PatientRecord(
        patient=PatientSummary(**patient), documents=documents, survey_forms=survey_forms
    )


def trace(conn: Connection[DictRow], user: CurrentUser, value_id: UUID) -> Trace:
    """
    Everything needed to show where one value came from: the page and the
    region on it, the reader that produced it, and how it reached the
    record. Only renderable values can be traced, so a value that has not
    been accepted or confirmed returns 404.
    """
    row = repo.trace_row(conn, value_id)
    if row is None:
        raise HTTPException(404, NOT_SHOWN)
    patient = repo.get_patient(conn, row["patient_id"])
    assert patient is not None

    page = None
    if row["page_key"]:
        page = TracePage(
            url=storage.url_for(row["page_key"]),
            page_no=row["page_no"],
            page_count=row["page_count"],
            width_px=row["width_px"],
            height_px=row["height_px"],
        )
    box = None
    if row["bbox_x"] is not None:
        box = Box(x=row["bbox_x"], y=row["bbox_y"], w=row["bbox_w"], h=row["bbox_h"])

    record_event(conn, user, "value.trace", "core.extracted_value", value_id)
    return Trace(
        value=_value(row),
        patient=PatientSummary(**patient),
        document=DocumentInfo(**_document(row)),
        provenance_kind=row["provenance_kind"],
        page=page,
        box=box,
        located_by_text=box is None and row["char_start"] is not None,
        entered_by_name=row["entered_by_name"],
        reader_name=row["reader_name"],
        reader_version=row["reader_version"],
        history=_history(conn, value_id, row["state"]),
    )


def _history(conn: Connection[DictRow], value_id: UUID, state: str) -> TraceHistory:
    correction = repo.correction_into(conn, value_id)
    if correction:
        return TraceHistory(kind="corrected", **correction)
    if state == "confirmed":
        confirmation = repo.confirmation_of(conn, value_id) or {"at": None, "actor_name": None}
        return TraceHistory(
            kind="confirmed", original_value_text=None, original_unit_text=None, **confirmation
        )
    return TraceHistory(
        kind="accepted", actor_name=None, at=None, original_value_text=None, original_unit_text=None
    )


def _document(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row["document_id"],
        "doc_type": row["doc_type"],
        "document_date": row["document_date"],
        "issuing_source": row["issuing_source"],
        "sent_from": row["sent_from"],
    }


def _value(row: dict[str, Any]) -> RecordValue:
    return RecordValue(
        id=row["id"],
        analyte_code=row["analyte_code"],
        analyte_name=row["analyte_name"],
        value_text=row["value_text"],
        unit_text=row["unit_text"],
        observed_at=row["observed_at"],
    )
