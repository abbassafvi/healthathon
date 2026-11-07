"""
Reading the page as a page, and snapping each reading onto a region.

The crop reader shows every region on its own and asks the agent which
one it read from. It miscounts: on a laboratory table it answered 8,
10, 12, 14, a tidy sequence pointing at the wrong rows, and on a
consultation card every reading came back citing the same box. Shown
the whole page, the same model reads it correctly.

So the model reads the page and says roughly where each reading sits.
The detector still owns the regions, and a reading earns one only by
overlapping it. A reading that overlaps nothing cannot be pointed at on
the page, so it is not stored: that is the grounding check doing its
job with geometry rather than with a number the model chose.

It also costs one request per read instead of one per batch of crops.
"""

from dataclasses import dataclass
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any

from healthathon.uploads.agent import (
    Crop,
    DocType,
    DocumentReading,
    LabValue,
    RegimenLine,
    RequestedTest,
)
from healthathon.uploads.detector import Box
from healthathon.uploads.model_agent import _parse_date, _text
from healthathon.uploads.prompts import whole_page_prompt
from healthathon.uploads.providers import ModelClient

# How much of a detected region must fall inside the model's box before
# the two are taken to be the same piece of writing.
MIN_OVERLAP = 0.30
# How far ahead of the runner-up the best region must be. Handwriting
# slants, so the detector returns regions that swallow their neighbours
# and one spot on the page can sit on three of them. When two score this
# close the reading has no clear home, and guessing between them is how
# an HbA1c ended up pointing at a fasting glucose.
CLEAR_BY = 1.4


@dataclass(frozen=True)
class Snapped:
    """Which region a reading sits on, and whether that was clear."""

    index: int
    sure: bool


def _as_fractions(raw: Any) -> tuple[float, float, float, float] | None:
    """[ymin, xmin, ymax, xmax] out of 1000, as x0, y0, x1, y1 in 0..1."""
    if not isinstance(raw, list | tuple) or len(raw) != 4:
        return None
    try:
        ymin, xmin, ymax, xmax = (float(v) / 1000 for v in raw)
    except (TypeError, ValueError):
        return None
    if xmax <= xmin or ymax <= ymin:
        return None
    return xmin, ymin, xmax, ymax


def _covered(region: Box, x0: float, y0: float, x1: float, y1: float) -> float:
    """The share of a detected region that falls inside the model's box."""
    wide = max(0.0, min(region.x + region.w, x1) - max(region.x, x0))
    tall = max(0.0, min(region.y + region.h, y1) - max(region.y, y0))
    area = region.w * region.h
    return (wide * tall) / area if area > 0 else 0.0


def snap(raw: Any, regions: list[Box]) -> Snapped | None:
    """
    Which detected region the model's box sits on.

    Returns None when nothing overlaps enough: that reading cannot be
    pointed at, so it is never stored. When two regions overlap it
    almost equally the answer comes back unsure, and the reading goes to
    a clinician with its crop rather than being filed against a region
    picked by a hair.
    """
    said = _as_fractions(raw)
    if said is None or not regions:
        return None
    scored = sorted((_covered(r, *said), i) for i, r in enumerate(regions))
    best, index = scored[-1]
    if best < MIN_OVERLAP:
        return None
    runner_up = scored[-2][0] if len(scored) > 1 else 0.0
    return Snapped(index=index, sure=best >= runner_up * CLEAR_BY)


# Two readings are the same medicine when they say the same dose and
# their names are alike enough. One card returned "Tab. Cilacar",
# "Cilashort (10)" and "Tab. Cilacarst" on three adjacent lines: one
# drug, read three ways, which filled the review screen with the same
# medicine.
#
# Names this alike with the same dose are taken as one medicine wherever
# they sit. Names only loosely alike have to be neighbours as well,
# which is what lets a misread spelling fold without letting two real
# drugs that happen to share a dose fold with them.
SAME_MEDICINE_NAME = 0.5
SURELY_SAME_NAME = 0.85
SAME_MEDICINE_GAP = 0.06

_FORMS = ("tab.", "tab", "cap.", "cap", "tub.", "tub", "inj.", "inj", "syp.", "syp")


def _bare_name(drug: str) -> str:
    """The drug without its form or punctuation, for comparing."""
    text = drug.casefold().strip()
    for form in _FORMS:
        if text.startswith(form + " ") or text == form:
            text = text[len(form) :].strip()
            break
    return "".join(c for c in text if c.isalnum())


def _bare_dose(dose: str) -> str:
    """An unwritten dose compares equal to another unwritten dose."""
    return "".join(c for c in dose if c.isalnum() or c == "/")


