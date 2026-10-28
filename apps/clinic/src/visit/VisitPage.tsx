import { useQuery } from '@tanstack/react-query'
import { useParams } from 'react-router'

import { api } from '../api/client'
import { LoadError } from '../app/LoadError'
import { formatDate } from '../lib/dates'
import { en, fmt } from '../strings/en'
import { DocumentsHalf } from './DocumentsHalf'
import { PatientHalf } from './PatientHalf'
import { useFitsViewport } from './useFitsViewport'
import { PAGE } from '../app/page'

/*
 * One page for the visit, in a fixed layout: what documents say on the
 * left, what the patient recorded on the right, both since the last
 * visit. Nothing is ranked, highlighted or left out, and every document
 * value opens its trace.
 */
export function VisitPage() {
  const { patientId } = useParams() as { patientId: string }
  const { attach: pinDocs, fits: docsPinned } = useFitsViewport<HTMLElement>()
  const visit = useQuery({ queryKey: ['visit', patientId], queryFn: () => api.visit(patientId) })
  const period = visit.data?.period
  const record = useQuery({ queryKey: ['record', patientId], queryFn: () => api.record(patientId) })
  const checklist = useQuery({ queryKey: ['checklist', patientId], queryFn: () => api.checklist(patientId) })
  const entries = useQuery({
    queryKey: ['entries', patientId, period?.from, period?.to],
    queryFn: () => api.entries(patientId, { from: period!.from, to: period!.to }),
    enabled: !!period,
  })

  if (visit.isError || record.isError || entries.isError) {
    const retry = () => [visit, record, entries].forEach((q) => q.isError && void q.refetch())
    const busy = visit.isFetching || record.isFetching || entries.isFetching
    return <Shell><LoadError message={en.visit.loadFailed} onRetry={retry} retrying={busy} /></Shell>
  }
  if (!visit.data || !record.data || !entries.data || !period) {
    return <Shell><div className="h-96 rounded-xl bg-sunken" aria-busy="true" /></Shell>
  }

  const documents = record.data.documents.filter(
    (d) => d.document_date && d.document_date >= period.from && d.document_date <= period.to,
  )
  return (
    <Shell>
      <header className="mb-6">
        <h2 className="text-xl font-semibold tracking-tight">
          {fmt(en.visit.title, { date: formatDate(visit.data.visit.scheduled_for ?? period.to) })}
        </h2>
        <p className="mt-1 flex flex-wrap gap-x-4 text-sm text-ink-2">
          <span>
            {period.previous_visit
              ? fmt(en.visit.covers, { from: formatDate(period.from), to: formatDate(period.to), previous: formatDate(period.previous_visit) })
              : fmt(en.visit.coversFirst, { from: formatDate(period.from), to: formatDate(period.to) })}
          </span>
          {visit.data.visit.clinician_name && <span>{fmt(en.visit.with, { name: visit.data.visit.clinician_name })}</span>}
        </p>
      </header>
      <div className="grid gap-10 lg:grid-cols-2 lg:gap-12">
        <section ref={pinDocs} aria-labelledby="half-docs" data-pinned={docsPinned || undefined} className={`min-w-0 lg:self-start ${docsPinned ? 'lg:sticky lg:top-6' : ''}`}>
          <h2 id="half-docs" className="mb-4 border-b border-line pb-2 text-base font-semibold">{en.visit.documentsHalf}</h2>
          <DocumentsHalf patientId={patientId} documents={documents} orders={visit.data.orders} checklist={checklist.data} />
        </section>
        <section aria-labelledby="half-patient" className="min-w-0">
          <h2 id="half-patient" className="mb-4 border-b border-line pb-2 text-base font-semibold">{en.visit.patientHalf}</h2>
          <p className="-mt-2 mb-4 text-xs text-ink-3">{en.entries.defaultSource}</p>
          <PatientHalf entries={entries.data.entries} score={visit.data.compliance} />
        </section>
      </div>
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main className={`${PAGE} pt-6 pb-16`}>{children}</main>
}
