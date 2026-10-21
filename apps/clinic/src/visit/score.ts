import type { ComplianceScore } from '../api/pending'

/*
 * Recount a score from its own day array. The stored figures are shown
 * only if this recount agrees with them; otherwise the page says so.
 */
export function recount(score: ComplianceScore): { ticked: number; expected: number; percent: number; matches: boolean } {
  const cells = score.rows.flatMap((r) => r.days)
  const ticked = cells.filter((c) => c.state === 'ticked').length
  const expected = cells.length
  const percent = expected ? Math.round((ticked / expected) * 100) : 0
  return {
    ticked,
    expected,
    percent,
    matches: ticked === score.ticked_count && expected === score.expected_count && percent === score.score_percent,
  }
}
