import type { ReadCheck } from '../api/client'
import { en } from '../strings/en'

const MARK: Record<string, string> = { pass: '✓', fail: '✕', not_applicable: '○' }

/*
 * The five checks on one value, always in the same order. A check is about
 * the reading, never the patient, and is shown in ink: each outcome has its
 * own words, and the mark only repeats them.
 */
export function Checks({ checks }: { checks: ReadCheck[] }) {
  if (checks.length === 0) return null
  return (
    <ul aria-label={en.reading.checks} className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
      {checks.map((c) => (
        <li key={c.code} data-outcome={c.outcome} className={`flex items-center gap-1.5 ${c.outcome === 'fail' ? 'font-semibold text-ink' : ''}`}>
          <span aria-hidden className="font-mono">{MARK[c.outcome]}</span>
          <span>{en.reading.checkText[c.code]?.[c.outcome] ?? `${c.code}: ${c.outcome}`}</span>
        </li>
      ))}
    </ul>
  )
}
