import type { Lang } from '../theme'
import type { Meal, PatientApi, PatientRef, Reading, SurveyQuestion, Today } from './types'

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
  fetch?: typeof fetch
}

/*
 * PatientApi over HTTP, against /api/app on the clinic's server. Every
 * write sends the capture id made on the device, so a retried request is
 * stored once. Photos are sent as they are taken.
 */
export function createHttpApi({ baseUrl, language, fetch: f = fetch }: Options): PatientApi {
  const root = baseUrl.replace(/\/+$/, '')
  const url = (path: string) => `${root}/api/app${path}`
  const abs = (path: string) => (path.startsWith('/') ? `${root}${path}` : path)

  async function call<T>(path: string, init?: RequestInit): Promise<T> {
    let res: Response
    try {
      res = await f(url(path), init)
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
    patients: () => call<PatientRef[]>('/patients'),
    async today(patientId) {
      const t = await call<Today>(`${p(patientId)}/today`)
      return { ...t, meals: t.meals.map((m) => ({ ...m, uri: abs(m.uri) })) }
    },
    setTick: (patientId, itemId, ticked, captureId) =>
      send<void>('PUT', `${p(patientId)}/ticks/${encodeURIComponent(itemId)}`, { ticked, capture_id: captureId }),
    addReading: (patientId, r, captureId) =>
      send<Reading>('POST', `${p(patientId)}/readings`, { ...r, capture_id: captureId, language: language() }),
    answer: (patientId, questionKey, text, captureId) =>
      send<void>('POST', `${p(patientId)}/answers`, {
        question_key: questionKey,
        answer_text: text,
        capture_id: captureId,
        language: language(),
      }),
    async addMeal(patientId, uri, captureId) {
      let photo: Blob
      try {
        photo = await (await f(uri)).blob()
      } catch {
        throw new ApiError(0, 'The photo could not be read')
      }
      const meal = await call<Meal>(`${p(patientId)}/meals?capture_id=${encodeURIComponent(captureId)}`, {
        method: 'POST',
        headers: { 'Content-Type': photo.type || 'image/jpeg' },
        body: photo,
      })
      return { ...meal, uri: abs(meal.uri) }
    },
    surveyQuestions: (patientId) => call<SurveyQuestion[]>(`${p(patientId)}/survey`),
    submitSurvey: (patientId, answers, captureId) =>
      send<void>('POST', `${p(patientId)}/survey`, { answers, capture_id: captureId, language: language() }),
  }
}
