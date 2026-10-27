import type { EntriesPage, TickEntry } from '../api/client'

export type RegimenItemSpan = EntriesPage['regimen_items'][number]
export type TickState = 'ticked' | 'not_ticked' | 'no_entry'

/* The state of one medicine on one day. A day with no tick is a gap, shown as such. */
export function tickState(ticks: TickEntry[], itemId: string, day: string): { state: TickState; tick?: TickEntry } {
  const tick = ticks.find((t) => t.regimen_item.id === itemId && t.tick_date === day)
  if (!tick) return { state: 'no_entry' }
  return { state: tick.ticked ? 'ticked' : 'not_ticked', tick }
}

/* Medicines that were on the active checklist on that day. */
export function itemsOn(items: RegimenItemSpan[], day: string): RegimenItemSpan[] {
  return items.filter((i) => i.active_from <= day && (!i.active_until || i.active_until > day))
}

export function time(iso: string): string {
  return iso.slice(11, 16)
}
