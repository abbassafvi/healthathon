import { api } from '../api/client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useState, useLayoutEffect } from 'react'
import { Link, useParams } from 'react-router'

import type { RegimenReview } from '../api/client'
import { formatDate } from '../lib/dates'
import { hasModifier, isButtonTarget, isTypingTarget } from '../lib/keys'
import { KeysHelp } from '../app/KeysHelp'
import { en, fmt } from '../strings/en'
import { PageViewer } from '../trace/PageViewer'
import { ActivationBar } from './ActivationBar'
import { ReviewRow } from './ReviewRow'
import { PAGE } from '../app/page'

/*
 * Confirm a prescription line by line against the page, then activate it
 * as the patient's checklist. The page on the left outlines every line,
 * numbered to match the list; the focused line is the one zoomed to.
 */
export function ReviewPage() {
  const { patientId, regimenId } = useParams() as { patientId: string; regimenId: string }
  const qc = useQueryClient()
  const key = ['review', regimenId]
  const query = useQuery({ queryKey: key, queryFn: () => api.review(regimenId) })
  const [focus, setFocus] = useState(0)
  const [renderedAt, setRenderedAt] = useState<Record<string, number>>({})
  const [correcting, setCorrecting] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  const refresh = useCallback(() => {
    void qc.invalidateQueries({ queryKey: key })
    void qc.invalidateQueries({ queryKey: ['checklist', patientId] })
  }, [qc, key, patientId]) // eslint-disable-line react-hooks/exhaustive-deps

  const onError = () => setFailed(true)
  const confirm = useMutation({
    mutationFn: (v: { id: string; fix?: { drug_text: string; dose_text: string; schedule_text: string | null } }) =>
      api.confirmItem(v.id, {
        decision_latency_ms: Math.round(performance.now() - (renderedAt[v.id] ?? performance.now())),
        ...v.fix,
      }),
    onSuccess: (_d, v) => {
      setCorrecting(null)
      setFailed(false)
      advanceFrom(v.id)
      refresh()
    },
    onError,
  })
  const remove = useMutation({ mutationFn: api.removeItem, onSuccess: refresh, onError })
  const activate = useMutation({ mutationFn: () => api.activate(regimenId), onSuccess: refresh, onError })
  const busy = confirm.isPending || remove.isPending

  const data = query.data
  const items = data?.items ?? []
  const current = items[Math.min(focus, items.length - 1)]

  function advanceFrom(id: string) {
    const i = items.findIndex((x) => x.id === id)
    const next = items.findIndex((x, j) => j > i && !x.confirmed_at)
    if (next >= 0) setFocus(next)
  }

  // Layout effect: keys work in the same commit that enables a line.
  useLayoutEffect(() => {
    if (!data || data.activated_at) return
    const onKey = (e: KeyboardEvent) => {
      if (hasModifier(e) || e.repeat || isTypingTarget(e.target) || correcting) return
      const k = e.key.toLowerCase()
      if (k === 'j' || k === 'arrowdown') {
        e.preventDefault()
        setFocus((f) => Math.min(items.length - 1, f + 1))
      } else if (k === 'k' || k === 'arrowup') {
        e.preventDefault()
        setFocus((f) => Math.max(0, f - 1))
      }
      if (!current || current.confirmed_at || renderedAt[current.id] === undefined || busy) return
      if (k === 'enter' && !isButtonTarget(e.target)) {
        e.preventDefault()
        confirm.mutate({ id: current.id })
      } else if (k === 'c') {
        e.preventDefault()
        setCorrecting(current.id)
      } else if (k === 'x') {
        remove.mutate(current.id)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [data, items.length, current, renderedAt, busy, correcting, confirm, remove])

  return (
    <main className={`${PAGE} pt-6 pb-40`}>
      <Link to={`/patients/${patientId}/checklist`} className="text-sm text-ink-2 underline-offset-4 hover:text-ink hover:underline">
        {data ? `${en.review.back}: ${data.patient.full_name}` : en.review.back}
      </Link>
      {query.status === 'pending' && <div className="mt-6 h-96 rounded-xl bg-sunken" aria-busy="true" />}
      {query.status === 'error' && <p className="mt-6 text-ink-2">{en.review.loadFailed}</p>}
      {data && (
        <>
          <Header data={data} />
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="lg:sticky lg:top-20 lg:self-start">
              <PageViewer
                url={data.page.url}
                width={data.page.width_px}
                height={data.page.height_px}
                marks={items.map((it, i) => ({ box: it.box, label: String(i + 1) }))}
                focus={Math.min(focus, Math.max(0, items.length - 1))}
                alt={en.review.pageAlt}
              />
            </div>
            <div>
              <div className="mb-3 flex items-center justify-between gap-4">
                <h2 className="text-base font-semibold">{en.review.listTitle}</h2>
                {!data.activated_at && <KeysHelp keys={en.keys.review} />}
              </div>
              {items.length === 0 ? (
                <p className="rounded-xl border border-line bg-surface p-6 text-ink-2">{en.review.empty}</p>
              ) : (
                <ol className="flex flex-col gap-3">
                  {items.map((it, i) => (
                    <ReviewRow
                      key={it.id}
                      item={it}
                      n={i + 1}
                      focused={i === focus}
                      rendered={renderedAt[it.id] !== undefined}
                      correcting={correcting === it.id}
                      busy={busy}
                      onFocus={() => setFocus(i)}
                      onRendered={(at) => setRenderedAt((r) => (r[it.id] === undefined ? { ...r, [it.id]: at } : r))}
                      onConfirm={() => confirm.mutate({ id: it.id })}
                      onStartCorrect={() => setCorrecting(it.id)}
                      onCorrect={(fix) => confirm.mutate({ id: it.id, fix })}
                      onCancelCorrect={() => setCorrecting(null)}
                      onRemove={() => remove.mutate(it.id)}
                    />
                  ))}
                </ol>
              )}
            </div>
          </div>
          <ActivationBar
            data={data}
            failed={failed}
            activating={activate.isPending}
            onActivate={() => activate.mutate()}
            patientId={patientId}
          />
        </>
      )}
    </main>
  )
}

function Header({ data }: { data: RegimenReview }) {
  return (
    <header className="mt-3 mb-6 flex flex-wrap items-baseline gap-x-4 gap-y-1">
      <h1 className="text-2xl font-semibold tracking-tight">{en.review.title}</h1>
      <span className="text-sm text-ink-2">{data.patient.full_name}</span>
      <span className="font-mono text-sm text-ink-3">{data.patient.registration_no}</span>
      {data.document.document_date && (
        <span className="text-sm text-ink-2">{fmt(en.review.dated, { date: formatDate(data.document.document_date) })}</span>
      )}
      {data.document.issuing_source && <span className="text-sm text-ink-3">{data.document.issuing_source}</span>}
    </header>
  )
}
