/*
 * Contracts for endpoints that do not exist yet. Only upload is left: the
 * reading pipeline behind it is Track A's. The screen is built and tested
 * against this through the mock layer (src/mocks). When the endpoint is
 * built in api/, its types move to the generated schema and the mock
 * handler is deleted.
 */

/* ---------------------------------------------------------------------
 * Upload: photographs in, a document and its values out. The reading
 * pipeline is Track A's; this is the surface in front of it.
 * ------------------------------------------------------------------- */

export type UploadRequest = {
  /* Generated on the device when the file is picked; the idempotency key. */
  client_capture_id: string
  patient_id: string
  doc_type: 'prescription' | 'lab_report'
  file_name: string
  sha256: string
  captured_at: string
}

export type UploadOutcome = {
  document_id: string
  values_in_record: number
  sent_to_queue: { reason: string; count: number }[]
  /* For a prescription: the regimen waiting for review. */
  regimen_id: string | null
}

export type UploadStatus = {
  id: string
  stage: 'uploading' | 'reading' | 'done' | 'duplicate' | 'failed'
  outcome: UploadOutcome | null
  failure: string | null
}
