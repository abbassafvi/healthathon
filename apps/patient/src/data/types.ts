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

export type Recording = { key: string; uri: string }

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
  /* A tapped Yes or No, or words; null when the answer was only spoken. */
  answer: string | null
  /* The recording with today's answer, played as recorded. */
  answer_audio_uri: string | null
  /* What a speech recogniser heard in that recording, when the clinic has it switched on. */
  answer_transcript?: string | null
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
  answers: { question: Question; answer_text: string | null; audio_uri: string | null; transcript?: string | null; occurred_at: string }[]
  meals: Meal[]
}

/* Newest first. next_before asks for the days before these; null at the first entry. */
export type PastDays = { days: PastDay[]; next_before: string | null }

export type DocType = 'prescription' | 'lab_report'

/*
 * A reading taken off one of the patient's own pages. `checked` is false
 * until a clinician settles it, and the app says so beside the reading:
 * something nobody has checked is not a fact about a medicine.
 */
export type DocLine = { drug_text: string; dose_text: string; schedule_text: string | null; checked: boolean }

/*
 * A laboratory value off the page. value_text is null until a clinician
 * settles it: an unsettled number is not shown to anyone, here or in the
 * clinic, which is a property of the database rather than of this screen.
 */
export type DocValue = { analyte_name: string; value_text: string | null; unit_text: string | null; checked: boolean }

export type DocAdvice = { text: string; checked: boolean }

/* A page on the patient's record, and what was read off it. */
export type PatientDoc = {
  id: string
  doc_type: DocType
  document_date: string | null
  received_at: string
  /* 'patient_app' when the patient sent it, 'desk_scan' when the clinic did. */
  sent_from: string
  page_uri: string | null
  lines: DocLine[]
  values: DocValue[]
  advice: DocAdvice[]
}

/* Where a page the patient sent has got to. The phone polls this. */
export type UploadStatus = {
  id: string
  stage: 'uploading' | 'reading' | 'done' | 'duplicate' | 'failed'
  document_id: string | null
  failure: string | null
}

/* A phone signed in: the token its requests carry, and whose phone it is. */
export type SignedIn = { token: string; patient: PatientRef }

/* Every write carries a capture id made on the device: the idempotency key. */
export type PatientApi = {
  /* Sends a code by SMS to a number on a patient's record. demo_code is set only in test mode. */
  startSignIn(phone: string): Promise<{ demo_code: string | null }>
  checkSignIn(phone: string, code: string): Promise<SignedIn>
  today(patientId: string): Promise<Today>
  setTick(patientId: string, itemId: string, ticked: boolean | null, captureId: string): Promise<void>
  addReading(patientId: string, r: { value_text: string; context: GlucoseContext }, captureId: string): Promise<Reading>
  answer(patientId: string, questionKey: string, text: string | null, captureId: string, audioKey?: string): Promise<void>
  /* A spoken answer, kept at the clinic as recorded; its key attaches it to an answer. */
  uploadRecording(patientId: string, uri: string, captureId: string): Promise<Recording>
  addMeal(patientId: string, meal: NewMeal, captureId: string): Promise<Meal>
  surveyQuestions(patientId: string): Promise<SurveyQuestion[]>
  submitSurvey(patientId: string, answers: Record<string, string>, captureId: string, recordings?: Record<string, string>): Promise<void>
  pastDays(patientId: string, before?: string): Promise<PastDays>
  /* Send a photographed prescription or report. Reading it takes seconds, so poll the upload. */
  sendDocument(patientId: string, d: { uri: string; docType: DocType; takenAt: Date }, captureId: string): Promise<UploadStatus>
  uploadStatus(patientId: string, uploadId: string): Promise<UploadStatus>
  documents(patientId: string): Promise<PatientDoc[]>
  /*
   * A document's page as something an Image can show. The page route
   * needs the phone's token, and an image request cannot carry one on
   * the web, so the page is fetched here and handed over as data.
   */
  pageImage(pageUri: string): Promise<string>
}
