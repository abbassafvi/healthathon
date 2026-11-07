"""
What an instruction from outside the clinic does to the record.

SMS and a keypad on a voice call carry the same instructions: tick a
medicine by its number on the card, record a glucose reading, answer the
day's question. Only the door differs, so the storing lives here once and
each door passes its own channel.

Three things vary per door and nothing else: the `pat.entry.channel` the
row is marked with, the `core.consent.item` that must be a granted,
unwithdrawn yes before anything is stored, and the prefix the capture id
is built from. They are a `Channel`, not three arguments, so a new door
cannot supply two of the three and silently store against the wrong
consent.
"""

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from psycopg import Connection
from psycopg.rows import DictRow

from healthathon import phones
from healthathon.entries import repository as entries_repo
from healthathon.patient_app import repository as app_repo
from healthathon.sms.parser import Answer, Instruction, Reading, Tick

Reason = Literal["no_such_medicine", "already_recorded", "no_question"]
# The three kinds of entry an instruction from outside can produce.
EntryKind = Literal["glucose_reading", "medication_tick", "survey_answer"]


@dataclass(frozen=True)
class Channel:
    """One door into the record, and what it is called in each place."""

    # A core.intake_channel value, written to pat.entry.channel.
    name: str
    # A core.consent.item value. Processing fails closed without it.
    consent_item: str
    # Capture ids start with this, so one door cannot collide with another.
    capture_prefix: str


SMS = Channel(name="sms", consent_item="sms", capture_prefix="sms")
# Inbound only. The patient rings the clinic; the clinic never rings out,
# which would be a notification and needs a dialable number.
VOICE = Channel(name="voice_call", consent_item="voice", capture_prefix="voice")


@dataclass(frozen=True)
class Refused:
    """An instruction that was not stored, named rather than repaired."""

    line: str
    reason: Reason


@dataclass
class Stored:
    """What one delivery put in the record."""

    items: list[tuple[EntryKind, UUID]] = field(default_factory=list)
    refused: list[Refused] = field(default_factory=list)


def patient_for(conn: Connection[DictRow], number: str) -> dict[str, Any] | None:
    """The patient whose phone this is, by the HMAC of the number."""
    return conn.execute(
        """
        SELECT p.id, p.preferred_language FROM core.patient_phone ph
        JOIN core.patient p ON p.id = ph.patient_id
        WHERE ph.phone_hmac = %s AND p.exited_at IS NULL
        """,
        (phones.phone_hmac(number),),
    ).fetchone()


def consented(conn: Connection[DictRow], patient_id: UUID, item: str) -> bool:
    """
    The latest consent on record for this item is a yes nobody withdrew.

    Fails closed: no row at all is a no, as the DPDP Act requires and as
    the comment on core.consent says.
    """
    row = conn.execute(
        """
        SELECT granted, withdrawn_at FROM core.consent
        WHERE patient_id = %s AND item = %s
        ORDER BY captured_at DESC LIMIT 1
        """,
        (patient_id, item),
    ).fetchone()
    return bool(row and row["granted"] and row["withdrawn_at"] is None)


def store(
    conn: Connection[DictRow],
    *,
    channel: Channel,
    patient_id: UUID,
    language: str,
    instructions: list[Instruction],
    capture_base: str,
    when: datetime,
    audio_key: str | None = None,
) -> Stored:
    """
    Store each instruction, or name it refused, on its own.

    One instruction failing never stops the rest: a reading that arrives
    with a tick for a medicine nobody prescribed stores the reading and
    reports the tick. Nothing is guessed at or repaired.

    `audio_key` is a recording the patient spoke instead of typing. It is
    stored beside the answer and never transcribed, so a spoken answer
    reaches the clinic as the patient said it. SMS never sets it.
    """
    out = Stored()
    day = when.date()
    items = app_repo.active_items(conn, patient_id)
    n = 0

    def entry(kind: EntryKind) -> UUID:
        nonlocal n
        n += 1
        eid = entries_repo.insert_entry(
            conn,
            patient_id,
            kind,
            channel.name,
            "patient",
            language,
            f"{capture_base}:{n}",
            when,
        )
        assert eid is not None  # the capture id lock makes a clash impossible
        out.items.append((kind, eid))
        return eid

    for ins in instructions:
        if isinstance(ins, Reading):
            entries_repo.insert_glucose(
                conn, entry("glucose_reading"), ins.value_text, ins.context, None
            )
        elif isinstance(ins, Tick):
            line = f"T {ins.item_number} {'Y' if ins.ticked else 'N'}"
            if not 1 <= ins.item_number <= len(items):
                out.refused.append(Refused(line=line, reason="no_such_medicine"))
                continue
            item_id = items[ins.item_number - 1]["id"]
            if entries_repo.tick_for(conn, patient_id, item_id, day):
                out.refused.append(Refused(line=line, reason="already_recorded"))
                continue
            entries_repo.insert_tick(conn, entry("medication_tick"), item_id, day, ins.ticked)
        elif isinstance(ins, Answer):
            question = entries_repo.questions(conn, entries_repo.DAILY_QUESTION_KEYS)
            if not question:
                out.refused.append(Refused(line=f"Q {ins.text}", reason="no_question"))
                continue
            # A spoken answer has no text: the recording is the answer.
            spoken = audio_key is not None
            entries_repo.insert_answer(
                conn,
                entry("survey_answer"),
                question[0]["id"],
                None if spoken else ins.text,
                None,
                audio_key,
            )
    return out
