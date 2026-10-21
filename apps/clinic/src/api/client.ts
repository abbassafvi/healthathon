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
  // keepalive lets a held decision still reach the server as the page closes.
  decide: (itemId: string, decision: Decision, keepalive = false) =>
    request<DecisionResult>(`/api/confirm-queue/${itemId}/decision`, {
      method: 'POST',
      body: JSON.stringify(decision),
      keepalive,
    }),
}
