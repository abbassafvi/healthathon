import { describe, expect, it } from 'vitest'

import { CARD, CARD_LANGS, cardDate, REVIEWED, WHEN_LETTERS } from './cardStrings'

function keys(o: unknown, prefix = ''): string[] {
  if (Array.isArray(o)) return [`${prefix}[${o.length}]`]
  if (o && typeof o === 'object') return Object.entries(o).flatMap(([k, v]) => keys(v, prefix ? `${prefix}.${k}` : k))
  return [prefix]
}
const placeholders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort()

describe('SMS card strings', () => {
  it('has the same keys, array lengths and placeholders in every language', () => {
    for (const lang of CARD_LANGS) {
      expect(keys(CARD[lang])).toEqual(keys(CARD.en))
      const walk = (a: unknown, b: unknown) => {
        if (typeof a === 'string') return expect(placeholders(b as string)).toEqual(placeholders(a))
        if (a && typeof a === 'object') for (const k of Object.keys(a)) walk((a as never)[k], (b as never)[k])
      }
      walk(CARD.en, CARD[lang])
    }
  })

  it('marks Hindi and Urdu as not reviewed until a speaker has reviewed them', () => {
    // Flip these to true only after a speaker's review, as the project requires.
    expect(REVIEWED).toEqual({ en: true, hi: false, ur: false })
  })

  it('explains every letter the SMS reader takes for when a reading was taken', () => {
    // The letters in api/src/healthathon/sms/parser.py CONTEXTS.
    expect([...WHEN_LETTERS].sort()).toEqual(['A', 'B', 'F', 'N', 'O', 'R'])
    for (const lang of CARD_LANGS) expect(Object.keys(CARD[lang].reading.when).sort()).toEqual([...WHEN_LETTERS].sort())
  })

  it('says nothing interpretive to the patient, in English', () => {
    expect(JSON.stringify(CARD.en)).not.toMatch(/\b(high|low|normal|good|bad|poor|target|range|average|trend|score|risk|control|well done|great)\b/i)
  })

  it('contains no em or en dashes in any language', () => {
    for (const s of Object.values(CARD)) expect(JSON.stringify(s)).not.toMatch(/[–—]/)
  })

  it('writes a date the way the patient app does, in each language', () => {
    expect(cardDate('2026-10-09T10:05:00+05:30', CARD.en)).toBe('9 October 2026')
    expect(cardDate('2026-10-09T10:05:00+05:30', CARD.hi)).toBe('9 अक्टूबर 2026')
    expect(cardDate('2026-10-09T10:05:00+05:30', CARD.ur)).toBe('9 اکتوبر 2026')
  })
})
