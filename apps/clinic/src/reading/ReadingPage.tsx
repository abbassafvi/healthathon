import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useParams } from 'react-router'

import { api, type DocumentReading, type ReadLine, type ReadValue } from '../api/client'
import { PAGE } from '../app/page'
import { formatDate, formatDateTime } from '../lib/dates'
import { en, fmt } from '../strings/en'
import { PageViewer } from '../trace/PageViewer'
import { Checks } from './Checks'

/*
 * How one document was read: the page with every region the reader found,
 * and for each value where it went and why. It answers, for one page, how
 * much reached the record as fact and how much went to a person. A value
 * still waiting for a person is named, never shown.
 */
export function ReadingPage() {
  const { patientId, documentId } = useParams() as { patientId: string; documentId: string }
  const query = useQuery({ queryKey: ['reading', documentId], queryFn: () => api.reading(documentId) })
  const [focus, setFocus] = useState(-1)

  if (query.status === 'pending') return <main className={`${PAGE} pt-6`}><div className="h-96 rounded-xl bg-sunken" aria-busy="true" /></main>
  if (query.status === 'error') return <main className={`${PAGE} pt-6`}><p className="text-ink-2">{en.reading.loadFailed}</p></main>

  const r = query.data
  const doc = r.document
  const page = r.pages[0]
  const regions = r.values.length ? r.values : r.lines
  const marks = regions.flatMap((v, i) => (v.box ? [{ box: v.box, label: String(i + 1) }] : []))

  return (
    <main className={`${PAGE} pt-6 pb-16`}>
      <Link to={`/patients/${patientId}/documents`} className="text-sm text-ink-2 underline-offset-4 hover:text-ink hover:underline">
        {en.reading.back}
      </Link>
      <h2 className="mt-3 text-xl font-semibold tracking-tight">{en.reading.title}</h2>
      <p className="mt-1 text-sm text-ink-2">
        <span className="font-medium text-ink">{en.docTypes[doc.doc_type] ?? en.docTypes.other}</span>
        <span className="numerals">, {doc.document_date ? formatDate(doc.document_date) : en.queue.noDate}</span>
        {doc.issuing_source && <span>, {doc.issuing_source}</span>}
        <span className="numerals">. {fmt(en.reading.received, { when: formatDateTime(doc.received_at) })}</span>
      </p>

      <Summary r={r} />

      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="lg:sticky lg:top-20 lg:self-start">
          {page ? (
            <PageViewer url={page.url} width={page.width_px} height={page.height_px} marks={marks} focus={focus} alt={en.reading.pageAlt} />
          ) : (
            <p className="text-sm text-ink-2">{en.reading.noPage}</p>
          )}
        </div>
        <ol className="flex flex-col border-t border-line">
          {r.values.map((v, i) => (
            <ValueRow key={v.id} v={v} n={i + 1} active={focus === i} onFocus={() => setFocus(i)} />
          ))}
          {r.lines.map((l, i) => (
            <LineRow key={l.id} l={l} n={i + 1} patientId={patientId} active={focus === i} onFocus={() => setFocus(i)} />
          ))}
        </ol>
      </div>

      {r.run && (
        <p className="mt-10 font-mono text-xs text-ink-3">
          {fmt(en.reading.run, {
            reader: `${r.run.reader_name} ${r.run.reader_version}`,
            profile: r.run.profile_version,
            commit: r.run.code_commit,
            when: formatDateTime(r.run.started_at),
          })}
        </p>
      )}
    </main>
  )
}

/* The one sentence the page exists for: how much went straight to the record. */
function Summary({ r }: { r: DocumentReading }) {
  if (r.values.length) {
    const direct = r.values.filter((v) => v.went_to === 'record').length
    const person = r.values.filter((v) => v.went_to === 'person')
    const waiting = person.filter((v) => v.waiting).length
    return (
      <div className="mt-6 flex flex-wrap items-baseline gap-x-10 gap-y-3 border-y border-line py-5">
        <Figure n={r.values.length} label={en.reading.read} />
        <Figure n={direct} label={en.reading.direct} />
        <Figure n={person.length} label={en.reading.toPerson} />
        {person.length > 0 && (
          <p className="text-sm text-ink-2">
            {waiting === 0 ? en.reading.allSettled : fmt(en.reading.someWaiting, { n: waiting, settled: person.length - waiting })}
          </p>
        )}
      </div>
    )
  }
  const waiting = r.lines.filter((l) => l.state === 'waiting').length
  return (
    <div className="mt-6 flex flex-wrap items-baseline gap-x-10 gap-y-3 border-y border-line py-5">
      <Figure n={r.lines.length} label={en.reading.linesRead} />
      <p className="max-w-[52ch] text-sm text-ink-2">
        {en.reading.everyLine} {waiting === 0 ? en.reading.allReviewed : fmt(en.reading.linesWaiting, { n: waiting })}
      </p>
    </div>
  )
}

