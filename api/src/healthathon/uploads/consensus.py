"""
Reading the page more than once, and comparing the answers.

"Ask again" in the deterministic layer. A reader that gives three
different answers to the same region has not read it, however confident
any one answer sounds, so the disagreement itself is the signal.

Neither kind of reading is thrown away here. A laboratory value keeps
its first reading and records what the other passes said; a prescription
line keeps the reading most passes gave, and the boxes where they did
not agree are named. The checks decide what any of that means, and a
line the passes argued over fails its reread check, drops below the
threshold, and waits for a clinician. Dropping it instead would leave a
medicine that is on the page in front of nobody at all.
"""

from collections import Counter, defaultdict
from dataclasses import dataclass, field

from healthathon.uploads.agent import DocumentReading, RegimenLine
from healthathon.uploads.checks import NOTHING


@dataclass
class Consensus:
    """The reading to write, and what the other passes said about each region."""

    reading: DocumentReading
    # box index -> what passes after the first read there
    other_reads: dict[int, list[str]] = field(default_factory=dict)
    # How many times the page was read.
    reads: int = 1
    # Boxes whose prescription line the passes read differently. The
    # line is still written; its reread check is what fails.
    disagreed: set[int] = field(default_factory=set)


def _line_key(line: RegimenLine) -> str:
    return f"{line.drug_text}|{line.dose_text}|{line.schedule_text or ''}"


def combine(passes: list[DocumentReading]) -> Consensus:
    """Fold several reads of one page into the one reading to act on."""
    first = passes[0]
    later = passes[1:]
    if not later:
        return Consensus(reading=first, reads=1)

    values = {v.box_index: v.value_text for v in first.values}
    other: dict[int, list[str]] = {i: [] for i in values}
    for other_pass in later:
        said = {v.box_index: v.value_text for v in other_pass.values}
        for index in other:
            other[index].append(said.get(index, NOTHING))

    lines, disagreed = _agreed_lines(passes)
    return Consensus(
        reading=DocumentReading(
            values=first.values,
            lines=lines,
            orders=first.orders,
            document_date=first.document_date,
            issuing_source=first.issuing_source,
            unreadable=sorted(first.unreadable),
        ),
        other_reads=other,
        reads=len(passes),
        disagreed=disagreed,
    )


def _agreed_lines(
    passes: list[DocumentReading],
) -> tuple[list[RegimenLine], set[int]]:
    """
    The reading of each line that most passes gave, and the boxes where
    they did not agree.

    This asked for unanimity once, and on a photographed prescription
    that meant nothing was ever written: three independent reads of
    handwriting differ somewhere nearly every time, so every medicine
    was dropped as unreadable and the record stayed empty.

    Nothing is dropped now. The most-agreed reading is written whether
    or not it won a majority, and a box no majority agreed on is named
    so its reread check fails. A clinician then confirms it against the
    crop, which is what disagreement should buy: a person looking, not a
    medicine disappearing.
    """
    needed = len(passes) // 2 + 1
    seen: dict[int, Counter[str]] = defaultdict(Counter)
    example: dict[tuple[int, str], RegimenLine] = {}
    for one_pass in passes:
        for line in one_pass.lines:
            key = _line_key(line)
            seen[line.box_index][key] += 1
            example[(line.box_index, key)] = line

    kept: list[RegimenLine] = []
    disagreed: set[int] = set()
    for box, counts in seen.items():
        key, votes = counts.most_common(1)[0]
        kept.append(example[(box, key)])
        if votes < needed:
            disagreed.add(box)
    return sorted(kept, key=lambda line: line.box_index), disagreed
