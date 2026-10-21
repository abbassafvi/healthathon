import type { ReactNode } from 'react'

type Props = {
  children: ReactNode
  /* Shown only where the key works right now. */
  kbd?: string
  onClick: () => void
  disabled?: boolean
  primary?: boolean
  type?: 'button' | 'submit'
}

export function ActionButton({ children, kbd, onClick, disabled, primary, type = 'button' }: Props) {
  const tone = primary
    ? 'border-accent bg-accent text-accent-ink hover:bg-accent-hover hover:border-accent-hover'
    : 'border-line-strong bg-surface text-ink hover:bg-bg'
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      aria-keyshortcuts={kbd}
      className={`inline-flex h-10 items-center gap-2.5 rounded-lg border px-3.5 text-sm font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:border-line disabled:bg-sunken disabled:text-ink-3 ${tone}`}
    >
      {children}
      {kbd && (
        <kbd className={`kbd ${primary && !disabled ? 'border-transparent bg-accent-hover text-accent-ink' : ''}`}>
          {kbd === 'Enter' ? '↵' : kbd}
        </kbd>
      )}
    </button>
  )
}
