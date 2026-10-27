import re
from dataclasses import dataclass
from typing import Literal

# The message format a patient writes, printed on the card the clinic gives
# them. One instruction per line, or separated by ";". Letters are not case
# sensitive. Nothing is guessed: a line that does not match is refused and
# named, never repaired.
#
#   G 142 F      a glucose reading and when it was taken (no bare numbers)
#   T 2 Y        medicine 2 on the checklist: Y taken, N not taken
#   Q <words>    the answer to the day's question, kept as written

CONTEXTS = {
    "F": "fasting",
    "B": "before_meal",
    "A": "after_meal",
    "N": "bedtime",
    "O": "overnight",
    "R": "random",
}


@dataclass(frozen=True)
class Reading:
    value_text: str
    context: str
    kind: Literal["reading"] = "reading"


@dataclass(frozen=True)
class Tick:
    item_number: int
    ticked: bool
    kind: Literal["tick"] = "tick"


@dataclass(frozen=True)
class Answer:
    text: str
    kind: Literal["answer"] = "answer"


@dataclass(frozen=True)
class Problem:
    line: str
    reason: Literal["no_context", "not_a_number", "unknown", "bad_tick", "empty_answer"]


Instruction = Reading | Tick | Answer

_READING = re.compile(r"^G\s+(\S+)(?:\s+(\S+))?$", re.IGNORECASE)
_TICK = re.compile(r"^T\s+(\d{1,2})\s+([YN])$", re.IGNORECASE)
_ANSWER = re.compile(r"^Q(?:\s+(.*))?$", re.IGNORECASE | re.DOTALL)
_NUMBER = re.compile(r"^\d{1,4}(\.\d{1,2})?$")


def parse(body: str) -> tuple[list[Instruction], list[Problem]]:
    instructions: list[Instruction] = []
    problems: list[Problem] = []
    for raw in re.split(r"[\n;]", body):
        line = raw.strip()
        if not line:
            continue
        if m := _ANSWER.match(line):
            text = (m.group(1) or "").strip()
            if text:
                instructions.append(Answer(text))
            else:
                problems.append(Problem(line, "empty_answer"))
        elif m := _READING.match(line):
            value, context = m.group(1), m.group(2)
            if not _NUMBER.match(value):
                problems.append(Problem(line, "not_a_number"))
            elif context is None or context.upper() not in CONTEXTS:
                problems.append(Problem(line, "no_context"))
            else:
                instructions.append(Reading(value, CONTEXTS[context.upper()]))
        elif m := _TICK.match(line):
            instructions.append(Tick(int(m.group(1)), m.group(2).upper() == "Y"))
        elif line[:1].upper() == "T":
            problems.append(Problem(line, "bad_tick"))
        else:
            problems.append(Problem(line, "unknown"))
    return instructions, problems
