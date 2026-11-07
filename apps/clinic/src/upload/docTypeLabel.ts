import type { UploadDocType } from '../api/client'
import { en } from '../strings/en'

export function docTypeLabel(t: UploadDocType): string {
  return t === 'prescription' ? en.upload.prescription : t === 'lab_report' ? en.upload.labReport : en.upload.surveyForm
}
