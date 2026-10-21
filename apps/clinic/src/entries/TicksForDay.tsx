import type { TickEntry } from '../api/pending'
import { en } from '../strings/en'
import { Source } from './EntryRows'
import { itemsOn, tickState, type RegimenItemSpan, type TickState } from './ticks'

export function TickMark({ state }: { state: TickState }) {
  // Shape carries the state, with the word beside it; colour never does.
  if (state === 'ticked') return <span aria-hidden className="size-3 shrink-0 rounded-full bg-ink" />
  if (state === 'not_ticked') return <span aria-hidden className="size-3 shrink-0 rounded-full border-2 border-ink" />
  return <span aria-hidden className="size-3 shrink-0 rounded-full border border-dashed border-ink-3" />
}

const LABEL: Record<TickState, string> = {
  ticked: en.entries.ticked,
  not_ticked: en.entries.notTicked,
  no_entry: en.entries.noEntry,
}

export function TicksForDay({ day, items, ticks }: { day: string; items: RegimenItemSpan[]; ticks: TickEntry[] }) {
  const on = itemsOn(items, day)
  if (on.length === 0) return null
  const first = ticks.find((t) => t.tick_date === day)
  return (
    <div className="grid grid-cols-[3rem_minmax(0,1fr)] gap-x-3">
      <span />
      <div>
        <p className="label mb-1">{en.entries.medicines}</p>
        <ul className="flex flex-col gap-1">
          {on.map((item) => {
            const { state } = tickState(ticks, item.id, day)
            return (
              <li key={item.id} className="flex items-center gap-2 text-sm" data-tick-state={state}>
                <TickMark state={state} />
                <span className={state === 'no_entry' ? 'text-ink-2' : 'text-ink'}>
                  {item.drug_text} <span className="numerals">{item.dose_text}</span>
                </span>
                <span className="text-ink-3">{LABEL[state]}</span>
              </li>
            )
          })}
        </ul>
        {first && <Source e={first} />}
      </div>
    </div>
  )
}
