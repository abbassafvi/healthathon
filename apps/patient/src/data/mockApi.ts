import type { ChecklistItem, GlucoseContext, Meal, PatientApi, PatientDoc, PatientRef, Question, Reading, Today, UploadStatus } from './types'

/*
 * In-memory stand-in for the patient endpoints, with the four fictional
 * seed patients. Writes are idempotent by capture id, as the real ones
 * must be. Nothing here computes anything about the readings.
 */
const MOCK_CODE = '123456'
const PHONES: Record<string, string> = Object.fromEntries([1, 2, 3, 4].map((n) => [`555000000${n}`, `DEV-000${n}`]))
/* The last ten digits, so +91 55500 00001 and 55500 00001 are the same number. */
const digits = (phone: string) => phone.replace(/\D/g, '').slice(-10)

const PATIENTS: PatientRef[] = [
  { id: 'DEV-0001', registration_no: 'DEV-0001', full_name: 'Asha Verma', preferred_language: 'hi' },
  { id: 'DEV-0002', registration_no: 'DEV-0002', full_name: 'Imran Qureshi', preferred_language: 'ur' },
  { id: 'DEV-0003', registration_no: 'DEV-0003', full_name: 'Meera Pillai', preferred_language: 'en' },
  { id: 'DEV-0004', registration_no: 'DEV-0004', full_name: 'Rakesh Yadav', preferred_language: 'hi' },
]

const CHECKLISTS: Record<string, ChecklistItem[]> = {
  'DEV-0001': [
    { id: 'rx-0001-a-item-1', drug_text: 'Tab. Metformin', dose_text: '500 mg', schedule_text: '1-0-1' },
    { id: 'rx-0001-a-item-2', drug_text: 'Tab. Glimepiride', dose_text: '1 mg', schedule_text: '1-0-0' },
    { id: 'rx-0001-a-item-3', drug_text: 'Tab. Atorvastatin', dose_text: '10 mg', schedule_text: '0-0-1' },
  ],
  'DEV-0003': [
    { id: 'rx-0003-a-item-1', drug_text: 'Tab. Metformin', dose_text: '500 mg', schedule_text: '1-1-1' },
    { id: 'rx-0003-a-item-2', drug_text: 'Tab. Empagliflozin', dose_text: '10 mg', schedule_text: '1-0-0' },
  ],
}

export const DAILY_QUESTION: Question = {
  key: 'felt_unwell_today',
  text: { en: 'Did you feel unwell today?', hi: 'क्या आज आपकी तबीयत ठीक नहीं थी?', ur: 'کیا آج آپ کی طبیعت ٹھیک نہیں تھی؟' },
}

const SURVEY: Question[] = [
  {
    key: 'walk_days_week',
    text: { en: 'On how many days this week did you walk for 30 minutes?', hi: 'इस हफ़्ते कितने दिन आपने 30 मिनट सैर की?', ur: 'اس ہفتے کتنے دن آپ نے 30 منٹ سیر کی؟' },
  },
  {
    key: 'skipped_meal_week',
    text: { en: 'Did you skip a meal this week?', hi: 'क्या इस हफ़्ते आपने कोई खाना छोड़ा?', ur: 'کیا اس ہفتے آپ نے کوئی کھانا چھوڑا؟' },
  },
]

const CONTEXTS: GlucoseContext[] = ['fasting', 'before_meal', 'after_meal', 'bedtime', 'overnight', 'random']

type DayState = { ticks: Record<string, boolean>; readings: Reading[]; answer: string | null; answerAudio: string | null; meals: Meal[] }

