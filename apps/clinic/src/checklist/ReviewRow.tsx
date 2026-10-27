import type { RegimenItem } from '../api/client'
import { ActionButton } from '../confirm-queue/ActionButton'
import { CropImage } from '../confirm-queue/CropImage'
import { formatDateTime } from '../lib/dates'
import { en, fmt } from '../strings/en'
import { ItemCorrectionForm } from './ItemCorrectionForm'
import { ItemText } from './ItemText'

type Props = {
  item: RegimenItem
  n: number
  focused: boolean
  rendered: boolean
  correcting: boolean
  busy: boolean
  onFocus: () => void
  onRendered: (at: number) => void
  onConfirm: () => void
  onStartCorrect: () => void
  onCorrect: (v: { drug_text: string; dose_text: string; schedule_text: string | null }) => void
  onCancelCorrect: () => void
  onRemove: () => void
}

/*
 * One medicine on the prescription. Its controls stay disabled until its
 * own crop has rendered: the same gate as the confirm queue.
 */
export function ReviewRow(p: Props) {
  const confirmed = p.item.confirmed_at !== null
  const locked = !p.rendered || p.busy
  return (
    <li
      data-item-id={p.item.id}
      aria-current={p.focused ? 'true' : undefined}
      onFocusCapture={p.onFocus}
      onPointerDown={p.onFocus}
      className={`rounded-xl border p-4 transition-colors duration-150 ${
        p.focused ? 'border-accent bg-surface' : 'border-line bg-surface/60'
      }`}
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className={`mt-0.5 grid size-7 shrink-0 place-items-center rounded-full font-mono text-xs ${
            p.focused ? 'bg-accent text-accent-ink' : 'border border-line-strong text-ink-2'
          }`}
        >
          {p.n}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <h3 className="sr-only">{fmt(en.review.item, { n: p.n })}</h3>
          <CropImage
            src={p.item.crop_url}
            alt={fmt(en.checklist.itemCrop, { drug: p.item.drug_text })}
            onRendered={p.onRendered}
            onFailed={() => {}}
          />
          <ItemText item={p.item} size="lg" />
          {confirmed ? (
            <p className="text-sm text-ink-2">
              {fmt(en.review.confirmedBy, { name: p.item.confirmed_by_name ?? '' })}
              {p.item.confirmed_at && `, ${formatDateTime(p.item.confirmed_at)}`}
            </p>
          ) : p.correcting ? (
            <ItemCorrectionForm onSave={p.onCorrect} onCancel={p.onCancelCorrect} />
          ) : (
            <div className="flex flex-wrap gap-2" role="group" aria-label={fmt(en.review.item, { n: p.n })}>
              <ActionButton primary={p.focused} disabled={locked} kbd={p.focused ? 'Enter' : undefined} onClick={p.onConfirm}>{en.review.confirm}</ActionButton>
              {/* The other two actions belong to the line in focus only. */}
              {p.focused && (
                <>
                  <ActionButton disabled={locked} kbd="C" onClick={p.onStartCorrect}>{en.review.correct}</ActionButton>
                  <ActionButton disabled={locked} kbd="X" onClick={p.onRemove}>{en.review.remove}</ActionButton>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </li>
  )
}
