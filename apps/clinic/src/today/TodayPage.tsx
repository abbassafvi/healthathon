import { useQuery } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router'

import { api, type DayVisit } from '../api/client'
import { PAGE } from '../app/page'
import { time } from '../entries/ticks'
import { formatDate, formatDateTime } from '../lib/dates'
import { localIsoDate } from '../lib/localDate'
import { en, fmt } from '../strings/en'

const SECONDARY = 'inline-flex h-9 items-center rounded-lg border border-line-strong bg-surface px-3.5 text-sm font-medium hover:bg-bg'
// At least 24 px tall, so two links in one fact are each big enough to hit (WCAG 2.5.8).
const FACT_LINK = 'inline-flex min-h-6 items-center underline-offset-4 hover:underline'

/*
 * The clinic's day: every booked visit in time order, and for each patient
 * what their record holds since their last visit. Counts of the record,
 * never a judgement about the patient: nothing is ranked or flagged.
 */
export function TodayPage() {
  const [params, setParams] = useSearchParams()
  const [today] = useState(() => localIsoDate(new Date()))
  const day = params.get('date') ?? today
  const query = useQuery({ queryKey: ['clinic-day', day], queryFn: () => api.clinicDay(day) })
  const go = (next: string) => setParams(next === today ? {} : { date: next })

  return (
    <main className={`${PAGE} pt-8 pb-16`}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{day === today ? en.today.title : longDay(day)}</h1>
          {day === today && <p className="numerals mt-1 text-ink-2">{longDay(day)}</p>}
        </div>
        <nav aria-label={en.today.dayNav} className="flex gap-2">
          <button type="button" className={SECONDARY} onClick={() => go(shift(day, -1))}>{en.today.previousDay}</button>
          {day !== today && <button type="button" className={SECONDARY} onClick={() => go(today)}>{en.today.backToToday}</button>}
          <button type="button" className={SECONDARY} onClick={() => go(shift(day, 1))}>{en.today.nextDay}</button>
        </nav>
      </div>
      <p className="mt-4 max-w-[65ch] text-sm text-ink-2">{en.today.intro}</p>

      {query.status === 'pending' && <div className="mt-8 h-64 rounded-xl bg-sunken" aria-busy="true" />}
      {query.status === 'error' && <p className="mt-8 text-ink-2">{en.today.loadFailed}</p>}
      {query.status === 'success' && query.data.visits.length === 0 && (
        <p className="mt-8 text-ink-2">{en.today.noVisits}</p>
      )}
      {query.status === 'success' && query.data.visits.length > 0 && (
        <>
          <p className="numerals mt-8 text-sm text-ink-2">{count(query.data.visits.length, en.today.visitsOne, en.today.visits)}</p>
          <ol className="mt-2 border-t border-line">
            {query.data.visits.map((v) => <VisitRow key={v.visit_id} v={v} />)}
          </ol>
        </>
      )}
    </main>
  )
}

