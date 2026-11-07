"""
The five deterministic checks, run on every reading the agent returns.

They are stored one row per check rather than collapsed into a single
confidence number, so a confirm-queue reason can name the check that
failed and so each check can be ablated and measured on its own.

Nothing here judges the patient. The reportable range is the range of
the assay, which is what a machine could physically have printed; it is
never rendered, and its only effect is to send a value to a person.
"""

import re
from dataclasses import dataclass
from datetime import date
from decimal import Decimal, InvalidOperation
from pathlib import Path

from PIL import Image, ImageFilter, ImageStat

# check_code -> the confirm_reason a failure maps to.
FAILURE_REASON = {
    "grounding": "no_region_on_page",
    "legibility": "region_illegible",
    "well_formed": "unknown_unit",
    "reread_agreement": "readers_disagree",
    "cross_document": "conflicting_documents",
}


@dataclass(frozen=True)
class CheckOutcome:
    code: str
    outcome: str  # pass | fail | not_applicable
    signal: float | None = None
    detail: dict[str, object] | None = None

    @property
    def failed(self) -> bool:
        return self.outcome == "fail"


def sharpness(crop: Path) -> float:
    """
    How much edge energy the crop holds. A blurred or shadowed region
    scores low. Measured with Pillow alone so the light install needs no
    numerical stack.
    """
    with Image.open(crop) as img:
        grey = img.convert("L")
        if grey.width < 8 or grey.height < 8:
            return 0.0
        edges = grey.filter(ImageFilter.FIND_EDGES)
        # FIND_EDGES lights up the outermost pixels of any image, blank or
        # not, so that frame is dropped before the variance is measured.
        inner = edges.crop((2, 2, edges.width - 2, edges.height - 2))
        if inner.width < 1 or inner.height < 1:
            return 0.0
        return float(ImageStat.Stat(inner).var[0])


def grounding(has_region: bool) -> CheckOutcome:
    """Is there a region on the page this value can be pointed at?"""
    return CheckOutcome("grounding", "pass" if has_region else "fail")


def legibility(crop: Path, minimum: float) -> CheckOutcome:
    score = sharpness(crop)
    return CheckOutcome(
        "legibility",
        "pass" if score >= minimum else "fail",
        signal=round(score, 2),
        detail={"minimum": minimum},
    )


def well_formed(
    value_text: str,
    unit_text: str | None,
    known_units: set[str],
    observed_at: date | None,
    reportable: tuple[Decimal, Decimal] | None,
) -> CheckOutcome:
    """
    Is the value a number, is its unit one we know for this analyte, is
    the date real, and could the assay have printed this number at all?
    """
    try:
        number = Decimal(value_text.replace(",", "").strip())
    except (InvalidOperation, AttributeError):
        return CheckOutcome("well_formed", "fail", detail={"why": "not_a_number"})
    # Decimal parses "NaN" and "Infinity" happily. Neither is a reading,
    # and comparing NaN against an assay range raises, which failed the
    # whole page rather than the one value.
    if not number.is_finite():
        return CheckOutcome("well_formed", "fail", detail={"why": "not_a_number"})
    if known_units and (unit_text is None or not unit_text.strip()):
        # A number with no unit is not a measurement. It was accepted
        # into the record until a review caught it.
        return CheckOutcome("well_formed", "fail", detail={"why": "unknown_unit"})
    if unit_text is not None and known_units and unit_text.strip() not in known_units:
        return CheckOutcome(
            "well_formed", "fail", detail={"why": "unknown_unit", "unit": unit_text}
        )
    if observed_at is not None and observed_at > date.today():
        return CheckOutcome("well_formed", "fail", detail={"why": "implausible_date"})
    if reportable is not None and not (reportable[0] <= number <= reportable[1]):
        return CheckOutcome(
            "well_formed",
            "fail",
            signal=float(number),
            detail={"why": "outside_assay_range"},
        )
    return CheckOutcome("well_formed", "pass", signal=float(number))


# A later pass that returned nothing for this region at all. Treated as a
# disagreement, because a reading that appears only sometimes is exactly
# the reading not to trust.
NOTHING = "\u2205"


# Units a dose is written in. A dose carrying anything else is not one
# this system is willing to put on a patient's checklist by itself.
DOSE_UNITS = {
    "mg",
    "mcg",
    "µg",
    "ug",
    "g",
    "gm",
    "ml",
    "l",
    "iu",
    "u",
    "unit",
    "units",
    "%",
    "tab",
    "tabs",
    "cap",
    "caps",
    "drop",
    "drops",
    "puff",
    "puffs",
    "sachet",
}

