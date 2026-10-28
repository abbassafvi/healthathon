import type { ReadCheck } from '../api/client'
import { en, fmt } from '../strings/en'

const MARK: Record<string, string> = { pass: '✓', fail: '✕', not_applicable: '○' }

/*
 * The checks on one value. A failed check is spelled out first, because it
 * is why the value went to a person; the checks that passed are counted in
 * one line (the page names all five once, above); a check that did not
 * apply says why. A check is about the reading, never the patient, and is
 * shown in ink: each line has its own words, and the mark only repeats them.
 */
export function Checks({ checks }: { checks: ReadCheck[] }) {
  if (checks.length === 0) return null
  const failed = checks.filter((c) => c.outcome === 'fail')
  const passed = checks.filter((c) => c.outcome === 'pass').length
  const skipped = checks.filter((c) => c.outcome === 'not_applicable')
  return (
    <ul aria-label={en.reading.checks} className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
      {failed.map((c) => <Check key={c.code} c={c} />)}
      {passed > 0 && (
        <li data-outcome="pass" className="flex items-center gap-1.5">
          <span aria-hidden className="font-mono">{MARK.pass}</span>
          <span>{passedText(passed, checks.length, failed.length)}</span>
        </li>
      )}
      {skipped.map((c) => <Check key={c.code} c={c} />)}
    </ul>
  )
}

function Check({ c }: { c: ReadCheck }) {
  return (
    <li data-outcome={c.outcome} className={`flex items-center gap-1.5 ${c.outcome === 'fail' ? 'font-semibold text-ink' : ''}`}>
      <span aria-hidden className="font-mono">{MARK[c.outcome]}</span>
      <span>{en.reading.checkText[c.code]?.[c.outcome] ?? `${c.code}: ${c.outcome}`}</span>
    </li>
  )
}

function passedText(n: number, of: number, failed: number): string {
  if (n === of) return fmt(en.reading.passedAll, { n })
  if (failed > 0) return n === 1 ? en.reading.passedOtherOne : fmt(en.reading.passedOther, { n })
  return n === 1 ? en.reading.passedOne : fmt(en.reading.passed, { n })
}
