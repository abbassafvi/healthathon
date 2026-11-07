import hashlib
from uuid import UUID

from psycopg import Connection
from psycopg.rows import DictRow

from healthathon import clinic_time, phones
from healthathon.audit import record_event
from healthathon.entries import repository as entries_repo
from healthathon.inbound import store
from healthathon.sms.models import InboundSms, SmsProblem, SmsResult, StoredItem
from healthathon.sms.parser import parse


def receive(conn: Connection[DictRow], msg: InboundSms) -> SmsResult:
    """
    Store what an inbound SMS says, marked sms and entered by the patient.

    The sender is matched by the HMAC of the number, and only a patient who
    agreed to SMS has anything stored. Each line is stored or refused on its
    own; a refused line is named, never repaired. A message the gateway sends
    again (same message_id) is stored once. No reply is sent: notifications
    are out of scope.

    The storing itself is `inbound.store`, shared with the voice keypad,
    which carries the same instructions through a different door.
    """
    base = f"{store.SMS.capture_prefix}-{msg.message_id}"
    entries_repo.lock_capture_id(conn, base)
    if entries_repo.count_with_capture_prefix(conn, base):
        return SmsResult(accepted=True, duplicate=True, stored=[], problems=[])

    number = phones.normalise(msg.from_)
    patient = store.patient_for(conn, number) if number else None
    log_id = _log(conn, patient["id"] if patient else None, msg.body)
    if patient is None or not store.consented(conn, patient["id"], store.SMS.consent_item):
        record_event(conn, None, "sms.refuse", "core.message_log", log_id)
        return SmsResult(accepted=False, duplicate=False, stored=[], problems=[])

    instructions, parse_problems = parse(msg.body)
    problems = [SmsProblem(line=p.line, reason=p.reason) for p in parse_problems]
    kept = store.store(
        conn,
        channel=store.SMS,
        patient_id=patient["id"],
        language=str(patient["preferred_language"]),
        instructions=instructions,
        capture_base=base,
        when=clinic_time.local(msg.received_at) if msg.received_at else clinic_time.now(),
    )
    stored = [StoredItem(kind=k, entry_id=str(eid)) for k, eid in kept.items]
    problems += [SmsProblem(line=r.line, reason=r.reason) for r in kept.refused]

    record_event(
        conn,
        None,
        "sms.receive",
        "core.message_log",
        log_id,
        new_value={"stored": len(stored), "refused": len(problems)},
    )
    return SmsResult(accepted=True, duplicate=False, stored=stored, problems=problems)


def _log(conn: Connection[DictRow], patient_id: UUID | None, body: str) -> UUID:
    row = conn.execute(
        """
        INSERT INTO core.message_log (patient_id, direction, channel, body_sha256)
        VALUES (%s, 'inbound', 'sms', %s) RETURNING id
        """,
        (patient_id, hashlib.sha256(body.encode()).digest()),
    ).fetchone()
    assert row is not None
    log_id: UUID = row["id"]
    return log_id
