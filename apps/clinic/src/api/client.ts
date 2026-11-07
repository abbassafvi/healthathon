import type { components } from './schema'

export type QueueItem = components['schemas']['QueueItem']
export type QueueList = components['schemas']['QueueList']
export type Decision = components['schemas']['Decision']
export type DecisionResult = components['schemas']['DecisionResult']
export type CurrentUser = components['schemas']['CurrentUser']
export type PatientSummary = components['schemas']['PatientSummary']
export type PatientListItem = components['schemas']['PatientListItem']
export type PatientRecord = components['schemas']['PatientRecord']
export type SurveyForm = components['schemas']['SurveyForm']
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

/* The clinic's day: booked visits and each record's facts. */
export type ClinicDay = S['ClinicDay']
export type DayVisit = S['DayVisit']

/* How a document was read. */
export type DocumentReading = S['DocumentReading']
export type ReadValue = S['ReadValue']
export type ReadLine = S['ReadLine']
export type ReadCheck = S['Check']

/* Photographs in, a document and its values out. */
export type UploadStatus = S['UploadStatus']
export type UploadOutcome = S['UploadOutcome']
export type UploadDocType = 'prescription' | 'lab_report' | 'survey_form'

/* The audit chain. */
export type AuditLog = S['AuditLog']
export type AuditEntry = S['AuditEntry']
export type AuditKind = AuditEntry['kind']

export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  // A multipart body carries its own content type, with the boundary the
  // browser generated. Setting it by hand would strip that and the server
  // would not be able to split the parts.
  const isForm = init?.body instanceof FormData
  const res = await fetch(new URL(path, window.location.origin), {
    ...init,
    headers: isForm ? init?.headers : { 'Content-Type': 'application/json', ...init?.headers },
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
  patients: () => request<PatientListItem[]>('/api/patients'),
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
  clinicDay: (date: string) => request<ClinicDay>(`/api/clinic-day?date=${date}`),
  reading: (documentId: string) => request<DocumentReading>(`/api/documents/${documentId}/reading`),
  auditLog: (query: { kind?: AuditKind; before?: number } = {}) => {
    const params = new URLSearchParams()
    if (query.kind) params.set('kind', query.kind)
    if (query.before) params.set('before', String(query.before))
    return request<AuditLog>(`/api/audit-log${params.size ? `?${params}` : ''}`)
  },
  /* The photograph itself goes with the fields: the pipeline reads the file. */
  upload: (fields: {
    client_capture_id: string
    patient_id: string
    doc_type: UploadDocType
    captured_at: string
    file: File
  }) => {
    const body = new FormData()
    body.set('client_capture_id', fields.client_capture_id)
    body.set('patient_id', fields.patient_id)
    body.set('doc_type', fields.doc_type)
    body.set('captured_at', fields.captured_at)
    body.set('file', fields.file, fields.file.name)
    return request<UploadStatus>('/api/uploads', { method: 'POST', body })
  },
  uploadStatus: (id: string) => request<UploadStatus>(`/api/uploads/${id}`),
  // keepalive lets a held decision still reach the server as the page closes.
  decide: (itemId: string, decision: Decision, keepalive = false) =>
    request<DecisionResult>(`/api/confirm-queue/${itemId}/decision`, {
      method: 'POST',
      body: JSON.stringify(decision),
      keepalive,
    }),
}
