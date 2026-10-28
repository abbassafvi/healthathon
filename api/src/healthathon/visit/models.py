from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

from healthathon.entries.models import RegimenItemRef

# The visit page. A fixed layout: nothing ranked, highlighted or left out.


class VisitInfo(BaseModel):
    scheduled_for: datetime | None
    clinician_name: str | None


class Period(BaseModel):
    from_: date = Field(serialization_alias="from")
    to: date
    previous_visit: date | None


class TestOrder(BaseModel):
    id: UUID
    analyte_name: str
    ordered_on: date
    # None means there is no matching report in this record.
    matched_value_id: UUID | None


class DayCell(BaseModel):
    date: date
    state: Literal["ticked", "not_ticked", "no_entry"]
    # The tick the cell came from; None for a gap.
    entry_id: UUID | None


class ComplianceRow(BaseModel):
    item: RegimenItemRef
    days: list[DayCell]


class ComplianceScore(BaseModel):
    """
    The one approved score. Computed from medication ticks only, shown to
    clinicians only, and always sent with the day array it came from, so
    the page can recount it.
    """

    id: str
    period_from: date
    period_to: date
    ticked_count: int
    expected_count: int
    score_percent: int
    computed_at: datetime
    rows: list[ComplianceRow]


class VisitSummary(BaseModel):
    visit: VisitInfo
    period: Period
    orders: list[TestOrder]
    compliance: ComplianceScore | None