function Figure({ n, label }: { n: number; label: string }) {
  return (
    <p className="flex items-baseline gap-2">
      <span className="numerals text-3xl font-semibold">{n}</span>
      <span className="text-sm text-ink-2">{label}</span>
    </p>
  )
}

const ROW = 'grid grid-cols-[1.75rem_minmax(0,1fr)] gap-x-3 border-b border-line py-4 text-left'

function Number({ n, active }: { n: number; active: boolean }) {
  return (
    <span aria-hidden className={`numerals grid size-6 place-items-center rounded-full font-mono text-xs ${active ? 'bg-accent text-accent-ink' : 'border border-line-strong text-ink-2'}`}>
      {n}
    </span>
  )
}

function ValueRow({ v, n, active, onFocus }: { v: ReadValue; n: number; active: boolean; onFocus: () => void }) {
  return (
    <li className={ROW}>
      <Number n={n} active={active} />
      <div className="flex min-w-0 flex-col gap-2">
        <button type="button" onClick={onFocus} aria-pressed={active} className="flex flex-wrap items-baseline justify-between gap-x-4 rounded-md text-left">
          <span className="font-medium">{v.analyte_name}</span>
          {v.shown ? (
            <span className="numerals">
              <span className="text-lg font-semibold">{v.shown.value_text}</span>
              {v.shown.unit_text && <span className="ml-1 text-sm text-ink-3">{v.shown.unit_text}</span>}
            </span>
          ) : (
            <span className="text-sm text-ink-3">{v.waiting ? en.reading.notShownYet : en.reading.notAValue}</span>
          )}
        </button>
        <p className="text-sm">
          {v.went_to === 'record' && en.reading.wentDirect}
          {v.went_to === 'checking' && en.reading.checking}
          {v.went_to === 'person' && (
            <>
              {en.reading.wentToPerson} <span className="text-ink-2">{v.reason ? (en.reasons as Record<string, string>)[v.reason] ?? v.reason : ''}</span>
            </>
          )}
        </p>
        {v.waiting && (
          <p className="text-sm">
            <Link to="/queue" className="text-accent underline-offset-4 hover:underline">{en.reading.waitingInQueue}</Link>
          </p>
        )}
        {v.settled && <SettledLine s={v.settled} />}
        <Checks checks={v.checks} />
      </div>
    </li>
  )
}

function SettledLine({ s }: { s: NonNullable<ReadValue['settled']> }) {
  const after = s.decision_latency_ms !== null ? fmt(en.reading.after, { seconds: (s.decision_latency_ms / 1000).toFixed(1) }) : ''
  const who = { name: s.by_name ?? en.reading.someone, when: formatDateTime(s.at), after }
  return (
    <p className="numerals text-sm text-ink-2">
      {s.action === 'confirmed' && fmt(en.reading.confirmedBy, who)}
      {s.action === 'corrected' && fmt(en.reading.correctedBy, { ...who, original: [s.original_value_text, s.original_unit_text].filter(Boolean).join(' ') })}
      {s.action === 'discarded' && fmt(en.reading.discardedBy, who)}
    </p>
  )
}

function LineRow({ l, n, patientId, active, onFocus }: { l: ReadLine; n: number; patientId: string; active: boolean; onFocus: () => void }) {
  return (
    <li className={ROW}>
      <Number n={n} active={active} />
      <div className="flex min-w-0 flex-col gap-2">
        <button type="button" onClick={onFocus} aria-pressed={active} className="rounded-md text-left">
          {l.state === 'waiting' ? (
            <span className="text-sm text-ink-3">{en.reading.lineNotShownYet}</span>
          ) : (
            <span>
              <span className="font-medium">{l.drug_text}</span> <span className="numerals">{l.dose_text}</span>{' '}
              {l.schedule_text && <span className="font-mono text-sm text-ink-2">{l.schedule_text}</span>}
            </span>
          )}
        </button>
        {l.state === 'waiting' ? (
          <p className="text-sm">
            <Link to={`/patients/${patientId}/checklist/review/${l.regimen_id}`} className="text-accent underline-offset-4 hover:underline">
              {en.reading.lineWaiting}
            </Link>
          </p>
        ) : (
          <p className="numerals text-sm text-ink-2">
            {l.state === 'confirmed'
              ? fmt(en.reading.lineConfirmedBy, { name: l.by_name ?? en.reading.someone, when: l.at ? formatDateTime(l.at) : '' })
              : fmt(en.reading.lineCorrectedBy, { name: l.by_name ?? en.reading.someone, when: l.at ? formatDateTime(l.at) : '', original: l.original_text ?? '' })}
          </p>
        )}
      </div>
    </li>
  )
}
