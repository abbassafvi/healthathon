import { useLayoutEffect } from 'react'

import { hasModifier, isTypingTarget } from '../lib/keys'
import { en, fmt } from '../strings/en'
import type { Notice, Pending } from './useReviewSession'

type Props = {
  pending: Pending | null
  notice: Notice | null
  onUndo: () => void
  onDismiss: () => void
}

function describe({ item, decision }: Pending): string {
  const read = [item.value_text, item.unit_text].filter(Boolean).join(' ')
  if (decision.action === 'confirm') return fmt(en.queue.decidedConfirm, { value: read })
  if (decision.action === 'discard') return en.queue.decidedDiscard
  const typed = [decision.value_text, decision.unit_text].filter(Boolean).join(' ')
  return fmt(en.queue.decidedCorrect, { value: typed })
}

/*
 * The held decision, with Undo (Z) while it is still on the client, and
 * any notice about a decision that did not land.
 */
export function DecisionToast({ pending, notice, onUndo, onDismiss }: Props) {
  // Layout effect: Z works from the moment Undo is shown.
  useLayoutEffect(() => {
    if (!pending) return
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target) || hasModifier(e)) return
      if (e.key.toLowerCase() === 'z') onUndo()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pending, onUndo])

  const message = notice ? en.queue[notice] : pending ? describe(pending) : null

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-6 z-(--z-toast) flex justify-center px-4"
    >
      {message && (
        <div className="animate-crop-in pointer-events-auto flex items-center gap-4 rounded-xl bg-ink py-2.5 pr-2.5 pl-4 text-sm text-surface shadow-lg">
          <span>{message}</span>
          {notice ? (
            <button type="button" onClick={onDismiss} className="rounded-md px-2 py-1 text-surface/70 hover:text-surface">
              {en.queue.cancel}
            </button>
          ) : (
            <button
              type="button"
              onClick={onUndo}
              aria-keyshortcuts="Z"
              className="flex items-center gap-2 rounded-lg bg-surface/10 px-3 py-1.5 font-medium hover:bg-surface/20"
            >
              {en.queue.undo}
              <kbd className="font-mono text-xs text-surface/70">Z</kbd>
            </button>
          )}
        </div>
      )}
    </div>
  )
}