# How a dose is written on a prescription: 500 mg, 15mg, 10/100/1000,
# 75 mcg, 1. A number has to be in there somewhere.
_DOSE_NUMBER = re.compile(r"\d")
_DOSE_WORD = re.compile(r"[a-zA-Zµ%]+")


def dose_well_formed(dose_text: str, schedule_text: str | None) -> CheckOutcome:
    """
    Is this written the way a dose is written?

    The equivalent of well_formed for a line of a prescription, which has
    no analyte, no assay range and no date to check. It asks only what
    can be asked of the string itself: that a quantity is present, and
    that any word beside it is a unit a dose is measured in. A line that
    fails goes to a person, so the check leans towards refusing.
    """
    dose = (dose_text or "").strip()
    if not dose:
        return CheckOutcome("well_formed", "fail", detail={"why": "no_dose"})
    if not _DOSE_NUMBER.search(dose):
        return CheckOutcome("well_formed", "fail", detail={"why": "dose_has_no_quantity"})
    unknown = [w for w in _DOSE_WORD.findall(dose) if w.lower() not in DOSE_UNITS]
    if unknown:
        return CheckOutcome(
            "well_formed", "fail", detail={"why": "unknown_dose_unit", "words": unknown}
        )
    return CheckOutcome(
        "well_formed", "pass", detail={"schedule": schedule_text} if schedule_text else None
    )


def reread_agreement(first: str, others: list[str]) -> CheckOutcome:
    """
    Independent passes over the same region, compared. The question is
    not whether any one answer looks right, it is whether the reader
    gives the same answer every time. One pass means nothing to compare.
    """
    if not others:
        return CheckOutcome("reread_agreement", "not_applicable")
    answers = [first.strip(), *(o.strip() for o in others)]
    same = sum(1 for a in answers if a == answers[0])
    agree = same == len(answers)
    return CheckOutcome(
        "reread_agreement",
        "pass" if agree else "fail",
        signal=round(same / len(answers), 3),
        detail=None if agree else {"reads": answers},
    )


def cross_document(value_text: str, others: list[str]) -> CheckOutcome:
    """
    The same analyte on the same day in another document. Neither copy is
    preferred: a disagreement sends this one to a person.
    """
    if not others:
        return CheckOutcome("cross_document", "not_applicable")
    agree = all(o.strip() == value_text.strip() for o in others)
    return CheckOutcome(
        "cross_document",
        "pass" if agree else "fail",
        detail=None if agree else {"others": others},
    )


# How much each check bears on whether a reading is right. Grounding is
# not here: it is a gate, not a contributor. A reading with no region on
# the page cannot be written at all, whatever else it passes.
WEIGHT = {
    "legibility": 1.0,
    "well_formed": 1.0,
    "reread_agreement": 1.0,
    "cross_document": 1.0,
}


def confidence(outcomes: list[CheckOutcome]) -> float:
    """
    How far a reading got through the deterministic layer, 0 to 1.

    The number comes from the checks the reading passed, never from the
    model: a reader's own certainty is the one thing that cannot be
    audited. A check that did not apply, because there was no second
    document or only one pass, is left out of both sides rather than
    counted against the reading.

    Grounding gates this: without a region on the page the score is 0,
    because there is nothing to show a person and nothing to point at.
    """
    if any(c.code == "grounding" and c.failed for c in outcomes):
        return 0.0
    applicable = [c for c in outcomes if c.code in WEIGHT and c.outcome != "not_applicable"]
    if not applicable:
        return 1.0
    total = sum(WEIGHT[c.code] for c in applicable)
    passed = sum(WEIGHT[c.code] for c in applicable if c.outcome == "pass")
    return round(passed / total, 3)


def first_failure(checks: list[CheckOutcome]) -> str | None:
    """
    The confirm reason, named after the first check that failed. Ordered
    so the most concrete explanation wins: a region that cannot be seen
    is a better reason than two readers disagreeing about it.
    """
    for code in ("grounding", "legibility", "well_formed", "reread_agreement", "cross_document"):
        for check in checks:
            if check.code == code and check.failed:
                if code == "well_formed" and check.detail:
                    why = str(check.detail.get("why", ""))
                    if why in ("unknown_unit", "outside_assay_range", "implausible_date"):
                        return why
                return FAILURE_REASON[code]
    return None
