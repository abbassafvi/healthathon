import { request } from './client'
import type {
  Checklist,
  EntriesPage,
  ItemDecision,
  PaperFormQuestion,
  PaperFormResult,
  PaperFormSubmission,
  RegimenItem,
  RegimenReview,
  VisitSummary,
} from './pending'

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
  entries: (patientId: string, range?: { from: string; to: string }) =>
    request<EntriesPage>(
      `/api/patients/${patientId}/entries` + (range ? `?from=${range.from}&to=${range.to}` : ''),
    ),
  paperFormQuestions: () => request<PaperFormQuestion[]>('/api/paper-form/questions'),
  submitPaperForm: (patientId: string, form: PaperFormSubmission) =>
    request<PaperFormResult>(`/api/patients/${patientId}/paper-form`, { method: 'POST', body: JSON.stringify(form) }),
  visit: (patientId: string) => request<VisitSummary>(`/api/patients/${patientId}/visit`),
  activate: (regimenId: string) =>
    request<{ activated_at: string }>(`/api/regimens/${regimenId}/activate`, { method: 'POST' }),
}
