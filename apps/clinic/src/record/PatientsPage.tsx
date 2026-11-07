import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router'

import { api, type PatientListItem } from '../api/client'
import { DictateButton } from '../app/DictateButton'
import { LoadError } from '../app/LoadError'
import { BUTTON, PAGE } from '../app/page'
import { useTitle } from '../app/useTitle'
import { formatBooked, formatDate, formatWhen } from '../lib/dates'
import { isTypingTarget } from '../lib/keys'
import { en, fmt } from '../strings/en'

/*
 * Everyone enrolled, by registration number, with what each record holds
 * now: visits, the checklist, what waits for a person and the latest
 * entry. Counts and dates of the record only. Nothing is ranked, sorted
 * by need or coloured, so no patient is singled out by the list.
 */
export function PatientsPage() {
  const query = useQuery({ queryKey: ['patients'], queryFn: api.patients })
  const [params, setParams] = useSearchParams()
  // The field owns what is typed; the address follows it, so a link or a
  // reload keeps the search. Reading the field back from the address would
  // drop keys typed faster than the address updates.
  const [q, setQ] = useState(() => params.get('q') ?? '')
  useEffect(() => {
    // Only when they differ: a navigation on every render would race a click on a row.
    if ((params.get('q') ?? '') !== q) setParams(q ? { q } : {}, { replace: true })
  }, [q, params, setParams])
  const find = useRef<HTMLInputElement>(null)
  useTitle(en.patients.title)

  // "/" jumps to the search field, as in most tools with a list to search.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || isTypingTarget(e.target) || e.ctrlKey || e.metaKey || e.altKey) return
      e.preventDefault()
      find.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const all = query.data ?? []
  const shown = all.filter((p) => matches(p, q))

  return (
    <main className={`${PAGE} pt-8 pb-16`}>
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{en.patients.title}</h1>
          <p className="mt-1 max-w-[65ch] text-sm text-ink-2">{en.patients.intro}</p>
        </div>
        {query.status === 'success' && all.length > 0 && (
          <div className="flex w-full flex-col gap-1.5 sm:w-80">
            <label htmlFor="find-patient" className="label">{en.patients.find}</label>
            <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <input
                id="find-patient"
                ref={find}
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={en.patients.findHint}
                aria-keyshortcuts="/"
                autoComplete="off"
                className="h-9 w-full rounded-lg border border-line-strong bg-surface pr-9 pl-3 text-sm placeholder:text-ink-3"
              />
              {!q && <kbd aria-hidden title={en.patients.findKey} className="kbd pointer-events-none absolute top-1/2 right-2 -translate-y-1/2">/</kbd>}
            </div>
            <DictateButton field={en.patients.find} value={q} onChange={setQ} />
            </div>
          </div>
        )}
      </div>

      {query.status === 'pending' && <div className="mt-8 h-64 rounded-xl bg-sunken" aria-busy="true" />}
      {query.status === 'error' && (
        <LoadError className="mt-8" message={en.patients.loadFailed} onRetry={() => void query.refetch()} retrying={query.isFetching} />
      )}
      {query.status === 'success' && all.length === 0 && <p className="mt-8 text-ink-2">{en.patients.empty}</p>}
      {query.status === 'success' && all.length > 0 && (
        <>
          <p className="numerals mt-8 text-sm text-ink-2" role="status">
            {q
              ? fmt(en.patients.showing, { n: shown.length, total: all.length })
              : all.length === 1 ? en.patients.enrolledOne : fmt(en.patients.enrolled, { n: all.length })}
          </p>
          {shown.length === 0 ? (
            <div className="mt-4 flex flex-wrap items-center gap-4 border-y border-line py-6">
              <p className="text-ink-2">{fmt(en.patients.noMatch, { q })}</p>
              <button type="button" className={BUTTON} onClick={() => { setQ(''); find.current?.focus() }}>
                {en.patients.clear}
              </button>
            </div>
          ) : (
            // Below tablet width each row stacks, its cells labelled, instead of scrolling sideways.
            <div className="mt-2 md:overflow-x-auto" tabIndex={0} role="region" aria-label={en.patients.table}>
              <table className="w-full border-collapse text-left text-sm max-md:block md:min-w-[60rem]">
                <thead className="max-md:hidden">
                  <tr className="border-b border-line">
                    {[en.patients.patient, en.patients.caregiver, en.patients.nextVisit, en.patients.lastVisit,
                      en.patients.checklist, en.patients.waiting, en.patients.lastEntry].map((h) => (
                      <th key={h} scope="col" className="label py-2 pr-5 font-normal whitespace-nowrap last:pr-0">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="max-md:block">
                  {shown.map((p) => <Row key={p.id} p={p} />)}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </main>
  )
}

// A stacked cell on a phone shows its column name above its value.
const STACKED = 'max-md:p-0 max-md:before:mb-0.5 max-md:before:block max-md:before:text-xs max-md:before:text-ink-2 max-md:before:content-[attr(data-label)]'

function Row({ p }: { p: PatientListItem }) {
  const none = (text: string) => <span className="text-ink-3">{text}</span>
  // Each count leads to where it is settled, above the row's own link.
  const waiting = [
    p.waiting_values > 0 && {
      to: '/queue',
      text: p.waiting_values === 1 ? en.patients.valuesOne : fmt(en.patients.values, { n: p.waiting_values }),
    },
    p.waiting_lines > 0 && {
      to: `/patients/${p.id}/checklist`,
      text: p.waiting_lines === 1 ? en.patients.linesOne : fmt(en.patients.lines, { n: p.waiting_lines }),
    },
  ].filter((w) => w !== false)
  return (
    // The name's link stretches over the whole row, so a click anywhere opens the
    // patient while the row stays one link for the keyboard and screen readers.
    <tr className="group relative border-b border-line align-top hover:bg-surface max-md:grid max-md:grid-cols-2 max-md:gap-x-4 max-md:gap-y-3 max-md:py-4">
      <td className="py-3 pr-5 max-md:col-span-2 max-md:p-0">
        <Link
          to={`/patients/${p.id}`}
          className="font-medium text-ink underline-offset-4 after:absolute after:inset-0 after:content-[''] group-hover:underline"
        >
          {p.full_name}
        </Link>
        <p className="numerals mt-0.5 flex flex-wrap gap-x-2 text-xs text-ink-2">
          <span className="font-mono">{p.registration_no}</span>
          {p.year_of_birth && <span>{fmt(en.today.born, { year: p.year_of_birth })}</span>}
          {p.sex && <span>{en.patients.sexes[p.sex] ?? p.sex}</span>}
          <span>{en.entries.languages[p.preferred_language] ?? p.preferred_language}</span>
        </p>
      </td>
      <td data-label={en.patients.caregiver} className={`py-3 pr-5 ${STACKED}`}>
        {p.caregiver ? (
          <>
            <p>{p.caregiver.full_name}</p>
            {p.caregiver.relationship && <p className="text-xs text-ink-2">{p.caregiver.relationship}</p>}
          </>
        ) : none(en.patients.noCaregiver)}
      </td>
      <td data-label={en.patients.nextVisit} className={`numerals py-3 pr-5 whitespace-nowrap ${STACKED}`}>{p.next_visit ? formatBooked(p.next_visit) : none(en.patients.noVisit)}</td>
      <td data-label={en.patients.lastVisit} className={`numerals py-3 pr-5 whitespace-nowrap ${STACKED}`}>{p.last_visit ? formatDate(p.last_visit) : none(en.patients.noVisit)}</td>
      <td data-label={en.patients.checklist} className={`numerals py-3 pr-5 ${STACKED}`}>
        {p.checklist_since ? (
          <>
            <p>{p.checklist_medicines === 1 ? en.patients.medicinesOne : fmt(en.patients.medicines, { n: p.checklist_medicines })}</p>
            <p className="text-xs text-ink-2">{fmt(en.patients.since, { date: formatDate(p.checklist_since) })}</p>
          </>
        ) : none(en.patients.noChecklist)}
      </td>
      <td data-label={en.patients.waiting} className={`numerals py-3 pr-5 ${STACKED}`}>
        {waiting.length ? waiting.map((w) => (
          <p key={w.to}>
            <Link to={w.to} className="relative inline-flex min-h-6 items-center text-accent underline-offset-4 hover:underline">{w.text}</Link>
          </p>
        )) : none(en.patients.nothingWaiting)}
      </td>
      <td data-label={en.patients.lastEntry} className={`numerals py-3 whitespace-nowrap ${STACKED}`}>{p.last_entry_at ? formatWhen(p.last_entry_at) : none(en.patients.noEntries)}</td>
    </tr>
  )
}

function matches(p: PatientListItem, q: string): boolean {
  const needle = q.trim().toLowerCase()
  if (!needle) return true
  return p.full_name.toLowerCase().includes(needle) || p.registration_no.toLowerCase().includes(needle)
}
