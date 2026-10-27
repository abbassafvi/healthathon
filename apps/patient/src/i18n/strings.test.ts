import { en } from './en'
import { REVIEWED, STRINGS } from './index'

function keys(o: unknown, prefix = ''): string[] {
  if (Array.isArray(o)) return [`${prefix}[${o.length}]`]
  if (o && typeof o === 'object') return Object.entries(o).flatMap(([k, v]) => keys(v, prefix ? `${prefix}.${k}` : k))
  return [prefix]
}
const placeholders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort()

describe('interface strings', () => {
  it('has the same keys, array lengths and placeholders in every language', () => {
    for (const lang of ['hi', 'ur'] as const) {
      expect(keys(STRINGS[lang])).toEqual(keys(en))
    }
    const walk = (a: unknown, b: unknown) => {
      if (typeof a === 'string') return expect(placeholders(b as string)).toEqual(placeholders(a))
      if (a && typeof a === 'object') for (const k of Object.keys(a)) walk((a as never)[k], (b as never)[k])
    }
    walk(en, STRINGS.hi)
    walk(en, STRINGS.ur)
  })

  it('marks Hindi and Urdu as not reviewed until a speaker has reviewed them', () => {
    // Flip these to true only after a speaker's review, as the project requires.
    expect(REVIEWED).toEqual({ en: true, hi: false, ur: false })
  })

  it('says nothing interpretive to the patient, in English', () => {
    const all = JSON.stringify(en)
    expect(all).not.toMatch(/\b(high|low|normal|good|bad|poor|target|range|average|trend|score|risk|control|well done|great)\b/i)
  })

  it('contains no em or en dashes in any language', () => {
    for (const s of Object.values(STRINGS)) expect(JSON.stringify(s)).not.toMatch(/[\u2013\u2014]/)
  })
})
