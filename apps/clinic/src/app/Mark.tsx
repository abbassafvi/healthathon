/*
 * The product mark: a page with one region outlined, because every value
 * on screen leads back to a region on a page. The same drawing is the
 * favicon. Decorative wherever it appears beside the product name.
 */
export function Mark({ className = 'size-6' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={className}>
      <rect width="32" height="32" rx="8" className="fill-accent" />
      <rect x="8" y="9" width="16" height="10" rx="2" fill="none" stroke="white" strokeWidth="2" />
      <path d="M11 24h10" stroke="white" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}
