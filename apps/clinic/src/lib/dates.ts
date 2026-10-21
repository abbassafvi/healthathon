const DAY: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }

/* A calendar date as printed on a document, e.g. "12 Oct 2026". */
export function formatDate(iso: string): string {
  // Parse as a local calendar date; new Date('2026-10-12') would be UTC midnight.
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', DAY)
}

/* A moment in time, e.g. "21 Oct 2026, 14:02". */
export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', { ...DAY, hour: '2-digit', minute: '2-digit' })
}
