import { http, HttpResponse } from 'msw'

import type { GlucoseContext, PaperFormQuestion, PaperFormResult, PaperFormSubmission, PatientEntry } from '../../api/client'
import { patientById } from '../patients'
import { mockState } from '../state'

const CONTEXTS: GlucoseContext[] = ['fasting', 'before_meal', 'after_meal', 'bedtime', 'overnight', 'random']
const DAY = /^\d{4}-\d{2}-\d{2}$/
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/

/* The questions on this clinic's paper form, in the clinician-authored order. */
export const PAPER_QUESTIONS: PaperFormQuestion[] = [{ key: 'felt_unwell_today', text: 'Did you feel unwell today?' }]

const seen = new Map<string, number>()

function invalid(detail: string) {
  return HttpResponse.json({ detail }, { status: 422 })
}

export const paperFormHandlers = [
  http.get('/api/paper-form/questions', () => HttpResponse.json(PAPER_QUESTIONS)),

  http.post('/api/patients/:patientId/paper-form', async ({ params, request }) => {
    const patient = await patientById(String(params.patientId))
    if (!patient) return HttpResponse.json({ detail: 'No such patient' }, { status: 404 })
    const f = (await request.json()) as PaperFormSubmission
    if (!f.client_capture_id) return invalid('client_capture_id is required')
    if (seen.has(f.client_capture_id)) {
      const body: PaperFormResult = { created: seen.get(f.client_capture_id)!, duplicate: true }
      return HttpResponse.json(body)
    }
    if (!DAY.test(f.week_from) || !DAY.test(f.week_to) || f.week_from > f.week_to) return invalid('The form week is not valid')
    const inWeek = (d: string) => DAY.test(d) && d >= f.week_from && d <= f.week_to
    const state = mockState()
    const list = (state.entries[patient.registration_no] ??= [])
    const items = state.regimens
      .filter((r) => r.registration_no === patient.registration_no && r.activated_at)
      .flatMap((r) => r.items)

    for (const t of f.ticks) {
      if (!inWeek(t.date)) return invalid('A tick is outside the form week')
      if (!items.some((i) => i.id === t.regimen_item_id)) return invalid('A tick is for a medicine not on the checklist')
      const exists = list.some((e) => e.kind === 'medication_tick' && e.regimen_item.id === t.regimen_item_id && e.tick_date === t.date)
      if (exists) return HttpResponse.json({ detail: 'A tick for that medicine and day is already recorded' }, { status: 409 })
    }
    for (const g of f.glucose) {
      if (!inWeek(g.date)) return invalid('A reading is outside the form week')
      if (!/^\d+(\.\d+)?$/.test(g.value_text.trim())) return invalid('A reading must be a number as written')
      if (!CONTEXTS.includes(g.context)) return invalid('Every reading needs its context')
      if (g.time !== null && !TIME.test(g.time)) return invalid('A time must be HH:MM')
    }
    for (const a of f.answers) {
      if (!inWeek(a.date) || !a.answer_text.trim()) return invalid('An answer is empty or outside the form week')
      if (!PAPER_QUESTIONS.some((q) => q.key === a.question_key)) return invalid('Unknown question')
    }

    const now = new Date().toISOString().slice(0, 19)
    let n = 0
    const base = (id: string) => ({
      id, channel: 'paper_form' as const, entered_by: 'clinic_staff' as const, caregiver_name: null,
      language: f.language, recorded_at: now,
    })
    const created: PatientEntry[] = [
      ...f.ticks.map((t) => {
        const item = items.find((i) => i.id === t.regimen_item_id)!
        return {
          ...base(`pf-${f.client_capture_id}-${++n}`), kind: 'medication_tick' as const,
          regimen_item: { id: item.id, drug_text: item.drug_text, dose_text: item.dose_text, schedule_text: item.schedule_text },
          tick_date: t.date, ticked: t.ticked, occurred_at: `${t.date}T21:00:00`,
        }
      }),
      ...f.glucose.map((g) => ({
        ...base(`pf-${f.client_capture_id}-${++n}`), kind: 'glucose_reading' as const,
        value_text: g.value_text.trim(), context: g.context, insulin_units: g.insulin_units,
        occurred_at: `${g.date}T${g.time ?? '12:00'}:00`,
      })),
      ...f.answers.map((a) => {
        const q = PAPER_QUESTIONS.find((x) => x.key === a.question_key)!
        return {
          ...base(`pf-${f.client_capture_id}-${++n}`), kind: 'survey_answer' as const, set: 'daily' as const,
          question_key: q.key, question_text: q.text, question_text_shown: q.text,
          answer_text: a.answer_text.trim(), occurred_at: `${a.date}T20:00:00`,
        }
      }),
    ]
    list.push(...created)
    list.sort((a, b) => a.occurred_at.localeCompare(b.occurred_at))
    seen.set(f.client_capture_id, created.length)
    const body: PaperFormResult = { created: created.length, duplicate: false }
    return HttpResponse.json(body)
  }),
]

export function resetPaperFormIdempotency(): void {
  seen.clear()
}
