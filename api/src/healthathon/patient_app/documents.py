"""
The patient's own documents, and what was read off them.

A page the patient photographs goes through the same pipeline as one
scanned at the desk, so it lands in the same record and shows on the
clinician's side as soon as it is read.

What comes back here is the page and the readings, as written. Nothing
is added up, compared or judged: no range, no target, no trend, no
colour. Each reading says whether a clinician has settled it, because a
reading nobody has checked is not a fact about a medicine, and the app
says so beside it rather than quietly presenting it as one.

A laboratory number is stricter still. `proj.renderable_value` admits
only accepted and confirmed values and is the only view a value may be
read from, so an unsettled number has no text at all here.
"""

from typing import Any
from uuid import UUID

from psycopg import Connection
from psycopg.rows import DictRow

from healthathon.patient_app.models import (
    AppDocument,
    AppDocumentAdvice,
    AppDocumentLine,
    AppDocumentValue,
)
from healthathon.reading import repository as reading_repo


def _page_uri(patient_id: UUID, document_id: UUID, pages: list[dict[str, Any]]) -> str | None:
    """Where the app fetches the photograph, or None when no page is stored."""
    if not pages:
        return None
    return f"/api/app/patients/{patient_id}/documents/{document_id}/page"


def _lines(conn: Connection[DictRow], document_id: UUID) -> list[AppDocumentLine]:
    return [
        AppDocumentLine(
            drug_text=str(r["drug_text"]),
            dose_text=str(r["dose_text"]),
            schedule_text=r["schedule_text"],
            checked=r["confirmed_at"] is not None or r["accepted_at"] is not None,
        )
        for r in reading_repo.lines(conn, document_id)
    ]


def _values(conn: Connection[DictRow], document_id: UUID) -> list[AppDocumentValue]:
    rows = reading_repo.read_values(conn, document_id)
    shown = reading_repo.renderable(conn, [r["id"] for r in rows])
    out: list[AppDocumentValue] = []
    for r in rows:
        text = shown.get(r["id"])
        out.append(
            AppDocumentValue(
                analyte_name=str(r["analyte_name"]),
                value_text=str(text["value_text"]) if text else None,
                unit_text=text["unit_text"] if text else None,
                checked=text is not None,
            )
        )
    return out


def _advice(conn: Connection[DictRow], document_id: UUID) -> list[AppDocumentAdvice]:
    rows = conn.execute(
        "SELECT ra.advice_text, ra.confirmed_at, ra.accepted_at"
        " FROM core.regimen_advice ra JOIN core.regimen r ON r.id = ra.regimen_id"
        " WHERE r.source_document_id = %s ORDER BY ra.id",
        (document_id,),
    ).fetchall()
    return [
        AppDocumentAdvice(
            text=str(r["advice_text"]),
            checked=r["confirmed_at"] is not None or r["accepted_at"] is not None,
        )
        for r in rows
    ]


def one(conn: Connection[DictRow], patient_id: UUID, document_id: UUID) -> AppDocument | None:
    """One document, if it belongs to this patient. None otherwise."""
    row = conn.execute(
        "SELECT d.id, d.doc_type::text AS doc_type, d.document_date, i.received_at,"
        " i.channel::text AS sent_from"
        " FROM core.document d JOIN core.intake i ON i.id = d.intake_id"
        " WHERE d.id = %s AND d.patient_id = %s",
        (document_id, patient_id),
    ).fetchone()
    if row is None:
        return None
    return AppDocument(
        id=UUID(str(row["id"])),
        doc_type=str(row["doc_type"]),
        document_date=row["document_date"],
        received_at=row["received_at"],
        sent_from=str(row["sent_from"]),
        page_uri=_page_uri(patient_id, document_id, reading_repo.pages(conn, document_id)),
        lines=_lines(conn, document_id),
        values=_values(conn, document_id),
        advice=_advice(conn, document_id),
    )


def listing(conn: Connection[DictRow], patient_id: UUID) -> list[AppDocument]:
    """Every document on this patient's record, newest first."""
    rows = conn.execute(
        "SELECT d.id FROM core.document d JOIN core.intake i ON i.id = d.intake_id"
        " WHERE d.patient_id = %s ORDER BY i.received_at DESC, d.id",
        (patient_id,),
    ).fetchall()
    found = (one(conn, patient_id, UUID(str(r["id"]))) for r in rows)
    return [doc for doc in found if doc is not None]


def page_key(conn: Connection[DictRow], patient_id: UUID, document_id: UUID) -> str | None:
    """The stored page image, only if the document is this patient's."""
    row = conn.execute(
        "SELECT pg.storage_key FROM core.document_page pg"
        " JOIN core.document d ON d.id = pg.document_id"
        " WHERE pg.document_id = %s AND d.patient_id = %s ORDER BY pg.page_no LIMIT 1",
        (document_id, patient_id),
    ).fetchone()
    return str(row["storage_key"]) if row else None
