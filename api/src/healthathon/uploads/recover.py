"""
What became of an upload this process no longer remembers.

The job registry is per process and holds nothing on disk, so a restart
mid-read, or a second uvicorn worker answering the poll, left the screen
asking about an id nobody held and getting a 404. The row then sat on
"reading" with no failure and no retry.

The durable answer is in the database. An intake row says the page
arrived, a document row says it was stored and read, and the values and
lines say what the read produced. That is enough to rebuild the job the
screen is polling for.
"""

from typing import Any
from uuid import UUID

from psycopg import Connection
from psycopg.rows import DictRow

from healthathon.uploads.jobs import Job

# The read was running in a process that is gone. The page is stored, so
# the clinician loses nothing by sending it again.
INTERRUPTED = "This page was not read to the end. The photograph is saved, so try again."


def recover(conn: Connection[DictRow], upload_id: str) -> Job | None:
    """
    The job for a capture this process never saw, rebuilt from its rows.

    None when no intake carries that id, which is a genuine 404.
    """
    intake = conn.execute(
        "SELECT id, patient_id FROM core.intake WHERE client_capture_id = %s", (upload_id,)
    ).fetchone()
    if intake is None:
        return None

    patient_id = UUID(str(intake["patient_id"]))
    document = conn.execute(
        "SELECT id FROM core.document WHERE intake_id = %s ORDER BY created_at LIMIT 1",
        (intake["id"],),
    ).fetchone()
    if document is None:
        return Job(
            id=upload_id,
            capture_id=upload_id,
            patient_id=patient_id,
            stage="failed",
            failure=INTERRUPTED,
        )

    document_id = UUID(str(document["id"]))
    job = Job(
        id=upload_id,
        capture_id=upload_id,
        patient_id=patient_id,
        stage="done",
        document_id=document_id,
    )
    job.values_in_record = _count(
        conn,
        "SELECT count(*) AS n FROM core.extracted_value"
        " WHERE document_id = %s AND state = 'in_record'",
        document_id,
    )
    job.sent_to_queue = _queue_reasons(conn, document_id)
    regimen = conn.execute(
        "SELECT id FROM core.regimen WHERE source_document_id = %s ORDER BY created_at LIMIT 1",
        (document_id,),
    ).fetchone()
    if regimen is not None:
        job.regimen_id = UUID(str(regimen["id"]))
        job.lines_accepted = _count(
            conn,
            "SELECT count(*) AS n FROM core.regimen_item"
            " WHERE regimen_id = %s AND (accepted_at IS NOT NULL OR confirmed_at IS NOT NULL)",
            job.regimen_id,
        )
        job.lines_for_a_person = _count(
            conn,
            "SELECT count(*) AS n FROM core.regimen_item"
            " WHERE regimen_id = %s AND accepted_at IS NULL AND confirmed_at IS NULL",
            job.regimen_id,
        )
    return job


def _count(conn: Connection[DictRow], sql: str, key: UUID) -> int:
    row = conn.execute(sql, (key,)).fetchone()
    return int(row["n"]) if row else 0


def _queue_reasons(conn: Connection[DictRow], document_id: UUID) -> list[dict[str, Any]]:
    """
    Values waiting for a person, counted by reason. The queue row already
    names the check that sent each one, so nothing is recomputed here.
    """
    rows = conn.execute(
        "SELECT q.reason::text AS reason, count(*) AS n"
        " FROM core.confirm_queue_item q"
        " JOIN core.extracted_value v ON v.id = q.extracted_value_id"
        " WHERE v.document_id = %s AND q.resolved_at IS NULL"
        " GROUP BY q.reason ORDER BY q.reason",
        (document_id,),
    ).fetchall()
    return [{"reason": str(r["reason"]), "count": int(r["n"])} for r in rows]
