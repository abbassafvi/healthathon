import { describe, expect, it } from 'vitest'

import type { PatientEntry } from '../api/pending'
import { recount } from '../visit/score'
import { computeScore } from './compliance'
import { mockState, resetMockState } from './state'

const NOW = new Date('2026-10-21T09:00:00')

describe('computeScore (mock of the Track A computation)', () => {
  resetMockState(NOW)
  const regimen = mockState().regimens.find((r) => r.id === 'rx-0001-a')!
  const entries = mockState().entries['DEV-0001']

  it('agrees with a recount of its own day array', () => {
    const s = computeScore(regimen, entries, '2026-09-24', '2026-10-21', NOW)!
    expect(recount(s).matches).toBe(true)
    expect(s.expected_count).toBe(s.rows.length * s.rows[0].days.length)
  })

  it('starts the period at activation, not before', () => {
    const s = computeScore(regimen, entries, '2026-09-24', '2026-10-21', NOW)!
    expect(s.period_from).toBe('2026-10-02')
    expect(s.rows[0].days[0].date).toBe('2026-10-02')
  })

  it('counts ticks only: glucose readings and answers change nothing', () => {
    const ticksOnly = entries.filter((e) => e.kind === 'medication_tick')
    const a = computeScore(regimen, entries, '2026-09-24', '2026-10-21', NOW)!
    const b = computeScore(regimen, ticksOnly, '2026-09-24', '2026-10-21', NOW)!
    expect(b.ticked_count).toBe(a.ticked_count)
    expect(b.score_percent).toBe(a.score_percent)
  })

  it('links every ticked cell to the entry it came from, and leaves gaps empty', () => {
    const s = computeScore(regimen, entries, '2026-09-24', '2026-10-21', NOW)!
    const ids = new Set(entries.map((e: PatientEntry) => e.id))
    for (const c of s.rows.flatMap((r) => r.days)) {
      if (c.state === 'no_entry') expect(c.entry_id).toBeNull()
      else expect(ids.has(c.entry_id!)).toBe(true)
    }
  })

  it('returns no score without an active checklist', () => {
    expect(computeScore(undefined, entries, '2026-09-24', '2026-10-21', NOW)).toBeNull()
  })
})

describe('recount', () => {
  resetMockState(NOW)
  const s = computeScore(mockState().regimens[0], mockState().entries['DEV-0001'], '2026-09-24', '2026-10-21', NOW)!

  it('flags a stored count that does not match the days', () => {
    expect(recount({ ...s, ticked_count: s.ticked_count + 1 }).matches).toBe(false)
    expect(recount({ ...s, expected_count: s.expected_count - 1 }).matches).toBe(false)
    expect(recount({ ...s, score_percent: s.score_percent + 1 }).matches).toBe(false)
  })
})
