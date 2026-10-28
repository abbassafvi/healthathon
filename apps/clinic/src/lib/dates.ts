import { en, fmt } from '../strings/en'
import { localIsoDate } from './localDate'

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

/*
 * A moment near today says which day in words: "Today, 10:00",
 * "Yesterday, 21:40", "Tomorrow, 10:30". Anything further is a date.
 */
export function formatWhen(iso: string, now: Date = new Date()): string {
  const at = new Date(iso)
  const day = localIsoDate(at)
  const time = at.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  const offset = (n: number) => localIsoDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() + n))
  if (day === offset(0)) return fmt(en.dates.today, { time })
  if (day === offset(1)) return fmt(en.dates.tomorrow, { time })
  if (day === offset(-1)) return fmt(en.dates.yesterday, { time })
  return formatDateTime(iso)
}