function VisitRow({ v }: { v: DayVisit }) {
  const p = v.patient
  const visitPath = `/patients/${p.id}/visit`
  return (
    <li className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-6 gap-y-5 border-b border-line py-6 sm:grid-cols-[5.5rem_minmax(0,1fr)_auto]">
      <p className="numerals font-mono text-2xl leading-8">
        <time dateTime={v.scheduled_for}>{time(v.scheduled_for)}</time>
      </p>
      <div className="min-w-0">
        <h2 className="text-lg leading-8 font-semibold tracking-tight">
          <Link to={visitPath} className="underline-offset-4 hover:underline">{p.full_name}</Link>
        </h2>
        <p className="flex flex-wrap gap-x-4 text-sm text-ink-2">
          <span className="font-mono text-xs leading-5">{p.registration_no}</span>
          {p.year_of_birth && <span className="numerals">{fmt(en.today.born, { year: p.year_of_birth })}</span>}
          {v.clinician_name && <span>{fmt(en.today.with, { name: v.clinician_name })}</span>}
        </p>
      </div>
      <Link to={visitPath} className={`${SECONDARY} col-span-2 w-fit sm:col-span-1 sm:row-start-1 sm:col-start-3`}>
        {en.today.openVisit}
      </Link>

      <div className="col-span-2 sm:col-start-2">
        <p className="text-sm text-ink-3">
          {v.previous_visit
            ? fmt(en.today.sinceVisit, { date: formatDate(v.previous_visit) })
            : fmt(en.today.sinceFirst, { date: formatDate(v.period_from) })}
        </p>
        <dl className="mt-3 grid gap-x-8 gap-y-4 sm:grid-cols-2 xl:grid-cols-4">
        <Fact term={en.today.documents}>
          {v.documents.lab_reports + v.documents.prescriptions === 0 ? (
            <None>{en.today.noDocuments}</None>
          ) : (
            [
              v.documents.lab_reports > 0 && count(v.documents.lab_reports, en.today.labReportsOne, en.today.labReports),
              v.documents.prescriptions > 0 && count(v.documents.prescriptions, en.today.prescriptionsOne, en.today.prescriptions),
            ].filter(Boolean).map((s) => <p key={String(s)}>{s}</p>)
          )}
        </Fact>
        <Fact term={en.today.waiting}>
          {v.waiting.values === 0 && v.waiting.prescription_lines === 0 && <None>{en.today.nothingWaiting}</None>}
          {v.waiting.values > 0 && (
            <p><Link to="/queue" className={`${FACT_LINK} text-accent`}>{count(v.waiting.values, en.today.valuesOne, en.today.values)}</Link></p>
          )}
          {v.waiting.prescription_lines > 0 && v.waiting.review_regimen_id && (
            <p>
              <Link to={`/patients/${p.id}/checklist/review/${v.waiting.review_regimen_id}`} className={`${FACT_LINK} text-accent`}>
                {count(v.waiting.prescription_lines, en.today.linesOne, en.today.lines)}
              </Link>
            </p>
          )}
        </Fact>
        <Fact term={en.today.checklist}>
          {v.checklist.active_since ? (
            <p>
              <Link to={`/patients/${p.id}/checklist`} className={FACT_LINK}>
                {fmt(v.checklist.medicines === 1 ? en.today.medicinesOne : en.today.medicines, { n: v.checklist.medicines, date: formatDate(v.checklist.active_since) })}
              </Link>
            </p>
          ) : (
            <None>{en.today.noChecklist}</None>
          )}
        </Fact>
        <Fact term={en.today.fromPatient}>
          {v.entries.last_at === null ? (
            <None>{en.today.nothingRecorded}</None>
          ) : (
            <>
              <p className="numerals">
                {[
                  count(v.entries.medicine_ticks, en.today.ticksOne, en.today.ticks),
                  count(v.entries.glucose_readings, en.today.readingsOne, en.today.readings),
                  count(v.entries.answers, en.today.answersOne, en.today.answers),
                  count(v.entries.meal_photos, en.today.photosOne, en.today.photos),
                ].join(', ')}
              </p>
              <p className="numerals text-ink-3">{fmt(en.today.lastEntry, { when: formatDateTime(v.entries.last_at) })}</p>
            </>
          )}
        </Fact>
        </dl>
      </div>
    </li>
  )
}

function Fact({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="label">{term}</dt>
      <dd className="mt-1 flex flex-col gap-0.5 text-sm">{children}</dd>
    </div>
  )
}

function None({ children }: { children: ReactNode }) {
  return <p className="text-ink-2">{children}</p>
}

function count(n: number, one: string, many: string): string {
  return n === 1 ? one : fmt(many, { n })
}

function shift(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  return localIsoDate(new Date(y, m - 1, d + days))
}

/* "Tuesday, 27 October 2026" */
function longDay(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}
