import { describe, expect, it } from 'vitest'

import { weeksOf } from './weeks'

describe('weeksOf', () => {
  it('starts weeks on Monday and pads the edges', () => {
    // 2026-10-01 is a Thursday; 2026-10-06 is the following Tuesday.
    const w = weeksOf(['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06'])
    expect(w).toEqual([
      [null, null, null, '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04'],
      ['2026-10-05', '2026-10-06', null, null, null, null, null],
    ])
  })

  it('handles an empty period and a single day', () => {
    expect(weeksOf([])).toEqual([])
    expect(weeksOf(['2026-10-05'])).toEqual([['2026-10-05', null, null, null, null, null, null]])
  })

  it('keeps every date exactly once', () => {
    const dates = Array.from({ length: 31 }, (_, i) => `2026-10-${String(i + 1).padStart(2, '0')}`)
    expect(weeksOf(dates).flat().filter(Boolean)).toEqual(dates)
  })
})
