from datetime import datetime
from typing import Any
from uuid import UUID

from fastapi import HTTPException
from psycopg import Connection
from psycopg.rows import DictRow

from healthathon import clinic_time, storage
from healthathon.audit import record_event
from healthathon.auth import CurrentUser
from healthathon.record import repository as record_repo
from healthathon.record.models import Box
from healthathon.regimens import repository as repo
from healthathon.regimens.models import (
    Activated,
    ActiveRegimen,
    AwaitingReview,
    Checklist,
    DocumentRef,
    ItemDecision,
    PageRef,
    RegimenItem,
    RegimenReview,
    Replaces,
    ReviewPatient,
)


def checklist(conn: Connection[DictRow], patient_id: UUID) -> Checklist:
    """The checklist in force, and every prescription still waiting for review."""
    if record_repo.get_patient(conn, patient_id) is None:
        raise HTTPException(404, "No such patient")
    regimens = repo.regimens_of(conn, patient_id)
    items = _items_by_regimen(conn, [r["id"] for r in regimens])
    active = next((r for r in regimens if r["activated_at"] and not r["superseded_at"]), None)
    return Checklist(
        active=ActiveRegimen(
            id=active["id"],
            activated_at=clinic_time.local(active["activated_at"]),
            activated_by_name=active["activated_by_name"] or "",
            source_document=_document(active),
            items=items.get(active["id"], []),
        )
        if active
        else None,
        awaiting_review=[
            AwaitingReview(
                regimen_id=r["id"],
                document=_document(r),
                item_count=len(items.get(r["id"], [])),
                confirmed_count=sum(1 for i in items.get(r["id"], []) if i.confirmed_at),
            )
            for r in regimens
            if not r["activated_at"]
        ],
    )


def review(conn: Connection[DictRow], regimen_id: UUID) -> RegimenReview:
    r = repo.regimen(conn, regimen_id)
    if r is None:
        raise HTTPException(404, "No such prescription")
    patient = record_repo.get_patient(conn, r["patient_id"])
    assert patient is not None
    rows = repo.items_of(conn, [regimen_id])
    page_row = next((i for i in rows if i["page_key"]), None)
    if page_row is None:
        raise HTTPException(409, "This prescription has no page to review against")
    current = repo.active_regimen(conn, r["patient_id"])
    replaces = None
    if current and current["id"] != regimen_id:
        replaces = Replaces(
            activated_at=clinic_time.local(current["activated_at"]),
            item_count=len(repo.items_of(conn, [current["id"]])),
        )
    return RegimenReview(
        regimen_id=regimen_id,
        patient=ReviewPatient(**patient),
        document=_document(r),
        page=PageRef(
            url=storage.url_for(page_row["page_key"]),
            width_px=page_row["width_px"],
            height_px=page_row["height_px"],
        ),
        items=[_item(i) for i in rows],
        replaces=replaces,
        activated_at=clinic_time.local(r["activated_at"]) if r["activated_at"] else None,
    )


def confirm_item(
    conn: Connection[DictRow], user: CurrentUser, item_id: UUID, decision: ItemDecision
) -> RegimenItem:
    """
    Confirm one line as read, or as corrected. The line's text is updated in
    place; what was read before stays in the audit event.
    """
    row = _editable_item(conn, item_id)
    fields = decision.model_fields_set
    drug = decision.drug_text.strip() if "drug_text" in fields and decision.drug_text else None
    dose = decision.dose_text.strip() if "dose_text" in fields and decision.dose_text else None
    schedule = row["schedule_text"]
    if "schedule_text" in fields:
        schedule = (decision.schedule_text or "").strip() or None
    new = {
        "drug_text": drug or row["drug_text"],
        "dose_text": dose or row["dose_text"],
        "schedule_text": schedule,
    }
    old = {k: row[k] for k in ("drug_text", "dose_text", "schedule_text")}
    repo.confirm_item(conn, item_id, user.id, new["drug_text"], new["dose_text"], schedule)
    corrected = new != old
    record_event(
        conn,
        user,
        "regimen_item.correct" if corrected else "regimen_item.confirm",
        "core.regimen_item",
        item_id,
        old_value=old if corrected else None,
        new_value=(new if corrected else {})
        | {"decision_latency_ms": decision.decision_latency_ms},
    )
    updated = repo.item(conn, item_id)
    assert updated is not None
    return _item(updated)


