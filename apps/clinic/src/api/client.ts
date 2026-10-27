import type { components } from './schema'

export type QueueItem = components['schemas']['QueueItem']
export type QueueList = components['schemas']['QueueList']
export type Decision = components['schemas']['Decision']
export type DecisionResult = components['schemas']['DecisionResult']
export type CurrentUser = components['schemas']['CurrentUser']
export type PatientSummary = components['schemas']['PatientSummary']
export type PatientRecord = components['schemas']['PatientRecord']
export type RecordDocument = components['schemas']['RecordDocument']
export type RecordValue = components['schemas']['RecordValue']
export type Trace = components['schemas']['Trace']
export type Box = components['schemas']['Box']

type S = components['schemas']

/* Prescriptions and the checklist. Items are exactly as printed. */
export type DocumentRef = S['DocumentRef']
export type PageRef = S['PageRef']
export type RegimenItem = S['RegimenItem']
export type ActiveRegimen = S['ActiveRegimen']
export type AwaitingReview = S['AwaitingReview']
export type Checklist = S['Checklist']
export type RegimenReview = S['RegimenReview']
export type ItemDecision = S['ItemDecision']

/* Patient-reported entries, stored as given. Nothing is scored or totalled. */
export type GlucoseEntry = S['GlucoseEntry']
export type TickEntry = S['TickEntry']
export type AnswerEntry = S['AnswerEntry']
export type MealPhotoEntry = S['MealPhotoEntry']
export type EntriesPage = S['EntriesPage']
export type PatientEntry = EntriesPage['entries'][number]
export type Channel = PatientEntry['channel']
export type EnteredBy = PatientEntry['entered_by']
export type GlucoseContext = GlucoseEntry['context']

/* The visit page and the one approved score. */
export type DayCell = S['DayCell']
export type ComplianceScore = S['ComplianceScore']
export type TestOrder = S['TestOrder']
export type VisitSummary = S['VisitSummary']

/* Paper forms transcribed by clinic staff. */
export type PaperFormSubmission = S['PaperFormSubmission']
export type PaperFormResult = S['PaperFormResult']
export type PaperFormQuestion = S['PaperFormQuestion']

export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  // Absolute, so the same call works in the browser and under Node in tests.
  const res = await fetch(new URL(path, window.location.origin), {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { detail?: unknown } | null
    const detail = typeof body?.detail === 'string' ? body.detail : res.statusText
    throw new ApiError(res.status, detail)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

export const api = {
  me: () => request<CurrentUser>('/api/me'),
  queue: () => request<QueueList>('/api/confirm-queue'),
  patients: () => request<PatientSummary[]>('/api/patients'),
  record: (patientId: string) => request<PatientRecord>(`/api/patients/${patientId}/record`),
  trace: (valueId: string) => request<Trace>(`/api/values/${valueId}/trace`),
  checklist: (patientId: string) => request<Checklist>(`/api/patients/${patientId}/checklist`),
  review: (regimenId: string) => request<RegimenReview>(`/api/regimens/${regimenId}/review`),
  confirmItem: (itemId: string, decision: ItemDecision) =>
    request<RegimenItem>(`/api/regimen-items/${itemId}/confirm`, {
      method: 'POST',
      body: JSON.stringify(decision),
    }),
  removeItem: (itemId: string) => request<void>(`/api/regimen-items/${itemId}`, { method: 'DELETE' }),
  activate: (regimenId: string) =>
    request<{ activated_at: string }>(`/api/regimens/${regimenId}/activate`, { method: 'POST' }),
  entries: (patientId: string, range?: { from: string; to: string }) =>
    request<EntriesPage>(
      `/api/patients/${patientId}/entries` + (range ? `?from=${range.from}&to=${range.to}` : ''),
    ),
  visit: (patientId: string) => request<VisitSummary>(`/api/patients/${patientId}/visit`),
  paperFormQuestions: () => request<PaperFormQuestion[]>('/api/paper-form/questions'),
  submitPaperForm: (patientId: string, form: PaperFormSubmission) =>
    request<PaperFormResult>(`/api/patients/${patientId}/paper-form`, { method: 'POST', body: JSON.stringify(form) }),
  // keepalive lets a held decision still reach the server as the page closes.
  decide: (itemId: string, decision: Decision, keepalive = false) =>
    request<DecisionResult>(`/api/confirm-queue/${itemId}/decision`, {
      method: 'POST',
      body: JSON.stringify(decision),
      keepalive,
    }),
}