def _same_medicine(a: RegimenLine, b: RegimenLine, regions: list[Box], at: list[int]) -> bool:
    if _bare_dose(a.dose_text) != _bare_dose(b.dose_text):
        return False
    alike = SequenceMatcher(None, _bare_name(a.drug_text), _bare_name(b.drug_text)).ratio()
    if alike >= SURELY_SAME_NAME:
        # The same drug at the same dose is one medicine, wherever the
        # two readings landed. Rybelsus came back twice, on lines a
        # hair too far apart for a distance rule to join them.
        return True
    if alike < SAME_MEDICINE_NAME:
        return False
    here, there = regions[at.index(a.box_index)], regions[at.index(b.box_index)]
    return abs(here.y - there.y) <= SAME_MEDICINE_GAP


def fold_near_duplicates(
    lines: list[RegimenLine], regions: list[Box], at: list[int]
) -> tuple[list[RegimenLine], set[int]]:
    """
    One medicine read several ways becomes one line, and goes to a
    clinician: the readings disagreed about its name, which is exactly
    what a person should settle against the crop.

    A reading joins a group if it matches any member, not just the
    first. Three spellings down three lines chain from neighbour to
    neighbour, and comparing only against the first left the furthest
    one stranded.
    """
    groups: list[list[RegimenLine]] = []
    for line in lines:
        joined = next(
            (g for g in groups if any(_same_medicine(m, line, regions, at) for m in g)), None
        )
        if joined is None:
            groups.append([line])
        else:
            joined.append(line)

    kept: list[RegimenLine] = []
    argued: set[int] = set()
    for group in groups:
        first = group[0]
        if len(group) > 1:
            argued.add(first.box_index)
        schedule = first.schedule_text or next(
            (m.schedule_text for m in group if m.schedule_text), None
        )
        kept.append(
            RegimenLine(
                box_index=first.box_index,
                drug_text=first.drug_text,
                dose_text=first.dose_text,
                schedule_text=schedule,
            )
        )
    return kept, argued


class WholePageAgent:
    """Reads the page in one call, then snaps each reading onto a region."""

    name = "whole-page-agent"

    def __init__(self, client: ModelClient, analyte_codes: list[str]) -> None:
        self._client = client
        self._codes = analyte_codes

    @property
    def version(self) -> str:
        return f"{self._client.name}:{self._client.model}"

    def read(self, doc_type: DocType, page: Path, crops: list[Crop]) -> DocumentReading:
        if not crops:
            return DocumentReading()
        regions = [c.box for c in crops]
        at = [c.index for c in crops]
        payload = self._client.complete_json(whole_page_prompt(doc_type, self._codes), [page])
        unsure: set[int] = set()

        lines: list[RegimenLine] = []
        seen: set[tuple[str, str]] = set()
        for item in payload.get("medicines") or []:
            where = snap(item.get("box"), regions)
            drug, dose = _text(item.get("drug")), _text(item.get("dose"))
            if where is None or drug is None:
                continue
            # A medicine whose dose is not written is still a medicine on
            # the page. Dropping it lost two of the five on a real card.
            # It is written with an empty dose, which fails the dose
            # check and puts it in front of a clinician.
            if dose is None:
                dose = ""
            # One medicine read twice is one medicine. A page listing
            # three drugs came back with the first written down again
            # against the second one's line.
            key = (drug.casefold(), dose.casefold())
            if key in seen:
                continue
            seen.add(key)
            if not where.sure:
                unsure.add(at[where.index])
            lines.append(
                RegimenLine(
                    box_index=at[where.index],
                    drug_text=drug,
                    dose_text=dose,
                    schedule_text=_text(item.get("schedule")),
                )
            )

        lines, argued = fold_near_duplicates(lines, regions, at)
        unsure |= argued

        values: list[LabValue] = []
        for item in payload.get("results") or []:
            where = snap(item.get("box"), regions)
            code, text = _text(item.get("analyte")), _text(item.get("value"))
            if where is None or code is None or text is None or code not in self._codes:
                continue
            if not where.sure:
                unsure.add(at[where.index])
            values.append(
                LabValue(
                    box_index=at[where.index],
                    analyte_code=code,
                    value_text=text,
                    unit_text=_text(item.get("unit")),
                )
            )

        orders: list[RequestedTest] = []
        for item in payload.get("orders") or []:
            where = snap(item.get("box"), regions)
            code = _text(item.get("analyte"))
            if where is None or code is None or code not in self._codes:
                continue
            orders.append(RequestedTest(box_index=at[where.index], analyte_code=code))

        return DocumentReading(
            values=values,
            lines=lines,
            orders=orders,
            document_date=_parse_date(payload.get("document_date")),
            issuing_source=_text(payload.get("issuing_source")),
            # A reading whose region was not clear goes to a clinician:
            # the grounding check is what fails on these.
            ungrounded=sorted(unsure),
        )
