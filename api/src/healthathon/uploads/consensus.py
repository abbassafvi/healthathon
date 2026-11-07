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
    # (box index, folded drug name) -> how many passes gave the reading
    # that was written. The reread check turns that into a share, so a
    # line two passes of three agreed on records 0.667 and not 1.0.
    line_votes: dict[tuple[int, str], int] = field(default_factory=dict)

    @property
    def disagreed(self) -> set[int]:
        """Boxes whose line no majority of the passes agreed on."""
        needed = self.reads // 2 + 1
        return {box for (box, _), seen in self.line_votes.items() if seen < needed}


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

    lines, line_votes = _agreed_lines(passes)
    return Consensus(
        reading=DocumentReading(
            values=first.values,
            lines=lines,
            orders=first.orders,
            advice=first.advice,
            document_date=first.document_date,
            issuing_source=first.issuing_source,
            unreadable=sorted(first.unreadable),
            ungrounded=sorted({i for p in passes for i in p.ungrounded}),
        ),
        other_reads=other,
        reads=len(passes),
        line_votes=line_votes,
    )


def _agreed_lines(
    passes: list[DocumentReading],
) -> tuple[list[RegimenLine], dict[tuple[int, str], int]]:
    """
    The reading of each line that most passes gave, and how many passes
    gave it.

    This asked for unanimity once, and on a photographed prescription
    that meant nothing was ever written: three independent reads of
    handwriting differ somewhere nearly every time, so every medicine
    was dropped as unreadable and the record stayed empty.

    Nothing is dropped now. The most-agreed reading is written whether
    or not it won a majority, and the count it won is returned so the
    reread check can record the share and fail the lines no majority
    agreed on. A clinician then confirms those against the crop, which
    is what disagreement should buy: a person looking, not a medicine
    disappearing.
    """
    # Grouped by the drug on a region, not by the region alone. A crop
    # can hold more than one medicine, and keeping only the region's
    # commonest reading threw the other away: a card with Metformin and
    # Amlodipine on one region wrote Metformin alone. Grouping by the
    # whole line is the opposite mistake, writing one drug three times
    # when three reads disagreed about its dose.
    votes: dict[tuple[int, str], Counter[str]] = defaultdict(Counter)
    example: dict[tuple[int, str, str], RegimenLine] = {}
    for one_pass in passes:
        for line in one_pass.lines:
            drug = line.drug_text.casefold().strip()
            reading = _line_key(line)
            votes[(line.box_index, drug)][reading] += 1
            example[(line.box_index, drug, reading)] = line

    kept: list[RegimenLine] = []
    seen: dict[tuple[int, str], int] = {}
    for (box, drug), counts in votes.items():
        reading, seen_times = counts.most_common(1)[0]
        kept.append(example[(box, drug, reading)])
        seen[(box, drug)] = seen_times
    return sorted(kept, key=lambda line: line.box_index), seen
