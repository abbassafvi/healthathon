import { api } from '../api/client'
import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router'

import type { ActiveRegimen } from '../api/client'
import { LoadError } from '../app/LoadError'
import { formatDate, formatDateTime } from '../lib/dates'
import { en, fmt } from '../strings/en'
import { ItemText } from './ItemText'
import { PAGE } from '../app/page'

export function ChecklistPage() {
  const { patientId } = useParams() as { patientId: string }
  const query = useQuery({ queryKey: ['checklist', patientId], queryFn: () => api.checklist(patientId) })

  return (
    <main className={`${PAGE} pt-6 pb-16`}>
      {query.status === 'pending' && <div className="h-64 rounded-xl bg-sunken" aria-busy="true" />}
      {query.status === 'error' && <LoadError message={en.checklist.loadFailed} onRetry={() => void query.refetch()} retrying={query.isFetching} />}
      {query.status === 'success' && (
        <div className="flex flex-col gap-12">
          {query.data.awaiting_review.length > 0 && (
            <section aria-labelledby="awaiting">
              <h2 id="awaiting" className="mb-3 text-base font-semibold">{en.checklist.awaitingTitle}</h2>
              <ul className="border-t border-line">
                {query.data.awaiting_review.map((a) => (
                  <li key={a.regimen_id} className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-line py-3">
                    <span className="font-medium">
                      {fmt(en.checklist.awaitingRow, { date: a.document.document_date ? formatDate(a.document.document_date) : en.queue.noDate })}
                    </span>
                    <span className="text-sm text-ink-3">{a.document.issuing_source}</span>
                    <span className="numerals ml-auto font-mono text-sm text-ink-2">
                      {fmt(en.checklist.progress, { done: a.confirmed_count, total: a.item_count })}
                    </span>
                    <Link
                      to={`review/${a.regimen_id}`}
                      className="inline-flex h-9 items-center rounded-lg border border-accent bg-accent px-3.5 text-sm font-medium text-accent-ink hover:bg-accent-hover"
                    >
                      {en.checklist.review}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <section aria-labelledby="active">
            <h2 id="active" className="mb-1 text-base font-semibold">{en.checklist.activeTitle}</h2>
            {query.data.active ? <Active regimen={query.data.active} /> : (
              <div className="mt-3 rounded-xl border border-line bg-surface px-6 py-8">
                <p className="font-medium">{en.checklist.noneActive}</p>
                <p className="mt-1 max-w-[60ch] text-ink-2">{en.checklist.noneActiveBody}</p>
              </div>
            )}
          </section>
        </div>
      )}
    </main>
  )
}

function Active({ regimen }: { regimen: ActiveRegimen }) {
  const date = regimen.source_document.document_date ? formatDate(regimen.source_document.document_date) : en.queue.noDate
  return (
    <>
      <p className="mb-4 text-sm text-ink-2">
        {fmt(en.checklist.activeSince, { when: formatDateTime(regimen.activated_at), name: regimen.activated_by_name, date })}{' '}
        {en.checklist.patientSees}{' '}
        <Link to={`../documents/${regimen.source_document.id}/reading`} relative="path" className="text-accent underline underline-offset-4">
          {en.reading.openPrescription}
        </Link>
      </p>
      <ol className="border-t border-line">
        {regimen.items.map((item) => (
          <li key={item.id} className="grid items-center gap-4 border-b border-line py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
            <ItemText item={item} />
            <img
              src={item.crop_url}
              alt={fmt(en.checklist.itemCrop, { drug: item.drug_text })}
              loading="lazy"
              className="h-12 w-auto max-w-full justify-self-start rounded-md border border-line bg-surface"
            />
          </li>
        ))}
      </ol>
    </>
  )
}
