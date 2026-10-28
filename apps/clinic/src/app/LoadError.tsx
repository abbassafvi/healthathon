import { en } from '../strings/en'
import { BUTTON } from './page'

/*
 * A screen that could not load says what failed, in words, and offers to
 * try again. The message is announced when it appears.
 */
export function LoadError({ message, onRetry, retrying = false, className = '' }: {
  message: string
  onRetry: () => void
  retrying?: boolean
  className?: string
}) {
  return (
    <div role="alert" className={`flex flex-wrap items-center justify-between gap-x-6 gap-y-3 rounded-lg border border-line-strong bg-surface px-4 py-3 ${className}`}>
      <p className="text-sm">{message}</p>
      <button type="button" onClick={onRetry} disabled={retrying} className={BUTTON}>
        {retrying ? en.app.retrying : en.app.retry}
      </button>
    </div>
  )
}
