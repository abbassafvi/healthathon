from typing import Any, cast

from psycopg import Connection
from psycopg.rows import DictRow

from healthathon import audit_chain, clinic_time
from healthathon.audit import record_event
from healthathon.audit_log import repository as repo
from healthathon.audit_log.models import AuditEntry, AuditLog, AuditPatient, ChainCheck, Kind
from healthathon.auth import CurrentUser


def audit_log(
    conn: Connection[DictRow], user: CurrentUser, kind: Kind | None, before: int | None, limit: int
) -> AuditLog:
    """
    The audit chain, newest first, with the chain checked end to end on
    every read. Reading the log is itself an event in it.
    """
    record_event(conn, user, "audit.read", "audit.event", None, new_value={"kind": kind})
    chain = audit_chain.verify(conn)
    rows = repo.entries(conn, repo.KINDS[kind] if kind else None, before, limit + 1)
    page = rows[:limit]
    return AuditLog(
        chain=ChainCheck(**chain),
        entries=[_entry(r) for r in page],
        next_before=page[-1]["id"] if len(rows) > limit else None,
    )


def _kind(action: str) -> Kind:
    for kind, actions in repo.KINDS.items():
        if action in actions:
            return cast(Kind, kind)
    return "read" if action.endswith(".read") else "decision"


def _entry(r: dict[str, Any]) -> AuditEntry:
    return AuditEntry(
        id=r["id"],
        occurred_at=clinic_time.local(r["occurred_at"]),
        action=r["action"],
        kind=_kind(r["action"]),
        actor_name=r["actor_name"],
        actor_role=r["actor_role"],
        patient=AuditPatient(
            id=r["patient_id"], registration_no=r["registration_no"], full_name=r["patient_name"]
        )
        if r["patient_id"]
        else None,
        reason_code=r["reason_code"],
        decision_latency_ms=r["decision_latency_ms"],
    )
