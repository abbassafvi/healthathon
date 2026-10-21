import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { useNavigate, useParams } from 'react-router'

import { api, ApiError, type Trace } from '../api/client'
import { formatDate } from '../lib/dates'
import { hasModifier, isTypingTarget } from '../lib/keys'
import { en, fmt } from '../strings/en'
import { describeHistory } from './history'
import { PageViewer } from './PageViewer'

/*
 * The trace of one value, as a panel beside the record. Its URL is its
 * own, so Back closes it; Escape and the close button do the same.
 */
export function TracePanel() {
  const { patientId, valueId } = useParams() as { patientId: string; valueId: string }
  const navigate = useNavigate()
  const headingRef = useRef<HTMLHeadingElement>(null)
  const query = useQuery({
    queryKey: ['trace', valueId],
    queryFn: () => api.trace(valueId),
    retry: (n, err) => !(err instanceof ApiError && err.status === 404) && n < 1,
  })
  const close = () => navigate(`/patients/${patientId}`)

  useEffect(() => headingRef.current?.focus(), [valueId])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !hasModifier(e) && !isTypingTarget(e.target)) {
        e.preventDefault()
        navigate(`/patients/${patientId}`)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigate, patientId])

  return (
    <aside
      role="dialog"
      aria-modal="false"
      aria-labelledby="trace-title"
      className="animate-panel-in fixed inset-y-0 right-0 top-14 z-(--z-panel) flex w-full flex-col overflow-y-auto border-l border-line bg-bg md:w-[min(46rem,58vw)]"
    >
      <header className="sticky top-0 z-(--z-sticky) flex items-center justify-between gap-4 border-b border-line bg-bg px-6 py-4">
        <h2 id="trace-title" ref={headingRef} tabIndex={-1} className="text-base font-semibold tracking-tight outline-none">
          {en.trace.title}
        </h2>
        <button
          type="button"
          onClick={close}
          aria-keyshortcuts="Escape"
          className="inline-flex h-8 items-center gap-2 rounded-lg border border-line-strong bg-surface px-3 text-sm font-medium hover:bg-bg"
        >
          {en.trace.close}
          <kbd className="kbd">Esc</kbd>
        </button>
      </header>
      <div className="flex flex-col gap-6 px-6 py-6">
        {query.status === 'pending' && <div className="h-[min(58vh,34rem)] rounded-xl bg-sunken" aria-busy="true" />}
        {query.status === 'error' && (
          <p className="max-w-[60ch] text-ink-2">
            {query.error instanceof ApiError && query.error.status === 404 ? en.trace.notShown : en.trace.loadFailed}
          </p>
        )}
        {query.status === 'success' && <TraceBody t={query.data} />}
      </div>
    </aside>
  )
}

function TraceBody({ t }: { t: Trace }) {
  const docType = en.docTypes[t.document.doc_type] ?? en.docTypes.other
  const dated = t.document.document_date ? formatDate(t.document.document_date) : en.queue.noDate
  const docLabel = `${docType}, ${en.queue.reportDate.toLowerCase()} ${dated}`
  return (
    <>
      {t.page && (
        <PageViewer
          key={t.value.id}
          url={t.page.url}
          width={t.page.width_px}
          height={t.page.height_px}
          box={t.box}
          alt={fmt(en.trace.pageAlt, { n: t.page.page_no, doc: docLabel })}
        />
      )}
      <div>
        <p className="label">{t.value.analyte_name}</p>
        <p className="numerals mt-1 flex items-baseline gap-3">
          <span className="text-6xl font-semibold leading-none">{t.value.value_text}</span>
          {t.value.unit_text && <span className="text-xl text-ink-3">{t.value.unit_text}</span>}
        </p>
      </div>
      <section aria-labelledby="trace-history">
        <h3 id="trace-history" className="label">{en.trace.howItGotHere}</h3>
        <p className="mt-1 max-w-[60ch] text-lg leading-snug" data-testid="trace-history">
          {describeHistory(t)}
        </p>
        {t.located_by_text && <p className="mt-2 max-w-[60ch] text-sm text-ink-2">{en.trace.locatedByText}</p>}
      </section>
      <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 border-t border-line pt-5 text-sm">
        <Fact label={en.trace.document}>{docLabel}</Fact>
        {t.document.issuing_source && <Fact label={en.trace.source}>{t.document.issuing_source}</Fact>}
        {t.page && <Fact label={en.trace.page}>{fmt(en.trace.pageOf, { n: t.page.page_no, total: t.page.page_count })}</Fact>}
        <Fact label={en.trace.readBy}>
          {t.reader_name ? (
            <span className="font-mono text-xs">{t.reader_name} {t.reader_version}</span>
          ) : (
            en.trace.noReader
          )}
        </Fact>
      </dl>
    </>
  )
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="label self-baseline">{label}</dt>
      <dd className="self-baseline text-ink">{children}</dd>
    </>
  )
}
