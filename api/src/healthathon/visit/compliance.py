from datetime import date, datetime, timedelta
from uuid import UUID

from healthathon.entries.models import RegimenItemRef
from healthathon.visit.models import ComplianceRow, ComplianceScore, DayCell

# (regimen item id, day) -> (ticked, entry id)
Ticks = dict[tuple[UUID, date], tuple[bool, UUID]]


def compute(
    regimen_id: UUID,
    items: list[RegimenItemRef],
    first: date,
    last: date,
    ticks: Ticks,
    computed_at: datetime,
) -> ComplianceScore:
    """
    Arithmetic over recorded ticks, and nothing else. Each item on each day
    of the period is one cell: ticked, not ticked, or no entry. The score is
    ticked cells over all cells. A gap counts as not ticked and stays a gap
    in the day array, so the figure can always be traced to its cells.
    """
    days = [first + timedelta(days=n) for n in range((last - first).days + 1)]
    rows = []
    for item in items:
        cells = []
        for day in days:
            hit = ticks.get((item.id, day))
            if hit is None:
                cells.append(DayCell(date=day, state="no_entry", entry_id=None))
            else:
                cells.append(
                    DayCell(date=day, state="ticked" if hit[0] else "not_ticked", entry_id=hit[1])
                )
        rows.append(ComplianceRow(item=item, days=cells))
    all_cells = [c for r in rows for c in r.days]
    ticked = sum(1 for c in all_cells if c.state == "ticked")
    expected = len(all_cells)
    return ComplianceScore(
        id=f"{regimen_id}:{first.isoformat()}:{last.isoformat()}",
        period_from=first,
        period_to=last,
        ticked_count=ticked,
        expected_count=expected,
        # Half up, the same rounding as the page's recount (Math.round).
        score_percent=(ticked * 200 + expected) // (expected * 2) if expected else 0,
        computed_at=computed_at,
        rows=rows,
    )
