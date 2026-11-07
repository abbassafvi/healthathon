import { appendDictated, dictationAvailable, useDictation } from '../lib/dictation'
import { en, fmt } from '../strings/en'

/*
 * A microphone beside a free-text field. What is said is added to the
 * field as text, where it can be read and corrected before anything is
 * saved. Not offered on values, doses, dates or phone numbers: a misheard
 * number is too easy to miss.
 */
export function DictateButton({ field, lang = 'en', value, onChange, className = '' }: {
  field: string
  lang?: string
  value: string
  onChange: (next: string) => void
  className?: string
}) {
  const { listening, error, start, stop } = useDictation(lang, (text) => onChange(appendDictated(value, text)))
  if (!dictationAvailable()) return null
  return (
    <>
      <button
        type="button"
        onClick={listening ? stop : start}
        aria-pressed={listening}
        aria-label={listening ? en.dictation.stop : fmt(en.dictation.start, { field })}
        title={listening ? en.dictation.stop : fmt(en.dictation.start, { field })}
        data-testid="dictate"
        className={`grid size-9 shrink-0 place-items-center rounded-lg border transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-accent ${
          listening ? 'border-accent bg-accent text-accent-ink' : 'border-line-strong bg-surface text-ink-2 hover:bg-sunken'
        } ${className}`}
      >
        <svg aria-hidden viewBox="0 0 24 24" className={`size-4 ${listening ? 'animate-pulse motion-reduce:animate-none' : ''}`} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="9" y="3" width="6" height="11" rx="3" />
          <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
        </svg>
      </button>
      <span aria-live="polite" className="sr-only">{listening ? en.dictation.listening : ''}</span>
      {error && (
        <span role="alert" className="basis-full text-xs text-ink-2">
          {error === 'denied' ? en.dictation.denied : en.dictation.failed}
        </span>
      )}
    </>
  )
}
