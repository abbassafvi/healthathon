import { describe, expect, it } from 'vitest'

import { formatDate, formatDateTime, formatWhen } from './dates'

describe('formatDate', () => {
  it('formats a calendar date without shifting it across time zones', () => {
    expect(formatDate('2026-10-12')).toBe('12 Oct 2026')
    expect(formatDate('2026-01-01')).toBe('1 Jan 2026')
    expect(formatDate('2026-12-31')).toBe('31 Dec 2026')
  })

  it('ignores a time part', () => {
    expect(formatDate('2026-10-12T23:59:00Z')).toBe('12 Oct 2026')
  })
})

describe('formatDateTime', () => {
  it('includes the day and a 24-hour time', () => {
    expect(formatDateTime('2026-10-21T14:02:00')).toMatch(/^21 Oct 2026,? 14:02$/)
  })
})

describe('formatWhen', () => {
  const now = new Date(2026, 9, 28, 9, 0)
  it('names today, tomorrow and yesterday in words', () => {
    expect(formatWhen('2026-10-28T10:00:00', now)).toBe('Today, 10:00')
    expect(formatWhen('2026-10-29T10:30:00', now)).toBe('Tomorrow, 10:30')
    expect(formatWhen('2026-10-27T21:40:00', now)).toBe('Yesterday, 21:40')
  })

  it('gives a date for anything further away', () => {
    expect(formatWhen('2026-10-20T08:15:00', now)).toMatch(/^20 Oct 2026,? 08:15$/)
  })
})
