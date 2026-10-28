import { useRef, useState } from 'react'

import type { ComplianceScore, DayCell, PatientEntry } from '../api/client'
import { Source } from '../entries/EntryRows'
import { TickMark } from '../entries/TicksForDay'
import { time } from '../entries/ticks'
import { formatDate } from '../lib/dates'
import { en, fmt } from '../strings/en'
import { weeksOf } from './weeks'

const STATE: Record<string, string> = { ticked: en.entries.ticked, not_ticked: en.entries.notTicked, no_entry: en.entries.noEntry }
const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

type Pos = { row: number; col: number }

/*
 * The day array a score was computed from, laid out by week: for each
 * week, one row per medicine and one cell per day. Every cell traces to a
 * tick or is a gap. It is one grid for assistive technology: arrow keys
 * move between cells across weeks, with one tab stop for the whole grid.
 */
export function DayArray({ score, entries }: { score: ComplianceScore; entries: PatientEntry[] }) {
  const weeks = weeksOf(score.rows[0]?.days.map((d) => d.date) ?? [])
  const meds = score.rows.length
  // Flat rows: week 0 medicine 0..n, week 1 medicine 0..n, and so on.
  const cellAt = (row: number, col: number): { cell: DayCell; med: number } | null => {
    const week = weeks[Math.floor(row / meds)]
    const date = week?.[col]
    if (!date) return null
    const med = row % meds
    const cell = score.rows[med].days.find((d) => d.date === date)
    return cell ? { cell, med } : null
  }
  const lastRow = weeks.length * meds - 1
  const lastCol = (weeks.at(-1) ?? []).reduce((acc, d, i) => (d ? i : acc), 0)
  const [at, setAt] = useState<Pos>({ row: lastRow - meds + 1, col: lastCol })
  const [selected, setSelected] = useState<Pos | null>(null)
  const buttons = useRef(new Map<string, HTMLButtonElement>())

  const focus = (p: Pos) => {
    setAt(p)
    buttons.current.get(`${p.row}:${p.col}`)?.focus()
  }
  // Step in one direction, skipping blank cells outside the period.
  const step = (dr: number, dc: number) => {
    let { row, col } = at
    for (let i = 0; i < 8 * (lastRow + 1); i++) {
      row += dr
      col += dc
      if (col > 6) { col = 0; row += 1 } else if (col < 0) { col = 6; row -= 1 }
      if (row < 0 || row > lastRow) return
      if (cellAt(row, col)) return focus({ row, col })
      if (dr !== 0) return
    }
  }
  const onKey = (e: React.KeyboardEvent) => {
    const k: Record<string, [number, number]> = { ArrowRight: [0, 1], ArrowLeft: [0, -1], ArrowDown: [1, 0], ArrowUp: [-1, 0] }
    if (k[e.key]) {
      e.preventDefault()
      step(...k[e.key])
    }
  }

  const pick = selected && cellAt(selected.row, selected.col)
  const pickItem = pick && score.rows[pick.med].item
  const pickEntry = pick?.cell.entry_id ? entries.find((x) => x.id === pick.cell.entry_id) : undefined

  return (
    <div className="flex flex-col gap-3">
      <table role="grid" aria-label={en.visit.dayArray} onKeyDown={onKey} className="w-full max-w-[30rem] border-separate border-spacing-0">
        {weeks.map((week, w) => (
          <tbody key={w}>
            <tr>
              <th scope="col" className="pt-3 text-left first:pt-0">
                <span className="sr-only">{en.entries.medicines}</span>
              </th>
              {week.map((date, i) => (
                <th key={i} scope="col" className="px-0.5 pt-3 text-center font-normal">
                  {date && <span className="sr-only">{formatDate(date)}</span>}
                  <span aria-hidden className="numerals block font-mono text-xs leading-tight text-ink-3">
                    {WEEKDAYS[i]}
                    <br />
                    {date ? Number(date.slice(8)) : ''}
                  </span>
                </th>
              ))}
            </tr>
            {score.rows.map((r, m) => {
              const row = w * meds + m
              return (
                <tr key={r.item.id}>
                  <th scope="row" className="truncate pr-3 text-left text-sm font-normal whitespace-nowrap">
                    {r.item.drug_text} <span className="numerals text-ink-2">{r.item.dose_text}</span>
                  </th>
                  {week.map((date, col) => {
                    const hit = date ? cellAt(row, col) : null
                    if (!hit) return <td key={col} className="p-0" />
                    const isSel = selected?.row === row && selected.col === col
                    return (
                      <td key={col} className="p-0 text-center">
                        <button
                          type="button"
                          ref={(el) => {
                            if (el) buttons.current.set(`${row}:${col}`, el)
                            else buttons.current.delete(`${row}:${col}`)
                          }}
                          tabIndex={at.row === row && at.col === col ? 0 : -1}
                          aria-label={fmt(en.visit.cellLabel, { drug: r.item.drug_text, date: formatDate(hit.cell.date), state: STATE[hit.cell.state] })}
                          aria-pressed={isSel}
                          data-cell-state={hit.cell.state}
                          data-date={hit.cell.date}
                          onClick={() => {
                            setAt({ row, col })
                            setSelected(isSel ? null : { row, col })
                          }}
                          className={`mx-auto grid size-7 place-items-center rounded-md ${isSel ? 'bg-accent-soft ring-2 ring-accent' : 'hover:bg-sunken'}`}
                        >
                          <TickMark state={hit.cell.state} />
                        </button>
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        ))}
      </table>
      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-2" aria-label={en.visit.legend}>
        {(['ticked', 'not_ticked', 'no_entry'] as const).map((s) => (
          <span key={s} className="flex items-center gap-1.5"><TickMark state={s} />{STATE[s]}</span>
        ))}
      </p>
      <div aria-live="polite" className="min-h-[2.75rem] text-sm">
        {pick && pickItem && (
          <div className="rounded-lg border border-line bg-surface px-3 py-2" data-testid="cell-detail">
            <p className="font-medium">
              {pickItem.drug_text} {pickItem.dose_text}, {formatDate(pick.cell.date)}
            </p>
            <p className="text-ink-2">
              {pickEntry ? (
                <>
                  {fmt(en.visit.cellDetailTick, { state: STATE[pick.cell.state], time: time(pickEntry.occurred_at) })}{' '}
                  <Source e={pickEntry} />
                </>
              ) : (
                en.visit.cellDetailGap
              )}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
