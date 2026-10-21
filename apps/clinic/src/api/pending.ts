/*
 * Contracts for endpoints that do not exist yet. The screens are built and
 * tested against these through the mock layer (src/mocks). When an endpoint
 * is built in api/, its types move to the generated schema and the matching
 * mock handler is deleted. Shapes follow db/schema.sql.
 */
import type { Box } from './client'

export type PageRef = { url: string; width_px: number; height_px: number }

export type DocumentRef = {
  id: string
  document_date: string | null
  issuing_source: string | null
}

/* A regimen item exactly as printed. Nothing is mapped or normalised. */
export type RegimenItem = {
  id: string
  drug_text: string
  dose_text: string
  schedule_text: string | null
  box: Box
  crop_url: string
  confirmed_by_name: string | null
  confirmed_at: string | null
}

export type ActiveRegimen = {
  id: string
  activated_at: string
  activated_by_name: string
  source_document: DocumentRef
  items: RegimenItem[]
}

export type AwaitingReview = {
  regimen_id: string
  document: DocumentRef
  item_count: number
  confirmed_count: number
}

export type Checklist = {
  active: ActiveRegimen | null
  awaiting_review: AwaitingReview[]
}

export type RegimenReview = {
  regimen_id: string
  patient: { id: string; registration_no: string; full_name: string }
  document: DocumentRef
  page: PageRef
  items: RegimenItem[]
  /* The checklist activation would replace, if there is one. */
  replaces: { activated_at: string; item_count: number } | null
  activated_at: string | null
}

export type ItemDecision = {
  decision_latency_ms: number
  /* Present only when the reviewer corrected what was read. */
  drug_text?: string
  dose_text?: string
  schedule_text?: string | null
}
