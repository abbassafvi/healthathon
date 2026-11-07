import type { Lang } from '../theme'
import { readPhoto } from './readPhoto'
import type { Meal, PastDays, PatientApi, PatientDoc, Reading, Recording, SignedIn, SurveyQuestion, Today, UploadStatus } from './types'

/* A request the API refused or could not answer. `status` is 0 when the network failed. */
export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

type Options = {
  baseUrl: string
  /* The language the patient is using now; written answers are stored with it. */
  language: () => Lang
  /* The signed-in phone's token, sent on every patient route. */
  token?: () => string | null
  fetch?: typeof fetch
  /* Reads a photo the phone saved; expo-file-system on Android, fetch on the web. */
  readPhoto?: (uri: string) => Promise<{ body: BodyInit; type: string }>
}

/*
 * PatientApi over HTTP, against /api/app on the clinic's server. Every
 * write sends the capture id made on the device, so a retried request is
 * stored once. Photos are sent as they are taken.
 */
export function createHttpApi({ baseUrl, language, token = () => null, fetch: f = fetch, readPhoto: read = readPhoto }: Options): PatientApi {
  const root = baseUrl.replace(/\/+$/, '')
  const url = (path: string) => `${root}/api/app${path}`
  const abs = (path: string) => (path.startsWith('/') ? `${root}${path}` : path)

  async function call<T>(path: string, init?: RequestInit): Promise<T> {
    let res: Response
    const t = path.startsWith('/patients/') ? token() : null
    const headers = t ? { ...(init?.headers as Record<string, string> | undefined), Authorization: `Bearer ${t}` } : init?.headers
    try {
      res = await f(url(path), headers ? { ...init, headers } : init)
    } catch {
      throw new ApiError(0, 'The server could not be reached')
    }
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { detail?: unknown } | null
      throw new ApiError(res.status, typeof body?.detail === 'string' ? body.detail : res.statusText)
    }
    if (res.status === 204) return undefined as T
    return (await res.json()) as T
  }
  const send = <T>(method: string, path: string, body: unknown) =>
    call<T>(path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const p = (id: string) => `/patients/${encodeURIComponent(id)}`

  return {
    startSignIn: (phone) => send<{ demo_code: string | null }>('POST', '/sign-in/start', { phone }),
    checkSignIn: (phone, code) => send<SignedIn>('POST', '/sign-in/check', { phone, code }),
    async today(patientId) {
      const t = await call<Today>(`${p(patientId)}/today`)
      return { ...t, answer_audio_uri: t.answer_audio_uri && abs(t.answer_audio_uri), meals: t.meals.map((m) => ({ ...m, uri: abs(m.uri) })) }
    },
    setTick: (patientId, itemId, ticked, captureId) =>
      send<void>('PUT', `${p(patientId)}/ticks/${encodeURIComponent(itemId)}`, { ticked, capture_id: captureId }),
    addReading: (patientId, r, captureId) =>
      send<Reading>('POST', `${p(patientId)}/readings`, { ...r, capture_id: captureId, language: language() }),
    answer: (patientId, questionKey, text, captureId, audioKey) =>
      send<void>('POST', `${p(patientId)}/answers`, {
        question_key: questionKey,
        answer_text: text,
        ...(audioKey ? { audio_key: audioKey } : {}),
        capture_id: captureId,
        language: language(),
      }),
    async uploadRecording(patientId, uri, captureId) {
      let file: { body: BodyInit; type: string }
      try {
        file = await read(uri)
      } catch {
        throw new ApiError(0, 'The recording could not be read')
      }
      // Android records MPEG-4 audio (.m4a), a browser WebM.
      const type = file.type || (uri.endsWith('.m4a') ? 'audio/mp4' : 'audio/webm')
      const rec = await call<Recording>(`${p(patientId)}/recordings?capture_id=${encodeURIComponent(captureId)}`, {
        method: 'POST',
        headers: { 'Content-Type': type },
        body: file.body,
      })
      return { ...rec, uri: abs(rec.uri) }
    },
    async addMeal(patientId, m, captureId) {
      let photo: { body: BodyInit; type: string }
      try {
        photo = await read(m.uri)
      } catch {
        throw new ApiError(0, 'The photo could not be read')
      }
      const q = new URLSearchParams({ capture_id: captureId, meal: m.meal, taken_at: m.takenAt.toISOString() })
      if (m.calories) q.set('calories', m.calories)
      const meal = await call<Meal>(`${p(patientId)}/meals?${q}`, {
        method: 'POST',
        headers: { 'Content-Type': photo.type || 'image/jpeg' },
        body: photo.body,
      })
      return { ...meal, uri: abs(meal.uri) }
    },
    async sendDocument(patientId, d, captureId) {
      let photo: { body: BodyInit; type: string }
      try {
        photo = await read(d.uri)
      } catch {
        throw new ApiError(0, 'The photo could not be read')
      }
      const q = new URLSearchParams({ capture_id: captureId, doc_type: d.docType, captured_at: d.takenAt.toISOString() })
      return call<UploadStatus>(`${p(patientId)}/documents?${q}`, {
        method: 'POST',
        headers: { 'Content-Type': photo.type || 'image/jpeg' },
        body: photo.body,
      })
    },
    uploadStatus: (patientId, uploadId) => call<UploadStatus>(`${p(patientId)}/uploads/${uploadId}`),
    async documents(patientId) {
      const docs = await call<PatientDoc[]>(`${p(patientId)}/documents`)
      return docs.map((d) => ({ ...d, page_uri: d.page_uri ? abs(d.page_uri) : null }))
    },
    surveyQuestions: (patientId) => call<SurveyQuestion[]>(`${p(patientId)}/survey`),
    submitSurvey: (patientId, answers, captureId, recordings = {}) =>
      send<void>('POST', `${p(patientId)}/survey`, { answers, recordings, capture_id: captureId, language: language() }),
    async pastDays(patientId, before) {
      const page = await call<PastDays>(`${p(patientId)}/days${before ? `?before=${encodeURIComponent(before)}` : ''}`)
      return {
        ...page,
        days: page.days.map((d) => ({
          ...d,
          answers: d.answers.map((a) => ({ ...a, audio_uri: a.audio_uri && abs(a.audio_uri) })),
          meals: d.meals.map((m) => ({ ...m, uri: abs(m.uri) })),
        })),
      }
    },
  }
}
