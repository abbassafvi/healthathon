import { Link } from 'react-router'

import type { RegimenReview } from '../api/client'
import { formatDate, formatDateTime } from '../lib/dates'
import { en, fmt } from '../strings/en'

type Props = {
  data: RegimenReview
  patientId: string
  failed: boolean
  activating: boolean
  onActivate: () => void
}

/*
 * The one irreversible step. It states exactly what activation changes and
 * stays disabled until every medicine has been confirmed by a person.
 */
export function ActivationBar({ data, patientId, failed, activating, onActivate }: Props) {
  const done = data.items.filter((i) => i.confirmed_at).length
  const total = data.items.length
  const ready = total > 0 && done === total

  return (
    <div className="fixed inset-x-0 bottom-0 z-(--z-sticky) border-t border-line bg-bg/95 backdrop-blur-sm">
      <div className="mx-auto grid w-full max-w-7xl grid-cols-[minmax(0,1fr)_auto] items-center gap-x-6 gap-y-2 px-4 py-3 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:px-6 sm:py-4" aria-live="polite">
        {data.activated_at ? (
          <>
            <p className="font-medium sm:col-span-2">{fmt(en.review.activated, { when: formatDateTime(data.activated_at) })}</p>
            <Link to={`/patients/${patientId}/checklist`} className="justify-self-end text-sm font-medium text-accent underline-offset-4 hover:underline">
              {en.review.backToChecklist}
            </Link>
          </>
        ) : (
          <>
            <p className="numerals font-mono text-sm text-ink-2">{fmt(en.review.progress, { done, total })}</p>
            <p className="col-span-2 row-start-2 text-sm text-ink-2 sm:col-span-1 sm:row-start-auto">
              {failed
                ? en.review.saveFailed
                : data.replaces
                  ? fmt(en.review.replaces, { when: formatDate(data.replaces.activated_at), count: data.replaces.item_count })
                  : fmt(en.review.firstChecklist, { name: data.patient.full_name })}
            </p>
            <button
              type="button"
              disabled={!ready || activating}
              onClick={onActivate}
              aria-describedby={ready ? undefined : 'activate-help'}
              className="inline-flex h-10 items-center rounded-lg border border-accent bg-accent px-4 text-sm font-medium text-accent-ink transition-colors duration-150 hover:bg-accent-hover disabled:cursor-not-allowed disabled:border-line disabled:bg-sunken disabled:text-ink-3"
            >
              {en.review.activate}
            </button>
            {!ready && <span id="activate-help" className="sr-only">{en.review.activateHelp}</span>}
          </>
        )}
      </div>
    </div>
  )
}
