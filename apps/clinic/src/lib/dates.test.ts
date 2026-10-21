import { describe, expect, it } from 'vitest'

import { formatDate, formatDateTime } from './dates'

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
