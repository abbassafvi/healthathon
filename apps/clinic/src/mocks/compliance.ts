/*
 * Mock of the compliance score computation (Track A will build the real
 * one). Ticks only: a cell is ticked, not ticked, or a gap. Nothing from
 * glucose readings or answers goes in.
 */
import type { ComplianceScore, PatientEntry, TickEntry } from '../api/client'
import { localIsoDate } from '../lib/localDate'
import type { MockRegimen } from './state'

export function computeScore(
  regimen: MockRegimen | undefined,
  entries: PatientEntry[],
  from: string,
  to: string,
  now: Date,
): ComplianceScore | null {
  if (!regimen?.activated_at) return null
  const start = regimen.activated_at.slice(0, 10) > from ? regimen.activated_at.slice(0, 10) : from
  const days: string[] = []
  for (const d = new Date(`${start}T12:00:00`); localIsoDate(d) <= to; d.setDate(d.getDate() + 1)) days.push(localIsoDate(d))
  const ticks = entries.filter((e): e is TickEntry => e.kind === 'medication_tick')
  const rows = regimen.items.map((item) => ({
    item: { id: item.id, drug_text: item.drug_text, dose_text: item.dose_text, schedule_text: item.schedule_text },
    days: days.map((date) => {
      const t = ticks.find((x) => x.regimen_item.id === item.id && x.tick_date === date)
      return { date, state: t ? (t.ticked ? 'ticked' : 'not_ticked') : 'no_entry', entry_id: t?.id ?? null } as const
    }),
  }))
  const cells = rows.flatMap((r) => r.days)
  const ticked = cells.filter((c) => c.state === 'ticked').length
  return {
    id: `score-${regimen.registration_no}-${to}`,
    period_from: start,
    period_to: to,
    ticked_count: ticked,
    expected_count: cells.length,
    score_percent: cells.length ? Math.round((ticked / cells.length) * 100) : 0,
    computed_at: `${localIsoDate(now)}T06:00:00`,
    rows,
  }
}
