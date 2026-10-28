/*
 * Fictional patient-reported entries for the mock layer: four weeks of
 * ticks, glucose readings, answers and meal photos, generated from a
 * fixed seed per patient so tests see the same data every time.
 */
import type { AnswerEntry, Channel, EnteredBy, GlucoseContext, PatientEntry } from '../api/client'
import { localIsoDate } from '../lib/localDate'
import type { MockRegimen } from './state'

export const DAYS = 28

type Profile = {
  registration_no: string
  language: 'en' | 'hi' | 'ur'
  caregiver: string | null
  /* Share of days with a reading, and the usual range of values. */
  glucose: { perDay: number; low: number; high: number }
  sms: boolean
}

export const PROFILES: Profile[] = [
  { registration_no: 'DEV-0001', language: 'hi', caregiver: 'Priya Verma (daughter)', glucose: { perDay: 1.4, low: 118, high: 214 }, sms: false },
  { registration_no: 'DEV-0002', language: 'ur', caregiver: null, glucose: { perDay: 0.8, low: 104, high: 188 }, sms: true },
  { registration_no: 'DEV-0003', language: 'en', caregiver: null, glucose: { perDay: 1.1, low: 96, high: 176 }, sms: false },
]

type Question = { key: string; set: 'daily' | 'survey'; en: string; hi: string; ur: string; answers: Record<'en' | 'hi' | 'ur', string[]> }

const QUESTIONS: Question[] = [
  {
    key: 'felt_unwell_today', set: 'daily',
    en: 'Did you feel unwell today?', hi: 'क्या आज आपकी तबीयत ठीक नहीं थी?', ur: 'کیا آج آپ کی طبیعت ٹھیک نہیں تھی؟',
    answers: { en: ['No', 'No', 'No', 'A little dizzy in the morning'], hi: ['नहीं', 'नहीं', 'नहीं', 'सुबह थोड़ा चक्कर आया'], ur: ['نہیں', 'نہیں', 'نہیں', 'صبح تھوڑا چکر آیا'] },
  },
  {
    key: 'walk_days_week', set: 'survey',
    en: 'On how many days this week did you walk for 30 minutes?', hi: 'इस हफ़्ते कितने दिन आपने 30 मिनट सैर की?', ur: 'اس ہفتے کتنے دن آپ نے 30 منٹ سیر کی؟',
    answers: { en: ['4', '2', '5'], hi: ['4', '2', '5'], ur: ['4', '2', '5'] },
  },
  {
    key: 'skipped_meal_week', set: 'survey',
    en: 'Did you skip a meal this week?', hi: 'क्या इस हफ़्ते आपने कोई खाना छोड़ा?', ur: 'کیا اس ہفتے آپ نے کوئی کھانا چھوڑا؟',
    answers: { en: ['No', 'Yes, twice'], hi: ['नहीं', 'हाँ, दो बार'], ur: ['نہیں', 'ہاں، دو بار'] },
  },
]

const CONTEXTS: GlucoseContext[] = ['fasting', 'after_meal', 'before_meal', 'bedtime', 'fasting', 'after_meal']

/* mulberry32: small, fast, deterministic. */
function rng(seedText: string) {
  let a = [...seedText].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 2654435761), 1779033703) >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const at = (day: string, hh: number, mm: number) => `${day}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00`

