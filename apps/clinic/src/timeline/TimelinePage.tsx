import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useParams } from 'react-router'

import { api, type RecordDocument } from '../api/client'
import type { PatientEntry, TickEntry } from '../api/client'
import { AnswerRow, GlucoseRow, MealRow } from '../entries/EntryRows'
import { TicksForDay } from '../entries/TicksForDay'
import { itemsOn } from '../entries/ticks'
import { formatDate } from '../lib/dates'
import { localIsoDate } from '../lib/localDate'
import { en, fmt } from '../strings/en'
import { PAGE } from '../app/page'

const WEEKS = 4

function rangeEnding(end: Date, weeks: number) {
  const start = new Date(end)
  start.setDate(start.getDate() - weeks * 7 + 1)
  return { from: localIsoDate(start), to: localIsoDate(end) }
}

function daysBetween(from: string, to: string): string[] {
  const out: string[] = []
  const d = new Date(`${to}T12:00:00`)
  while (localIsoDate(d) >= from) {
    out.push(localIsoDate(d))
    d.setDate(d.getDate() - 1)
  }
  return out
}

function weekday(day: string): string {
  return new Date(`${day}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short' })
}

/*
 * The patient's record in date order. Each day keeps documents and the
 * patient's own entries in separate columns, because the two are never
 * merged (schema rule R5): one is verified against a page, the other is
 * stored as the patient gave it. Nothing is ranked or summarised.
 */
export function TimelinePage() {
  const { patientId } = useParams() as { patientId: string }
  const [weeks, setWeeks] = useState(WEEKS)
  const [today] = useState(() => new Date())
  const range = rangeEnding(today, weeks)
  const record = useQuery({ queryKey: ['record', patientId], queryFn: () => api.record(patientId) })
  const entries = useQuery({
    queryKey: ['entries', patientId, range.from, range.to],
    queryFn: () => api.entries(patientId, range),
    placeholderData: (prev) => prev,
  })

  if (record.isError || entries.isError) {
    return <Shell><p className="text-ink-2">{en.timeline.loadFailed}</p></Shell>
  }
  if (!record.data || !entries.data) {
    return <Shell><div className="h-96 rounded-xl bg-sunken" aria-busy="true" /></Shell>
  }

  const docsByDay = new Map<string, RecordDocument[]>()
  for (const d of record.data.documents) {
    if (!d.document_date || d.document_date < range.from || d.document_date > range.to) continue
    docsByDay.set(d.document_date, [...(docsByDay.get(d.document_date) ?? []), d])
  }
  const byDay = new Map<string, PatientEntry[]>()
  for (const e of entries.data.entries) {
    const day = e.kind === 'medication_tick' ? e.tick_date : e.occurred_at.slice(0, 10)
    byDay.set(day, [...(byDay.get(day) ?? []), e])
  }
  const days = daysBetween(range.from, range.to)
  const anything = docsByDay.size > 0 || entries.data.entries.length > 0 || entries.data.regimen_items.length > 0

  return (
    <Shell>
      <p className="mb-4 flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-2">
        <span>{fmt(en.timeline.range, { from: formatDate(range.from), to: formatDate(range.to) })}</span>
        <span className="text-ink-3">{en.entries.defaultSource}</span>
      </p>
      {!anything ? (
        <p className="rounded-xl border border-line bg-surface px-6 py-8 text-ink-2">{en.timeline.empty}</p>
      ) : (
        <>
          <div aria-hidden className="sticky top-14 z-(--z-sticky) hidden grid-cols-[7rem_minmax(0,1fr)_minmax(0,1fr)] gap-6 border-b border-line bg-bg py-2 md:grid">
            <span />
            <span className="label">{en.entries.fromDocuments}</span>
            <span className="label">{en.entries.fromPatient}</span>
          </div>
          <ol>
            {days.map((day) => (
              <Day
                key={day}
                day={day}
                patientId={patientId}
                docs={docsByDay.get(day) ?? []}
                entries={byDay.get(day) ?? []}
                items={entries.data.regimen_items}
              />
            ))}
          </ol>
          <button
            type="button"
            onClick={() => setWeeks((w) => w + WEEKS)}
            disabled={entries.isFetching}
            className="mt-6 inline-flex h-9 items-center rounded-lg border border-line-strong bg-surface px-3.5 text-sm font-medium hover:bg-bg disabled:text-ink-3"
          >
            {en.timeline.earlier}
          </button>
        </>
      )}
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main className={`${PAGE} pt-6 pb-16`}>{children}</main>
}

type DayProps = {
  day: string
  patientId: string
  docs: RecordDocument[]
  entries: PatientEntry[]
  items: Parameters<typeof itemsOn>[0]
}

function Day({ day, patientId, docs, entries, items }: DayProps) {
  const ticks = entries.filter((e): e is TickEntry => e.kind === 'medication_tick')
  const others = entries.filter((e) => e.kind !== 'medication_tick')
  const hasTicks = itemsOn(items, day).length > 0
  const patientSide = hasTicks || others.length > 0
  return (
    <li data-day={day} className="grid gap-x-6 gap-y-3 border-b border-line py-4 md:grid-cols-[7rem_minmax(0,1fr)_minmax(0,1fr)]">
      <h2 className="flex items-baseline gap-2 md:flex-col md:gap-0">
        <span className="text-sm font-semibold">{weekday(day)}</span>
        <span className="numerals text-sm text-ink-2">{formatDate(day)}</span>
      </h2>
      <section
        aria-label={`${en.entries.fromDocuments}, ${formatDate(day)}`}
        className={`flex-col gap-3 ${docs.length ? 'flex' : 'hidden md:flex'}`}
      >
        <p className="label md:hidden">{en.entries.fromDocuments}</p>
        {docs.map((d) => (
          <div key={d.id}>
            <p className="text-sm font-medium">
              {en.docTypes[d.doc_type] ?? en.docTypes.other}
              {d.issuing_source && <span className="font-normal text-ink-3">, {d.issuing_source}</span>}
            </p>
            <ul className="mt-1">
              {d.values.map((v) => (
                <li key={v.id}>
                  <Link
                    to={`/patients/${patientId}/documents/values/${v.id}`}
                    aria-label={fmt(en.timeline.valueLink, { test: v.analyte_name, value: [v.value_text, v.unit_text].filter(Boolean).join(' ') })}
                    className="-mx-2 flex items-baseline justify-between gap-3 rounded-md px-2 py-1 text-sm hover:bg-surface"
                  >
                    <span>{v.analyte_name}</span>
                    <span className="numerals">
                      <span className="font-semibold">{v.value_text}</span> <span className="text-ink-3">{v.unit_text}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>
      <section aria-label={`${en.entries.fromPatient}, ${formatDate(day)}`} className="flex flex-col gap-3">
        {docs.length > 0 && <p className="label md:hidden">{en.entries.fromPatient}</p>}
        <TicksForDay day={day} items={items} ticks={ticks} />
        {others.map((e) =>
          e.kind === 'glucose_reading' ? <GlucoseRow key={e.id} e={e} />
          : e.kind === 'survey_answer' ? <AnswerRow key={e.id} e={e} />
          : e.kind === 'meal_photo' ? <MealRow key={e.id} e={e} />
          : null,
        )}
        {!patientSide && <p className="text-sm text-ink-3">{en.entries.nothingThisDay}</p>}
      </section>
    </li>
  )
}
