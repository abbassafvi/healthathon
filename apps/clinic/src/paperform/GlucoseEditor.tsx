import type { GlucoseContext } from '../api/pending'
import { formatDate } from '../lib/dates'
import { en, fmt } from '../strings/en'
import type { GlucoseDraft, Problem } from './formModel'

const CONTEXTS: GlucoseContext[] = ['fasting', 'before_meal', 'after_meal', 'bedtime', 'overnight', 'random']
const input = 'h-10 min-w-0 rounded-lg border bg-surface px-3 text-ink aria-[invalid=true]:border-ink aria-[invalid=true]:border-2'

type Props = {
  rows: GlucoseDraft[]
  dates: string[]
  problems: Problem[]
  onChange: (rows: GlucoseDraft[]) => void
}

export function GlucoseEditor({ rows, dates, problems, onChange }: Props) {
  const bad = (f: string) => problems.some((p) => p.field === f)
  const set = (i: number, patch: Partial<GlucoseDraft>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const add = () =>
    onChange([...rows, { key: crypto.randomUUID().slice(0, 8), date: dates[0], time: '', value: '', context: '', insulin: '' }])

  return (
    <div className="flex flex-col gap-3">
      {rows.length === 0 && <p className="text-sm text-ink-2">{en.paperForm.noReadings}</p>}
      {rows.map((g, i) => {
        const id = (f: string) => `glucose-${g.key}-${f}`
        return (
          <fieldset key={g.key} className="grid items-end gap-3 rounded-xl border border-line bg-surface p-3 sm:grid-cols-[10rem_8.5rem_9rem_12rem_10rem_auto] sm:justify-start">
            <legend className="sr-only">{fmt(en.paperForm.reading, { n: i + 1 })}</legend>
            <Field id={id('date')} label={en.paperForm.date}>
              <select id={id('date')} value={g.date} onChange={(e) => set(i, { date: e.target.value })} className={`${input} border-line-strong`}>
                {dates.map((d) => <option key={d} value={d}>{formatDate(d)}</option>)}
              </select>
            </Field>
            <Field id={id('time')} label={en.paperForm.time}>
              <input id={id('time')} type="time" value={g.time} onChange={(e) => set(i, { time: e.target.value })} className={`${input} border-line-strong`} />
            </Field>
            <Field id={id('value')} label={en.paperForm.value}>
              <input id={id('value')} inputMode="decimal" autoComplete="off" value={g.value} aria-invalid={bad(id('value'))}
                onChange={(e) => set(i, { value: e.target.value })} className={`${input} numerals border-line-strong`} />
            </Field>
            <Field id={id('context')} label={en.paperForm.context}>
              <select id={id('context')} value={g.context} aria-invalid={bad(id('context'))} required
                onChange={(e) => set(i, { context: e.target.value as GlucoseContext })} className={`${input} border-line-strong`}>
                <option value="">{en.paperForm.chooseContext}</option>
                {CONTEXTS.map((c) => <option key={c} value={c}>{en.entries.contexts[c]}</option>)}
              </select>
            </Field>
            <Field id={id('insulin')} label={en.paperForm.insulin}>
              <input id={id('insulin')} inputMode="decimal" autoComplete="off" value={g.insulin} aria-invalid={bad(id('insulin'))}
                onChange={(e) => set(i, { insulin: e.target.value })} className={`${input} numerals border-line-strong`} />
            </Field>
            <button type="button" onClick={() => onChange(rows.filter((_, j) => j !== i))}
              className="h-10 rounded-lg border border-line-strong px-3 text-sm text-ink-2 hover:text-ink">
              <span aria-hidden>×</span>
              <span className="sr-only">{fmt(en.paperForm.removeReading, { n: i + 1 })}</span>
            </button>
          </fieldset>
        )
      })}
      <button type="button" onClick={add} className="inline-flex h-9 w-fit items-center rounded-lg border border-line-strong bg-surface px-3.5 text-sm font-medium hover:bg-bg">
        {en.paperForm.addReading}
      </button>
    </div>
  )
}

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className="label">{label}</label>
      {children}
    </div>
  )
}
