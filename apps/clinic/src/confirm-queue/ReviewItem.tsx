import { useCallback, useRef, useState, useLayoutEffect } from 'react'

import type { Decision, QueueItem } from '../api/client'
import { formatDate } from '../lib/dates'
import { hasModifier, isButtonTarget, isTypingTarget } from '../lib/keys'
import { en, fmt } from '../strings/en'
import { CorrectionForm } from './CorrectionForm'
import { CropImage } from './CropImage'
import { ActionButton } from './ActionButton'

type Props = {
  item: QueueItem
  onDecide: (decision: Decision) => void
}

/*
 * One queue item. Every control is disabled until the crop has painted,
 * and decision_latency_ms is measured from that paint. Keyboard: Enter
 * confirms, 1-9 picks an alternative reading, C opens the correction field,
 * X marks it not a value.
 */
export function ReviewItem({ item, onDecide }: Props) {
  const [renderedAt, setRenderedAt] = useState<number | null>(null)
  const [correcting, setCorrecting] = useState(false)
  const ready = renderedAt !== null
  const decidedRef = useRef(false)

  const send = useCallback(
    (d: Omit<Decision, 'decision_latency_ms'>) => {
      if (renderedAt === null || decidedRef.current) return
      decidedRef.current = true
      onDecide({ ...d, decision_latency_ms: Math.round(performance.now() - renderedAt) })
    },
    [onDecide, renderedAt],
  )

  // Candidate readings other than the one shown; those are what a key can pick.
  const alternatives = item.candidate_readings.filter(
    (c) => !(c.value_text === item.value_text && (c.unit_text ?? null) === item.unit_text),
  )

  const pickAlternative = useCallback(
    (index: number) => {
      const c = alternatives[index]
      if (c) send({ action: 'correct', value_text: c.value_text, unit_text: c.unit_text ?? null })
    },
    [alternatives, send],
  )

  // A layout effect, so the keys work in the same commit that enables the
  // buttons; a passive effect left a moment where they looked ready but
  // Enter did nothing.
  useLayoutEffect(() => {
    if (!ready || correcting) return
    const onKey = (e: KeyboardEvent) => {
      if (hasModifier(e) || e.repeat || isTypingTarget(e.target)) return
      const key = e.key.toLowerCase()
      if (key === 'enter' && !isButtonTarget(e.target)) {
        e.preventDefault()
        send({ action: 'confirm' })
      } else if (/^[1-9]$/.test(key)) {
        pickAlternative(Number(key) - 1)
      } else if (key === 'c') {
        e.preventDefault()
        setCorrecting(true)
      } else if (key === 'x') {
        send({ action: 'discard' })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [ready, correcting, send, pickAlternative])

  const docType = en.docTypes[item.document.doc_type] ?? en.docTypes.other
  const dated = item.document.document_date ? formatDate(item.document.document_date) : en.queue.noDate

  return (
    <article aria-labelledby="queue-reading" className="flex flex-col gap-6">
      <dl className="flex flex-wrap items-baseline gap-x-8 gap-y-2">
        <Meta label={en.queue.patient}>
          {item.patient.full_name}
          <span className="ml-2 font-mono text-xs text-ink-3">{item.patient.registration_no}</span>
        </Meta>
        <Meta label={en.queue.document}>
          {docType}, {en.queue.reportDate.toLowerCase()} {dated}
        </Meta>
      </dl>

      <CropImage
        src={item.crop_url}
        alt={en.queue.cropAlt}
        onRendered={setRenderedAt}
        onFailed={() => setRenderedAt(null)}
      />

      <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] md:gap-12">
        <div>
          <p className="label">{item.analyte_name}</p>
          <p id="queue-reading" className="numerals mt-1 flex items-baseline gap-3">
            <span className="text-7xl font-semibold leading-none text-ink">{item.value_text}</span>
            {item.unit_text && <span className="text-2xl text-ink-3">{item.unit_text}</span>}
          </p>
          <p className="label mt-3">{en.queue.asRead}</p>
        </div>
        <div className="md:pt-1">
          <p className="label">{en.queue.reasonLabel}</p>
          <p className="mt-1 max-w-[40ch] text-lg leading-snug text-ink">
            {en.reasons[item.reason]}
          </p>
        </div>
      </div>

      <div className="border-t border-line pt-5">
        {correcting ? (
          <CorrectionForm
            initialUnit={item.unit_text}
            onSave={(value_text, unit_text) => send({ action: 'correct', value_text, unit_text })}
            onCancel={() => setCorrecting(false)}
          />
        ) : (
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Decision">
            <ActionButton primary disabled={!ready} kbd="Enter" onClick={() => send({ action: 'confirm' })}>
              {en.queue.confirm}
            </ActionButton>
            {alternatives.map((c, i) => (
              <ActionButton key={i} disabled={!ready} kbd={String(i + 1)} onClick={() => pickAlternative(i)}>
                {fmt(en.queue.useCandidate, { value: c.value_text })}
              </ActionButton>
            ))}
            <ActionButton disabled={!ready} kbd="C" onClick={() => setCorrecting(true)}>
              {en.queue.correct}
            </ActionButton>
            <ActionButton disabled={!ready} kbd="X" onClick={() => send({ action: 'discard' })}>
              {en.queue.discard}
            </ActionButton>
            <p role="status" className="ml-2 text-sm text-ink-3">
              {ready ? '' : en.queue.cropLoading}
            </p>
          </div>
        )}
      </div>
    </article>
  )
}

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="label">{label}</dt>
      <dd className="text-sm font-medium text-ink">{children}</dd>
    </div>
  )
}
