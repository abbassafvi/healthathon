import { en, fmt } from '../strings/en'
import { DecisionToast } from './DecisionToast'
import { ReviewItem } from './ReviewItem'
import { UNDO_WINDOW_MS, useReviewSession } from './useReviewSession'

export function ConfirmQueuePage({ undoWindowMs = UNDO_WINDOW_MS }: { undoWindowMs?: number }) {
  const s = useReviewSession(undoWindowMs)

  return (
    <main className="mx-auto w-full max-w-5xl px-4 pt-8 pb-28 sm:px-6">
      <header className="mb-8 flex items-baseline justify-between gap-4">
        <h1 className="text-xl font-semibold tracking-tight">{en.queue.title}</h1>
        {s.status === 'success' && s.current && (
          <p className="numerals font-mono text-sm text-ink-2">
            {fmt(en.queue.position, { n: s.position, total: s.total })}
          </p>
        )}
      </header>

      {s.status === 'pending' && <QueueSkeleton />}
      {s.status === 'error' && (
        <div className="flex items-center gap-4 rounded-xl border border-line bg-surface p-6">
          <p className="text-ink-2">{en.queue.loadFailed}</p>
          <button
            type="button"
            onClick={() => void s.refetch()}
            className="rounded-lg border border-line-strong px-3 py-1.5 text-sm font-medium hover:bg-bg"
          >
            {en.queue.retry}
          </button>
        </div>
      )}
      {s.status === 'success' &&
        (s.current ? (
          <ReviewItem key={s.current.id} item={s.current} onDecide={(d) => s.decide(s.current!, d)} />
        ) : (
          <EmptyQueue />
        ))}

      <DecisionToast pending={s.pending} notice={s.notice} onUndo={s.undo} onDismiss={s.dismissNotice} />
    </main>
  )
}

function EmptyQueue() {
  return (
    <section className="rounded-xl border border-line bg-surface px-8 py-16">
      <h2 className="text-2xl font-semibold tracking-tight">{en.queue.emptyTitle}</h2>
      <p className="mt-2 max-w-[60ch] text-ink-2">{en.queue.emptyBody}</p>
    </section>
  )
}

function QueueSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <div className="h-4 w-80 rounded bg-sunken" />
      <div className="aspect-[6/1] w-full rounded-xl bg-sunken" />
      <div className="h-16 w-56 rounded bg-sunken" />
    </div>
  )
}
