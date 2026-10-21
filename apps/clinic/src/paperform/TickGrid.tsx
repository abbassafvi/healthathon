import { useRef, useState } from 'react'

import type { RegimenItemSpan } from '../entries/ticks'
import { TickMark } from '../entries/TicksForDay'
import { formatDate } from '../lib/dates'
import { en, fmt } from '../strings/en'
import { cellKey, nextCell, type CellValue } from './formModel'

type Props = {
  items: RegimenItemSpan[]
  dates: string[]
  cells: Record<string, CellValue>
  /* Cells the patient already filled in the app: shown, never editable. */
  locked: Record<string, 'ticked' | 'not_ticked'>
  onChange: (key: string, v: CellValue) => void
}

const WORD: Record<CellValue, string> = { ticked: en.entries.ticked, not_ticked: en.entries.notTicked, blank: en.paperForm.blank }

/*
 * The medicine boxes of a paper form, one row per medicine and one column
 * per day. One tab stop; arrows move, Space cycles, T / N / Delete set.
 */
export function TickGrid({ items, dates, cells, locked, onChange }: Props) {
  const [at, setAt] = useState({ r: 0, c: 0 })
  const refs = useRef(new Map<string, HTMLButtonElement>())

  const focus = (r: number, c: number) => {
    const rr = Math.max(0, Math.min(items.length - 1, r))
    const cc = Math.max(0, Math.min(dates.length - 1, c))
    setAt({ r: rr, c: cc })
    refs.current.get(`${rr}:${cc}`)?.focus()
  }
  const onKey = (e: React.KeyboardEvent, r: number, c: number, key: string, isLocked: boolean) => {
    const move: Record<string, [number, number]> = { ArrowRight: [0, 1], ArrowLeft: [0, -1], ArrowDown: [1, 0], ArrowUp: [-1, 0] }
    if (move[e.key]) {
      e.preventDefault()
      return focus(r + move[e.key][0], c + move[e.key][1])
    }
    if (isLocked) return
    const set: Record<string, CellValue> = { t: 'ticked', n: 'not_ticked', Delete: 'blank', Backspace: 'blank' }
    const v = set[e.key.length === 1 ? e.key.toLowerCase() : e.key]
    if (v) {
      e.preventDefault()
      onChange(key, v)
    }
  }

  return (
    <table role="grid" aria-label={en.paperForm.medicines} className="border-separate border-spacing-1">
      <thead>
        <tr>
          <th scope="col"><span className="sr-only">{en.entries.medicines}</span></th>
          {dates.map((d) => (
            <th key={d} scope="col" className="px-1 text-center text-xs font-normal text-ink-2">
              <span className="block">{new Date(`${d}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short' })}</span>
              <span className="numerals font-mono text-ink-3">{Number(d.slice(8))}</span>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {items.map((item, r) => (
          <tr key={item.id}>
            <th scope="row" className="pr-3 text-left text-sm font-normal whitespace-nowrap">
              {item.drug_text} <span className="numerals text-ink-2">{item.dose_text}</span>
            </th>
            {dates.map((date, c) => {
              const key = cellKey(item.id, date)
              const lockedState = locked[key]
              const active = item.active_from <= date && (!item.active_until || item.active_until > date)
              if (!active) return <td key={date} />
              const value = (lockedState ?? cells[key] ?? 'blank') as CellValue
              return (
                <td key={date} className="p-0">
                  <button
                    type="button"
                    ref={(el) => {
                      if (el) refs.current.set(`${r}:${c}`, el)
                      else refs.current.delete(`${r}:${c}`)
                    }}
                    tabIndex={at.r === r && at.c === c ? 0 : -1}
                    aria-disabled={lockedState ? true : undefined}
                    aria-label={
                      fmt(en.paperForm.cellLabel, { drug: item.drug_text, date: formatDate(date), state: WORD[value] }) +
                      (lockedState ? `. ${en.paperForm.lockedFromApp}` : '')
                    }
                    title={lockedState ? en.paperForm.lockedFromApp : undefined}
                    data-cell={key}
                    data-value={value}
                    data-locked={lockedState ? 'true' : undefined}
                    onFocus={() => setAt({ r, c })}
                    onClick={() => !lockedState && onChange(key, nextCell(value))}
                    onKeyDown={(e) => onKey(e, r, c, key, !!lockedState)}
                    className={`grid size-10 place-items-center rounded-lg border ${
                      lockedState ? 'cursor-not-allowed border-dashed border-line bg-sunken' : 'border-line-strong bg-surface hover:border-ink-3'
                    }`}
                  >
                    {value === 'blank' ? <span aria-hidden className="size-3" /> : <TickMark state={value} />}
                  </button>
                </td>
              )
            })}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
