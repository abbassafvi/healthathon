import type { components } from './schema'

export type QueueItem = components['schemas']['QueueItem']
export type QueueList = components['schemas']['QueueList']
export type Decision = components['schemas']['Decision']
export type DecisionResult = components['schemas']['DecisionResult']
export type CurrentUser = components['schemas']['CurrentUser']

export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { detail?: unknown } | null
    const detail = typeof body?.detail === 'string' ? body.detail : res.statusText
    throw new ApiError(res.status, detail)
  }
  return (await res.json()) as T
}

export const api = {
  me: () => request<CurrentUser>('/api/me'),
  queue: () => request<QueueList>('/api/confirm-queue'),
  // keepalive lets a held decision still reach the server as the page closes.
  decide: (itemId: string, decision: Decision, keepalive = false) =>
    request<DecisionResult>(`/api/confirm-queue/${itemId}/decision`, {
      method: 'POST',
      body: JSON.stringify(decision),
      keepalive,
    }),
}
