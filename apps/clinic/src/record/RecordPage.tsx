import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { Link, Outlet, useParams } from 'react-router'

import { api, ApiError, type RecordDocument } from '../api/client'
import { formatDate } from '../lib/dates'
import { en } from '../strings/en'

/*
 * The Documents tab of a patient's record: each document's values exactly
 * as printed, newest document first, in page order within it. Every value
 * opens its trace. Patient entries join this page with the timeline.
 */
export function RecordPage() {
  const { patientId, valueId } = useParams() as { patientId: string; valueId?: string }
  const query = useQuery({ queryKey: ['record', patientId], queryFn: () => api.record(patientId) })
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
      <main className="mx-auto w-full max-w-5xl px-4 pt-6 pb-16 sm:px-6">
        {query.status === 'pending' && <div className="mt-6 h-64 rounded-xl bg-sunken" aria-busy="true" />}
        {query.status === 'error' && (
          <p className="mt-6 text-ink-2">
            {query.error instanceof ApiError && query.error.status === 404 ? en.record.notFound : en.record.loadFailed}
          </p>
        )}
        {query.status === 'success' && (
          <>
            {query.data.documents.length === 0 ? (
              <p className="text-ink-2">{en.record.empty}</p>
            ) : (
              <>
                <p className="mb-4 text-sm text-ink-3">{en.record.traceHint}</p>
                <div className="flex flex-col gap-10">
                  {query.data.documents.map((d) => (
                    <DocumentValues key={d.id} doc={d} patientId={patientId} selected={valueId} />
                  ))}
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

function DocumentValues({ doc, patientId, selected }: { doc: RecordDocument; patientId: string; selected?: string }) {
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
      </h2>
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
