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

/* ---------------------------------------------------------------------
 * Patient-reported entries (pat schema). Stored as the patient gave
 * them. Nothing here is scored, totalled or interpreted.
 * ------------------------------------------------------------------- */

export type Channel = 'patient_app' | 'paper_form' | 'sms'
export type EnteredBy = 'patient' | 'caregiver' | 'clinic_staff'
export type GlucoseContext = 'fasting' | 'before_meal' | 'after_meal' | 'bedtime' | 'overnight' | 'random'

type EntryBase = {
  id: string
  channel: Channel
  entered_by: EnteredBy
  caregiver_name: string | null
  language: string
  /* When it happened, per the patient. */
  occurred_at: string
  /* When the clinic received it. */
  recorded_at: string
}

export type GlucoseEntry = EntryBase & {
  kind: 'glucose_reading'
  value_text: string
  context: GlucoseContext
  insulin_units: number | null
}

export type TickEntry = EntryBase & {
  kind: 'medication_tick'
  regimen_item: { id: string; drug_text: string; dose_text: string; schedule_text: string | null }
  tick_date: string
  ticked: boolean
}

export type AnswerEntry = EntryBase & {
  kind: 'survey_answer'
  /* 'daily' is the day's question; 'survey' is the short survey. */
  set: 'daily' | 'survey'
  question_key: string
  /* The question in English for the clinician, and as the patient saw it. */
  question_text: string
  question_text_shown: string
  answer_text: string
}

export type MealPhotoEntry = EntryBase & {
  kind: 'meal_photo'
  photo_url: string
}

export type PatientEntry = GlucoseEntry | TickEntry | AnswerEntry | MealPhotoEntry

export type EntriesPage = {
  entries: PatientEntry[]
  /* Every regimen item that was active in the range, so a day with no tick
     for an item shows as a gap rather than disappearing. */
  regimen_items: { id: string; drug_text: string; dose_text: string; schedule_text: string | null; active_from: string; active_until: string | null }[]
  from: string
  to: string
}
