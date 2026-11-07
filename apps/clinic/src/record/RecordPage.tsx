import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { Link, Outlet, useParams } from 'react-router'

import { api, ApiError, type Checklist, type RecordDocument } from '../api/client'
import { LoadError } from '../app/LoadError'
import { formatDate } from '../lib/dates'
import { en, fmt } from '../strings/en'
import { PAGE } from '../app/page'

/*
 * The Documents tab of a patient's record, newest document first. A lab
 * report shows its values exactly as printed, in page order, and every
 * value opens its trace. A prescription says where it stands: the
 * checklist in force, or lines waiting for review. Patient entries join
 * this page with the timeline.
 */
export function RecordPage() {
  const { patientId, valueId } = useParams() as { patientId: string; valueId?: string }
  const query = useQuery({ queryKey: ['record', patientId], queryFn: () => api.record(patientId) })
  const checklist = useQuery({ queryKey: ['checklist', patientId], queryFn: () => api.checklist(patientId) })
  const lastOpened = useRef<string | null>(null)

  // When the trace closes, put focus back on the value it was opened from.
  useEffect(() => {
    if (valueId) {
      lastOpened.current = valueId
    } else if (lastOpened.current) {
      document.querySelector<HTMLElement>(`[data-value-id="${lastOpened.current}"]`)?.focus()
      lastOpened.current = null
    }
  }, [valueId])

  return (
    <div className={valueId ? 'md:pr-[min(46rem,58vw)]' : undefined}>
      <main className={`${PAGE} pt-6 pb-16`}>
        {query.status === 'pending' && <div className="mt-6 h-64 rounded-xl bg-sunken" aria-busy="true" />}
        {query.status === 'error' && (query.error instanceof ApiError && query.error.status === 404 ? (
          <p className="mt-6 text-ink-2">{en.record.notFound}</p>
        ) : (
          <LoadError className="mt-6" message={en.record.loadFailed} onRetry={() => void query.refetch()} retrying={query.isFetching} />
        ))}
        {query.status === 'success' && (
          <>
            {query.data.documents.length === 0 && prescriptions(checklist.data).length === 0 ? (
              <p className="text-ink-2">{en.record.empty}</p>
            ) : (
              <>
                <div className="flex flex-col gap-10">
                  {newestFirst(query.data.documents, prescriptions(checklist.data)).map((d) =>
                    'values' in d ? (
                      <DocumentValues
                        key={d.id}
                        doc={d}
                        patientId={patientId}
                        selected={valueId}
                        hint={d.id === query.data.documents.find((x) => x.values.length > 0)?.id}
                      />
                    ) : (
                      <PrescriptionEntry key={d.id} rx={d} patientId={patientId} />
                    ),
                  )}
                </div>
              </>
            )}
          </>
        )}
      </main>
      <Outlet />
    </div>
  )
}

/* A report's values; the first report with values also says they can be traced. */
function DocumentValues({ doc, patientId, selected, hint }: { doc: RecordDocument; patientId: string; selected?: string; hint: boolean }) {
  const docType = en.docTypes[doc.doc_type] ?? en.docTypes.other
  const headingId = `doc-${doc.id}`
  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId} className="flex flex-wrap items-baseline gap-x-3 border-b border-line pb-2">
        <span className="text-base font-semibold">{docType}</span>
        <span className="numerals text-sm text-ink-2">
          {doc.document_date ? formatDate(doc.document_date) : en.queue.noDate}
        </span>
        {doc.issuing_source && <span className="text-sm text-ink-3">{doc.issuing_source}</span>}
        {en.sentFrom[doc.sent_from] && (
          <span className="text-sm text-ink-3" data-testid={`sent-from-${doc.id}`}>{en.sentFrom[doc.sent_from]}</span>
        )}
        <Link to={`/patients/${patientId}/documents/${doc.id}/reading`} className="ml-auto text-sm font-normal text-accent underline-offset-4 hover:underline">
          {en.reading.open}
        </Link>
      </h2>
      {hint && <p className="mt-2 mb-1 text-sm text-ink-3">{en.record.traceHint}</p>}
      {doc.values.length === 0 ? (
        <p className="py-3 text-sm text-ink-2">{en.record.noValues}</p>
      ) : (
        <ul>
          {doc.values.map((v) => (
            <li key={v.id} className="border-b border-line">
              <Link
                to={`/patients/${patientId}/documents/values/${v.id}`}
                data-value-id={v.id}
                aria-current={selected === v.id ? 'true' : undefined}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-4 px-2 py-3 transition-colors duration-150 hover:bg-surface aria-[current=true]:bg-accent-soft"
              >
                <span className="text-sm text-ink">{v.analyte_name}</span>
                <span className="numerals flex items-baseline justify-end gap-2">
                  <span className="text-xl font-semibold">{v.value_text}</span>
                  <span className="w-28 text-sm text-ink-3">{v.unit_text}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

type Prescription = {
  id: string
  document_date: string | null
  issuing_source: string | null
} & ({ state: 'active'; since: string; medicines: number } | { state: 'waiting'; regimenId: string; lines: number })

/* The prescriptions the checklist knows: the one in force and those waiting for review. */
function prescriptions(c: Checklist | undefined): Prescription[] {
  if (!c) return []
  const active: Prescription[] = c.active
    ? [{ ...c.active.source_document, state: 'active', since: c.active.activated_at, medicines: c.active.items.length }]
    : []
  return [
    ...active,
    ...c.awaiting_review.map((a): Prescription => ({
      ...a.document, state: 'waiting', regimenId: a.regimen_id, lines: a.item_count - a.settled_count,
    })),
  ]
}

function newestFirst(docs: RecordDocument[], rx: Prescription[]): (RecordDocument | Prescription)[] {
  return [...docs, ...rx].sort((a, b) => (b.document_date ?? '').localeCompare(a.document_date ?? ''))
}

function PrescriptionEntry({ rx, patientId }: { rx: Prescription; patientId: string }) {
  const headingId = `doc-${rx.id}`
  const link = 'text-sm text-accent underline-offset-4 hover:underline'
  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId} className="flex flex-wrap items-baseline gap-x-3 border-b border-line pb-2">
        <span className="text-base font-semibold">{en.docTypes.prescription}</span>
        <span className="numerals text-sm text-ink-2">{rx.document_date ? formatDate(rx.document_date) : en.queue.noDate}</span>
        {rx.issuing_source && <span className="text-sm text-ink-3">{rx.issuing_source}</span>}
        <Link to={`/patients/${patientId}/documents/${rx.id}/reading`} className={`ml-auto font-normal ${link}`}>
          {en.reading.openPrescription}
        </Link>
      </h2>
      <p className="numerals flex flex-wrap items-baseline gap-x-4 gap-y-1 px-2 py-3 text-sm">
        {rx.state === 'active' ? (
          <>
            <span>{fmt(rx.medicines === 1 ? en.record.rxActiveOne : en.record.rxActive, { date: formatDate(rx.since), n: rx.medicines })}</span>
            <Link to={`/patients/${patientId}/checklist`} className={link}>{en.record.openChecklist}</Link>
          </>
        ) : (
          <>
            <span>{rx.lines === 0 ? en.record.rxReviewed : fmt(rx.lines === 1 ? en.record.rxWaitingOne : en.record.rxWaiting, { n: rx.lines })}</span>
            <Link to={`/patients/${patientId}/checklist/review/${rx.regimenId}`} className={link}>{en.record.reviewLines}</Link>
          </>
        )}
      </p>
    </section>
  )
}