export function localDay(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/* The Monday of d's week, so the survey is asked once a week. */
function weekOf(d: Date): string {
  const m = new Date(d)
  m.setDate(m.getDate() - ((m.getDay() + 6) % 7))
  return localDay(m)
}

export function createMockApi(clock: () => Date = () => new Date()): PatientApi & { reset(): void } {
  let days = new Map<string, DayState>()
  let surveys = new Set<string>()
  let seen = new Set<string>()
  // Recording key -> the recording on this phone.
  let recordings = new Map<string, string>()
  // Pages on the record, newest first, and the upload each capture made.
  let docs: PatientDoc[] = []
  let uploads = new Map<string, UploadStatus>()
  let n = 0

  const day = (pid: string): DayState => {
    const key = `${pid}|${localDay(clock())}`
    if (!days.has(key)) days.set(key, { ticks: {}, readings: [], answer: null, answerAudio: null, meals: [] })
    return days.get(key)!
  }
  const patient = (pid: string) => {
    const p = PATIENTS.find((x) => x.id === pid)
    if (!p) throw new Error('No such patient')
    return p
  }
  // A retried write with the same capture id does nothing the second time.
  const once = (captureId: string) => {
    if (!captureId) throw new Error('A capture id is required')
    if (seen.has(captureId)) return false
    seen.add(captureId)
    return true
  }
  const time = () => clock().toISOString()

  return {
    reset() {
      days = new Map()
      surveys = new Set()
      seen = new Set()
      recordings = new Map()
      docs = []
      uploads = new Map()
      n = 0
    },
    // The fictional patients' numbers, as the dev seed gives them; the code is always 123456.
    async startSignIn(phone) {
      return { demo_code: PHONES[digits(phone)] ? MOCK_CODE : null }
    },
    async checkSignIn(phone, code) {
      const p = PATIENTS.find((x) => x.id === PHONES[digits(phone)])
      if (!p || code !== MOCK_CODE) throw new Error('That code is not right, or it has run out')
      return { token: `mock-${p.id}`, patient: p }
    },
    async today(pid) {
      const p = patient(pid)
      const s = day(pid)
      const t: Today = {
        date: localDay(clock()),
        patient: p,
        items: CHECKLISTS[pid] ?? [],
        ticks: { ...s.ticks },
        readings: [...s.readings],
        question: DAILY_QUESTION,
        answer: s.answer,
        answer_audio_uri: s.answerAudio,
        meals: [...s.meals],
        survey: { open: true, done: surveys.has(`${pid}|${weekOf(clock())}`) },
      }
      return t
    },
    async setTick(pid, itemId, ticked, captureId) {
      patient(pid)
      if (!(CHECKLISTS[pid] ?? []).some((i) => i.id === itemId)) throw new Error('Not on this checklist')
      if (!once(captureId)) return
      const s = day(pid)
      if (ticked === null) delete s.ticks[itemId]
      else s.ticks[itemId] = ticked
    },
    async addReading(pid, r, captureId) {
      patient(pid)
      const value = r.value_text.trim()
      if (!/^\d+(\.\d+)?$/.test(value)) throw new Error('A reading must be a number')
      if (!CONTEXTS.includes(r.context)) throw new Error('A reading needs its context')
      const s = day(pid)
      if (!once(captureId)) return s.readings.find((x) => x.id === captureId)!
      const reading: Reading = { id: captureId, value_text: value, context: r.context, occurred_at: time() }
      s.readings.push(reading)
      return reading
    },
    async answer(pid, key, text, captureId, audioKey) {
      patient(pid)
      if (!text?.trim() && !audioKey) throw new Error('An answer cannot be empty')
      if (audioKey && !recordings.has(audioKey)) throw new Error('That recording was not sent from this phone')
      if (key !== DAILY_QUESTION.key) throw new Error('Unknown question')
      if (!once(captureId)) return
      const s = day(pid)
      s.answer = text?.trim() || null
      s.answerAudio = audioKey ? recordings.get(audioKey)! : null
    },
    async uploadRecording(pid, uri, captureId) {
      patient(pid)
      const key = `voice/${pid}/${captureId}.m4a`
      recordings.set(key, uri)
      return { key, uri }
    },
    async addMeal(pid, m, captureId) {
      patient(pid)
      const s = day(pid)
      if (!once(captureId)) return s.meals.find((x) => x.id === captureId)!
      if (m.calories !== null && !/^\d{1,4}$/.test(m.calories)) throw new Error('Calories are a number, as typed')
      const meal: Meal = { id: captureId, uri: m.uri, occurred_at: m.takenAt.toISOString(), meal: m.meal, calories_text: m.calories }
      s.meals.push(meal)
      n++
      return meal
    },
    async surveyQuestions(pid) {
      patient(pid)
      return SURVEY
    },
    async submitSurvey(pid, answers, captureId, spoken = {}) {
      patient(pid)
      if (SURVEY.some((q) => !answers[q.key]?.trim() && !recordings.has(spoken[q.key]))) throw new Error('Every question needs an answer')
      if (!once(captureId)) return
      surveys.add(`${pid}|${weekOf(clock())}`)
    },
    // Every earlier day this mock has seen, newest first, in one page.
    async pastDays(pid, before) {
      patient(pid)
      const end = before ?? localDay(clock())
      const items = CHECKLISTS[pid] ?? []
      const past = [...days.entries()]
        .map(([key, s]) => ({ date: key.split('|')[1], who: key.split('|')[0], s }))
        .filter((d) => d.who === pid && d.date < end)
        .sort((a, b) => b.date.localeCompare(a.date))
        .map(({ date, s }) => ({
          date,
          ticks: items.map((item) => ({ item, ticked: item.id in s.ticks ? s.ticks[item.id] : null })),
          readings: [...s.readings],
          answers: s.answer || s.answerAudio
            ? [{ question: DAILY_QUESTION, answer_text: s.answer, audio_uri: s.answerAudio, occurred_at: `${date}T20:00:00` }]
            : [],
          meals: [...s.meals],
        }))
      return { days: past, next_before: null }
    },

    /*
     * A page sent from the phone. The mock reads it at once, where the
     * real pipeline takes seconds, and settles nothing: every reading
     * comes back unchecked, which is what a clinician has not seen yet.
     */
    async sendDocument(pid, d, captureId) {
      patient(pid)
      const existing = uploads.get(captureId)
      if (existing) return { ...existing, stage: 'duplicate' }
      const id = `doc-${docs.length + 1}`
      docs.unshift({
        id,
        doc_type: d.docType,
        document_date: null,
        received_at: d.takenAt.toISOString(),
        sent_from: 'patient_app',
        page_uri: d.uri,
        lines: d.docType === 'prescription'
          ? [{ drug_text: 'Tab. Metformin', dose_text: '500 mg', schedule_text: '1-0-1', checked: false }]
          : [],
        values: d.docType === 'lab_report'
          ? [{ analyte_name: 'HbA1c', value_text: null, unit_text: null, checked: false }]
          : [],
        advice: [],
      })
      const status: UploadStatus = { id, stage: 'done', document_id: id, failure: null }
      uploads.set(captureId, status)
      return status
    },
    async uploadStatus(pid, uploadId) {
      patient(pid)
      const found = [...uploads.values()].find((u) => u.id === uploadId)
      if (!found) throw new Error('No such upload')
      return found
    },
    async documents(pid) {
      patient(pid)
      return docs.map((d) => ({ ...d }))
    },
  }
}

export const api = createMockApi()