export function generateEntries(regimens: MockRegimen[], now: Date): Record<string, PatientEntry[]> {
  const out: Record<string, PatientEntry[]> = {}
  for (const p of PROFILES) {
    const r = rng(p.registration_no)
    const list: PatientEntry[] = []
    let n = 0
    const id = () => `e-${p.registration_no}-${++n}`
    const who = (): { entered_by: EnteredBy; caregiver_name: string | null; channel: Channel } => {
      const x = r()
      if (p.caregiver && x < 0.15) return { entered_by: 'caregiver', caregiver_name: p.caregiver, channel: 'patient_app' }
      if (x < 0.25) return { entered_by: 'clinic_staff', caregiver_name: null, channel: 'paper_form' }
      if (p.sms && x < 0.45) return { entered_by: 'patient', caregiver_name: null, channel: 'sms' }
      return { entered_by: 'patient', caregiver_name: null, channel: 'patient_app' }
    }
    const regimen = regimens.find((x) => x.registration_no === p.registration_no && x.activated_at)

    for (let back = DAYS - 1; back >= 0; back--) {
      const d = new Date(now)
      d.setDate(d.getDate() - back)
      const day = localIsoDate(d)
      const base = { language: p.language }

      // Ticks: only from the day the checklist was activated.
      if (regimen && day >= regimen.activated_at!.slice(0, 10)) {
        const source = who()
        for (const item of regimen.items) {
          const x = r()
          if (x < 0.08) continue // no entry: a gap, never filled in
          list.push({
            ...base, ...source, id: id(), kind: 'medication_tick',
            regimen_item: { id: item.id, drug_text: item.drug_text, dose_text: item.dose_text, schedule_text: item.schedule_text },
            tick_date: day, ticked: x >= 0.15,
            occurred_at: at(day, 21, Math.floor(r() * 50)), recorded_at: at(day, 21, 55),
          })
        }
      }

      // Glucose readings, each with its context.
      const readings = Math.floor(p.glucose.perDay + r() - 0.3)
      for (let i = 0; i < readings; i++) {
        const context = CONTEXTS[Math.floor(r() * CONTEXTS.length)]
        const value = Math.round(p.glucose.low + r() * (p.glucose.high - p.glucose.low))
        const hour = context === 'fasting' ? 7 : context === 'bedtime' ? 22 : context === 'before_meal' ? 13 : 15
        list.push({
          ...base, ...who(), id: id(), kind: 'glucose_reading',
          value_text: String(value), context, insulin_units: p.registration_no === 'DEV-0002' && context === 'bedtime' ? 14 : null,
          occurred_at: at(day, hour, Math.floor(r() * 59)), recorded_at: at(day, hour, 59),
        })
      }

      // The day's question, most days; the short survey on Sundays.
      for (const q of QUESTIONS.filter((x) => (x.set === 'daily' ? r() < 0.8 : d.getDay() === 0))) {
        const answers = q.answers[p.language]
        const entry: AnswerEntry = {
          ...base, ...who(), id: id(), kind: 'survey_answer', set: q.set, question_key: q.key,
          question_text: q.en, question_text_shown: q[p.language], answer_text: answers[Math.floor(r() * answers.length)],
          occurred_at: at(day, 20, Math.floor(r() * 59)), recorded_at: at(day, 20, 59),
        }
        list.push(entry)
      }

      // A meal photograph every few days.
      if (r() < 0.3) {
        const eid = id()
        // A photograph only arrives through the app, from the patient or a caregiver.
        const viaApp = p.caregiver && r() < 0.2
          ? { entered_by: 'caregiver' as const, caregiver_name: p.caregiver, channel: 'patient_app' as const }
          : { entered_by: 'patient' as const, caregiver_name: null, channel: 'patient_app' as const }
        list.push({
          ...base, ...viaApp, id: eid, kind: 'meal_photo', photo_url: `/mock/meals/${eid}.svg`,
          occurred_at: at(day, 13, Math.floor(r() * 59)), recorded_at: at(day, 13, 59),
          meal: 'lunch', calories_text: null,
        })
      }
    }
    out[p.registration_no] = list.sort((a, b) => a.occurred_at.localeCompare(b.occurred_at))
  }
  return out
}

/* A drawn plate, standing in for a meal photograph. No estimate of any kind. */
export function mealSvg(seed: string): string {
  const r = rng(seed)
  const hues = [32, 48, 95, 12, 140]
  const blobs = Array.from({ length: 4 }, (_, i) => {
    const a = (i / 4) * Math.PI * 2 + r()
    const x = 320 + Math.cos(a) * 95
    const y = 240 + Math.sin(a) * 85
    return `<ellipse cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" rx="${55 + r() * 25}" ry="${40 + r() * 20}" fill="hsl(${hues[i]} 55% ${45 + r() * 20}%)"/>`
  }).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 480" width="640" height="480">
<rect width="640" height="480" fill="hsl(30 20% 72%)"/>
<circle cx="320" cy="240" r="200" fill="#f4f2ee" stroke="#d6d2ca" stroke-width="6"/>
${blobs}
<text x="20" y="460" font-family="Arial, sans-serif" font-size="18" fill="#3a3a3a">Fictional meal photograph</text>
</svg>`
}