def remove_item(conn: Connection[DictRow], user: CurrentUser, item_id: UUID) -> None:
    """A line that is not a medicine (a test order, an instruction) leaves the checklist."""
    row = _editable_item(conn, item_id)
    repo.delete_item(conn, item_id)
    record_event(
        conn,
        user,
        "regimen_item.remove",
        "core.regimen_item",
        item_id,
        old_value={k: row[k] for k in ("drug_text", "dose_text", "schedule_text")},
    )


def activate(conn: Connection[DictRow], user: CurrentUser, regimen_id: UUID) -> Activated:
    """
    Make a reviewed prescription the patient's checklist. Every line must be
    confirmed by a person first. The checklist it replaces is superseded, not
    deleted, so ticks made against it keep their meaning.
    """
    r = repo.regimen(conn, regimen_id)
    if r is None:
        raise HTTPException(404, "No such prescription")
    repo.lock_patient(conn, r["patient_id"])
    r = repo.regimen(conn, regimen_id, lock=True)
    assert r is not None
    if r["activated_at"]:
        raise HTTPException(409, "This checklist is already active")
    items = repo.items_of(conn, [regimen_id])
    if not items:
        raise HTTPException(409, "A checklist needs at least one medicine")
    if any(i["confirmed_at"] is None for i in items):
        raise HTTPException(409, "Every medicine must be confirmed first")
    current = repo.active_regimen(conn, r["patient_id"])
    if current:
        repo.supersede(conn, current["id"])
    at: datetime = repo.activate(conn, regimen_id, user.id)
    record_event(
        conn,
        user,
        "regimen.activate",
        "core.regimen",
        regimen_id,
        new_value={
            "items": len(items),
            "supersedes": str(current["id"]) if current else None,
        },
    )
    return Activated(activated_at=clinic_time.local(at))


def crop_path(conn: Connection[DictRow], item_id: UUID) -> str:
    from healthathon.regimens.crop import ensure_crop

    row = repo.item(conn, item_id)
    if row is None:
        raise HTTPException(404, "No such item")
    key = ensure_crop(row)
    if key is None:
        raise HTTPException(404, "The page for this item is missing")
    return key


def _editable_item(conn: Connection[DictRow], item_id: UUID) -> dict[str, Any]:
    row = repo.item(conn, item_id)
    if row is None:
        raise HTTPException(404, "No such item")
    r = repo.regimen(conn, row["regimen_id"], lock=True)
    assert r is not None
    if r["activated_at"]:
        raise HTTPException(409, "This checklist is already active")
    return row


def _items_by_regimen(
    conn: Connection[DictRow], regimen_ids: list[UUID]
) -> dict[UUID, list[RegimenItem]]:
    out: dict[UUID, list[RegimenItem]] = {}
    for row in repo.items_of(conn, regimen_ids):
        out.setdefault(row["regimen_id"], []).append(_item(row))
    return out


def _item(row: dict[str, Any]) -> RegimenItem:
    return RegimenItem(
        id=row["id"],
        drug_text=row["drug_text"],
        dose_text=row["dose_text"],
        schedule_text=row["schedule_text"],
        box=Box(x=row["bbox_x"], y=row["bbox_y"], w=row["bbox_w"], h=row["bbox_h"]),
        crop_url=f"/api/regimen-items/{row['id']}/crop",
        confirmed_by_name=row["confirmed_by_name"],
        confirmed_at=clinic_time.local(row["confirmed_at"]) if row["confirmed_at"] else None,
    )


def _document(r: dict[str, Any]) -> DocumentRef:
    return DocumentRef(
        id=r["document_id"], document_date=r["document_date"], issuing_source=r["issuing_source"]
    )
