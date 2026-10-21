import type { GlucoseContext, PaperFormSubmission } from '../api/pending'

export type CellValue = 'ticked' | 'not_ticked' | 'blank'
export type GlucoseDraft = { key: string; date: string; time: string; value: string; context: GlucoseContext | ''; insulin: string }
export type Draft = {
  weekFrom: string
  language: string
  cells: Record<string, CellValue> // `${itemId}|${date}`
  glucose: GlucoseDraft[]
  answers: Record<string, string> // `${questionKey}|${date}`
}

export const cellKey = (itemId: string, date: string) => `${itemId}|${date}`
export const answerKey = (questionKey: string, date: string) => `${questionKey}|${date}`

export function weekDates(from: string): string[] {
  const out: string[] = []
  const d = new Date(`${from}T12:00:00`)
  for (let i = 0; i < 7; i++) {
    const p = (n: number) => String(n).padStart(2, '0')
    out.push(`${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`)
    d.setDate(d.getDate() + 1)
  }
  return out
}

/* Cycle used by Space: blank, then ticked, then not ticked, then blank. */
export function nextCell(v: CellValue): CellValue {
  return v === 'blank' ? 'ticked' : v === 'ticked' ? 'not_ticked' : 'blank'
}

export type Problem = { field: string; message: string }

/* Checks a reading is written down, not what it says. No range, no judgement. */
export function validate(d: Draft): Problem[] {
  const problems: Problem[] = []
  d.glucose.forEach((g, i) => {
    const n = i + 1
    if (!g.value.trim()) problems.push({ field: `glucose-${g.key}-value`, message: `Reading ${n} has no value.` })
    else if (!/^\d+(\.\d+)?$/.test(g.value.trim())) problems.push({ field: `glucose-${g.key}-value`, message: `Reading ${n} must be a number, as written.` })
    if (!g.context) problems.push({ field: `glucose-${g.key}-context`, message: `Reading ${n} needs its context.` })
    if (g.insulin.trim() && !/^\d+(\.\d+)?$/.test(g.insulin.trim())) {
      problems.push({ field: `glucose-${g.key}-insulin`, message: `Reading ${n}: insulin units must be a number.` })
    }
  })
  return problems
}

export function toSubmission(d: Draft, captureId: string): PaperFormSubmission {
  const dates = weekDates(d.weekFrom)
  return {
    client_capture_id: captureId,
    week_from: dates[0],
    week_to: dates[6],
    language: d.language,
    ticks: Object.entries(d.cells)
      .filter(([, v]) => v !== 'blank')
      .map(([k, v]) => {
        const [regimen_item_id, date] = k.split('|')
        return { regimen_item_id, date, ticked: v === 'ticked' }
      }),
    glucose: d.glucose.map((g) => ({
      date: g.date,
      time: g.time || null,
      value_text: g.value.trim(),
      context: g.context as GlucoseContext,
      insulin_units: g.insulin.trim() ? Number(g.insulin) : null,
    })),
    answers: Object.entries(d.answers)
      .filter(([, v]) => v.trim())
      .map(([k, v]) => {
        const [question_key, date] = k.split('|')
        return { question_key, date, answer_text: v.trim() }
      }),
  }
}

export function counts(s: PaperFormSubmission) {
  return {
    ticked: s.ticks.filter((t) => t.ticked).length,
    notTicked: s.ticks.filter((t) => !t.ticked).length,
    readings: s.glucose.length,
    answers: s.answers.length,
  }
}
