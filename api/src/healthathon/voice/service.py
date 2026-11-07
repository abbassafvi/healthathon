"""
An inbound call, step by step.

The patient rings the clinic and answers with the keypad. A key press
carries exactly what an SMS line carries, so the instructions are the
same objects the SMS parser produces and the storing is the same
`inbound.store`. Only the door differs.

What the call says back is a prompt name and the digits just stored,
never a judgement and never a drug name: a medicine is its number on the
patient's SMS card, so no recording has to pronounce one.

The clinic never rings out. Outbound would need a dialable number, which
`core.patient_phone` deliberately does not hold, and it would be a
notification. Both are decisions for a human, not for this module.
"""

from uuid import UUID

from psycopg import Connection
from psycopg.rows import DictRow

from healthathon import clinic_time, phones
from healthathon.audit import record_event
from healthathon.entries import repository as entries_repo
from healthathon.inbound import store
from healthathon.sms.parser import Answer, Instruction, Reading, Tick
from healthathon.voice.models import VoiceProblem, VoiceReply, VoiceStep

# Which recorded prompt follows each step. The names are keys into the
# recordings, not text: nothing here is spoken by a machine.
MENU = "voice.menu"
ASK_WHICH_MEDICINE = "voice.which_medicine"
ASK_READING = "voice.reading"
ASK_ANSWER = "voice.todays_question"
DONE = "voice.done"
CALLBACK_TAKEN = "voice.callback_taken"
NOT_RECOGNISED = "voice.not_recognised"

# The main menu, as the recording reads it out.
_MENU_CHOICES = {"1": ASK_WHICH_MEDICINE, "2": ASK_READING, "3": ASK_ANSWER}


def handle(conn: Connection[DictRow], step: VoiceStep) -> VoiceReply:
    """
    One webhook call: match the caller, check consent, store, say what next.

    A caller whose number is not a patient's, or whose voice consent is
    not a granted unwithdrawn yes, is told nothing and has nothing
    stored. That is the DPDP position and it fails closed.
    """
    # The provider's own name for the instruction when it gave one, the
    # step number otherwise. Either way a redelivery lands on the same
    # capture id and stores once.
    within = step.provider_ref or str(step.step)
    base = f"{store.VOICE.capture_prefix}-{step.call_id}:{within}"
    entries_repo.lock_capture_id(conn, base)
    if entries_repo.count_with_capture_prefix(conn, base):
        # The provider delivered this step twice. Say the same thing again
        # and store nothing.
        return VoiceReply(accepted=True, duplicate=True, prompt=DONE, confirm=None)

    number = phones.normalise(step.from_)
    patient = store.patient_for(conn, number) if number else None
    if patient is None or not store.consented(conn, patient["id"], store.VOICE.consent_item):
        return VoiceReply(accepted=False, duplicate=False, prompt=None, confirm=None)

    patient_id: UUID = patient["id"]
    if step.kind == "menu":
        return _menu(step)
    if step.kind == "callback":
        # Not an entry: asking to be rung back is not something the
        # patient reported about themselves, it is a request to the
        # clinic, so it goes on its own list rather than into the record.
        from healthathon.calls import callbacks

        callbacks.record(conn, patient_id, base)
        return VoiceReply(
            accepted=True, duplicate=False, prompt=CALLBACK_TAKEN, confirm=None, stored=[]
        )

    instruction, confirm = _instruction(step)
    if instruction is None:
        return VoiceReply(
            accepted=True,
            duplicate=False,
            prompt=NOT_RECOGNISED,
            confirm=None,
            expect="digits",
        )

    kept = store.store(
        conn,
        channel=store.VOICE,
        patient_id=patient_id,
        language=str(patient["preferred_language"]),
        instructions=[instruction],
        capture_base=base,
        when=clinic_time.local(step.occurred_at) if step.occurred_at else clinic_time.now(),
        audio_key=step.audio_key if step.kind == "answer" else None,
    )
    record_event(
        conn,
        None,
        "voice.receive",
        "core.patient",
        patient_id,
        new_value={"stored": len(kept.items), "refused": len(kept.refused), "step": step.step},
    )
    return VoiceReply(
        accepted=True,
        duplicate=False,
        prompt=MENU if kept.items else NOT_RECOGNISED,
        confirm=confirm if kept.items else None,
        expect="digits",
        stored=[kind for kind, _ in kept.items],
        problems=[VoiceProblem(line=r.line, reason=r.reason) for r in kept.refused],
    )


def _menu(step: VoiceStep) -> VoiceReply:
    """The main menu. Nothing is stored by choosing from it."""
    chosen = _MENU_CHOICES.get(step.digits or "")
    return VoiceReply(
        accepted=True,
        duplicate=False,
        prompt=chosen or NOT_RECOGNISED,
        confirm=None,
        expect="recording" if chosen == ASK_ANSWER else "digits",
    )


def _instruction(step: VoiceStep) -> tuple[Instruction | None, str | None]:
    """
    The key presses as an instruction, and what to repeat to the caller.

    None when the presses say nothing this can act on. Nothing is guessed
    at: an unrecognised press is asked again, never interpreted.
    """
    digits = step.digits or ""
    if step.kind == "tick":
        if step.item_number is None or digits not in ("1", "2"):
            return None, None
        taken = digits == "1"
        return Tick(item_number=step.item_number, ticked=taken), f"{step.item_number} {digits}"
    if step.kind == "reading":
        if not digits or step.context is None:
            return None, None
        return Reading(value_text=digits, context=step.context), digits
    if step.kind == "answer":
        if not step.audio_key:
            return None, None
        # Stored as recorded, with no text at all: `store` puts the
        # recording in pat.survey_answer.audio_key and never transcribes it.
        return Answer(text=""), None
    return None, None
