"""
The document agent: what a detected region says.

One agent per document type, because a prescription and a laboratory
report are read by different conventions. Both obey the same rule: every
reading cites the index of the region it came from. A reading that cites
no region cannot be traced back to the page, so it is never stored as a
value; it goes to a person instead.
"""

from dataclasses import dataclass, field
from datetime import date
from pathlib import Path
from typing import Literal, Protocol

from healthathon.uploads.detector import Box

DocType = Literal["prescription", "lab_report"]


@dataclass(frozen=True)
class Crop:
    """
    One detected region, cut out of the page and saved.

    `path` is the region as it appears on the page: what the legibility
    check measures and what a clinician is shown. `labelled` is the same
    region with its index printed on top, which only the agent sees. A
    label is edges, and edges are what legibility counts, so the two
    must not be the same file.
    """

    index: int
    path: Path
    storage_key: str
    labelled: Path
    # Where on the page it was cut from. A reader that works on the
    # whole page needs this to say which region a reading belongs to.
    box: Box


@dataclass(frozen=True)
class LabValue:
    """One analyte as printed, and the region it was read from."""

    box_index: int
    analyte_code: str
    value_text: str
    unit_text: str | None = None


@dataclass(frozen=True)
class RegimenLine:
    """One prescription line as printed, and the region it was read from."""

    box_index: int
    drug_text: str
    dose_text: str
    schedule_text: str | None = None


@dataclass(frozen=True)
class RequestedTest:
    """A test the document asks for, as distinct from one it reports."""

    box_index: int
    analyte_code: str


@dataclass
class DocumentReading:
    """Everything one agent made of one page."""

    values: list[LabValue] = field(default_factory=list)
    lines: list[RegimenLine] = field(default_factory=list)
    orders: list[RequestedTest] = field(default_factory=list)
    document_date: date | None = None
    issuing_source: str | None = None
    # Regions the agent was shown but would not commit to, by index. These
    # reach a person with their crop rather than being dropped in silence.
    unreadable: list[int] = field(default_factory=list)
    # Regions a reading was filed against without the match being clear.
    # The reading is kept; its grounding check is what fails.
    ungrounded: list[int] = field(default_factory=list)


class DocumentAgent(Protocol):
    """Reads the crops of one document. Never sees the patient's record."""

    name: str

    @property
    def version(self) -> str:
        """Read after the call: a fallback can change which model answered."""

    def read(self, doc_type: DocType, page: Path, crops: list[Crop]) -> DocumentReading: ...


def drop_ungrounded(reading: DocumentReading, box_count: int) -> DocumentReading:
    """
    Throw away anything citing a region that does not exist. A model that
    invents an index has invented the value with it, and an invented value
    has nothing to point at on the page.
    """
    ok = range(box_count)
    return DocumentReading(
        values=[v for v in reading.values if v.box_index in ok],
        lines=[line for line in reading.lines if line.box_index in ok],
        orders=[o for o in reading.orders if o.box_index in ok],
        document_date=reading.document_date,
        issuing_source=reading.issuing_source,
        unreadable=sorted({i for i in reading.unreadable if i in ok}),
    )
