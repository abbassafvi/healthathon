import hashlib
from typing import Any
from uuid import UUID

from psycopg import Connection
from psycopg.rows import DictRow

from healthathon import clinic_time, phones
from healthathon.audit import record_event
from healthathon.entries import repository as entries_repo
from healthathon.patient_app import repository as app_repo
from healthathon.sms.models import InboundSms, SmsProblem, SmsResult, StoredItem
from healthathon.sms.parser import Answer, Reading, Tick, parse


def receive(conn: Connection[DictRow], msg: InboundSms) -> SmsResult:
    """
    Store what an inbound SMS says, marked sms and entered by the patient.

    The sender is matched by the HMAC of the number, and only a patient who
    agreed to SMS has anything stored. Each line is stored or refused on its
    own; a refused line is named, never repaired. A message the gateway sends
    again (same message_id) is stored once. No reply is sent: notifications
    are out of scope.
    """
    base = f"sms-{msg.message_id}"
    entries_repo.lock_capture_id(conn, base)
    if entries_repo.count_with_capture_prefix(conn, base):
        return SmsResult(accepted=True, duplicate=True, stored=[], problems=[])

    number = phones.normalise(msg.from_)
    patient = _patient_for(conn, number) if number else None
    log_id = _log(conn, patient["id"] if patient else None, msg.body)
    if patient is None or not _consented(conn, patient["id"]):
        record_event(conn, None, "sms.refuse", "core.message_log", log_id)
        return SmsResult(accepted=False, duplicate=False, stored=[], problems=[])

    instructions, parse_problems = parse(msg.body)
    problems = [SmsProblem(line=p.line, reason=p.reason) for p in parse_problems]
    stored: list[StoredItem] = []
    pid: UUID = patient["id"]
    lang = str(patient["preferred_language"])
    when = clinic_time.local(msg.received_at) if msg.received_at else clinic_time.now()
    day = when.date()
    items = app_repo.active_items(conn, pid)
    n = 0

    def entry(kind: str) -> UUID:
        nonlocal n
        n += 1
        eid = entries_repo.insert_entry(
            conn, pid, kind, "sms", "patient", lang, f"{base}:{n}", when
        )
        assert eid is not None  # the capture id lock makes a clash impossible
        stored.append(StoredItem(kind=kind, entry_id=str(eid)))  # type: ignore[arg-type]
        return eid

    for ins in instructions:
        if isinstance(ins, Reading):
            entries_repo.insert_glucose(
                conn, entry("glucose_reading"), ins.value_text, ins.context, None
            )
        elif isinstance(ins, Tick):
            line = f"T {ins.item_number} {'Y' if ins.ticked else 'N'}"
            if not 1 <= ins.item_number <= len(items):
                problems.append(SmsProblem(line=line, reason="no_such_medicine"))
                continue
            item_id = items[ins.item_number - 1]["id"]
            if entries_repo.tick_for(conn, pid, item_id, day):
                problems.append(SmsProblem(line=line, reason="already_recorded"))
                continue
            entries_repo.insert_tick(conn, entry("medication_tick"), item_id, day, ins.ticked)
        elif isinstance(ins, Answer):
            question = entries_repo.questions(conn, entries_repo.DAILY_QUESTION_KEYS)
            if not question:
                problems.append(SmsProblem(line=f"Q {ins.text}", reason="no_question"))
                continue
            entries_repo.insert_answer(
                conn, entry("survey_answer"), question[0]["id"], ins.text, None
            )

    record_event(
        conn,
        None,
        "sms.receive",
        "core.message_log",
        log_id,
        new_value={"stored": len(stored), "refused": len(problems)},
    )
    return SmsResult(accepted=True, duplicate=False, stored=stored, problems=problems)


def _patient_for(conn: Connection[DictRow], number: str) -> dict[str, Any] | None:
    return conn.execute(
        """
        SELECT p.id, p.preferred_language FROM core.patient_phone ph
        JOIN core.patient p ON p.id = ph.patient_id
        WHERE ph.phone_hmac = %s AND p.exited_at IS NULL
        """,
        (phones.phone_hmac(number),),
    ).fetchone()


def _consented(conn: Connection[DictRow], patient_id: UUID) -> bool:
    """The latest SMS consent on record is a yes that has not been withdrawn."""
    row = conn.execute(
        """
        SELECT granted, withdrawn_at FROM core.consent
        WHERE patient_id = %s AND item = 'sms'
        ORDER BY captured_at DESC LIMIT 1
        """,
        (patient_id,),
    ).fetchone()
    return bool(row and row["granted"] and row["withdrawn_at"] is None)


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
