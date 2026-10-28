import type { Lang } from '../theme'

/*
 * The patient app's contract. These endpoints do not exist yet; the app
 * runs against an in-memory mock (mockApi.ts) behind the same interface.
 * docs/HANDOFF.md lists them for Track A.
 */
export type GlucoseContext = 'fasting' | 'before_meal' | 'after_meal' | 'bedtime' | 'overnight' | 'random'

export type PatientRef = { id: string; registration_no: string; full_name: string; preferred_language: Lang }

export type ChecklistItem = { id: string; drug_text: string; dose_text: string; schedule_text: string | null }

export type Reading = { id: string; value_text: string; context: GlucoseContext; occurred_at: string }

export type Question = { key: string; text: Record<Lang, string> }

export type MealName = 'breakfast' | 'lunch' | 'dinner' | 'snack'

/* A meal photo; occurred_at is when it was taken. Calories only ever as the patient typed them. */
export type Meal = { id: string; uri: string; occurred_at: string; meal: MealName | null; calories_text: string | null }

export type NewMeal = { uri: string; meal: MealName; takenAt: Date; calories: string | null }

export type Today = {
  date: string
  patient: PatientRef
  /* Exactly as printed on the activated prescription. */
  items: ChecklistItem[]
  /* item id -> ticked today. Absent means no entry yet. */
  ticks: Record<string, boolean>
  readings: Reading[]
  question: Question | null
  answer: string | null
  meals: Meal[]
  survey: { open: boolean; done: boolean }
}

export type SurveyQuestion = Question

/*
 * An earlier day, exactly as it was recorded. Nothing is added up. Every
 * medicine on that day's checklist is listed in checklist order; ticked is
 * null when nothing was marked for it.
 */
export type PastDay = {
  date: string
  ticks: { item: ChecklistItem; ticked: boolean | null }[]
  readings: Reading[]
  answers: { question: Question; answer_text: string; occurred_at: string }[]
  meals: Meal[]
}

/* Newest first. next_before asks for the days before these; null at the first entry. */
export type PastDays = { days: PastDay[]; next_before: string | null }

/* Every write carries a capture id made on the device: the idempotency key. */
export type PatientApi = {
  patients(): Promise<PatientRef[]>
  today(patientId: string): Promise<Today>
  setTick(patientId: string, itemId: string, ticked: boolean | null, captureId: string): Promise<void>
  addReading(patientId: string, r: { value_text: string; context: GlucoseContext }, captureId: string): Promise<Reading>
  answer(patientId: string, questionKey: string, text: string, captureId: string): Promise<void>
  addMeal(patientId: string, meal: NewMeal, captureId: string): Promise<Meal>
  surveyQuestions(patientId: string): Promise<SurveyQuestion[]>
  submitSurvey(patientId: string, answers: Record<string, string>, captureId: string): Promise<void>
  pastDays(patientId: string, before?: string): Promise<PastDays>
}
