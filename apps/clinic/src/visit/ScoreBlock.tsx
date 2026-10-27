import { useState } from 'react'

import type { ComplianceScore, PatientEntry } from '../api/pending'
import { formatDate } from '../lib/dates'
import { en, fmt } from '../strings/en'
import { DayArray } from './DayArray'
import { recount } from './score'

/*
 * The compliance score, led by the count it is made of ("24 of 28 ticks")
 * with the percentage beside it. It is only shown if it agrees with a
 * recount of its own day array, and the day array is one tap away.
 */
export function ScoreBlock({ score, entries }: { score: ComplianceScore | null; entries: PatientEntry[] }) {
  const [open, setOpen] = useState(false)
  if (!score) return <p className="text-sm text-ink-2">{en.visit.noScore}</p>
  const check = recount(score)

  return (
    <div className="flex flex-col gap-3">
      {check.matches ? (
        <p className="flex flex-wrap items-baseline gap-x-4">
          <span className="numerals text-4xl font-semibold tracking-tight" data-testid="score-count">
            {fmt(en.visit.scoreOf, { ticked: score.ticked_count, expected: score.expected_count })}
          </span>
          <span className="numerals text-xl text-ink-2" data-testid="score-percent">
            {fmt(en.visit.scorePercent, { percent: score.score_percent })}
          </span>
        </p>
      ) : (
        <p role="alert" className="rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm">{en.visit.scoreMismatch}</p>
      )}
      <p className="max-w-[62ch] text-sm text-ink-2">
        {fmt(en.visit.scoreExplain, { from: formatDate(score.period_from), to: formatDate(score.period_to) })}
      </p>
      {check.matches && (
        <button
          type="button"
          aria-expanded={open}
          aria-controls="day-array"
          onClick={() => setOpen((o) => !o)}
          className="inline-flex h-9 w-fit items-center rounded-lg border border-line-strong bg-surface px-3.5 text-sm font-medium hover:bg-bg"
        >
          {open ? en.visit.hideDays : en.visit.showDays}
        </button>
      )}
      <div id="day-array" hidden={check.matches && !open}>
        {(open || !check.matches) && <DayArray score={score} entries={entries} />}
      </div>
    </div>
  )
}
