import { request } from './client'
import type { Checklist, ItemDecision, RegimenItem, RegimenReview } from './pending'

/* Calls to endpoints served by the mock layer until they are built in api/. */
export const pendingApi = {
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
}
