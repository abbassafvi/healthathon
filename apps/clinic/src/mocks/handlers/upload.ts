import { http, HttpResponse } from 'msw'

import type { UploadRequest, UploadStatus } from '../../api/pending'
import { localIsoDate } from '../../lib/localDate'
import { lineBox, type RxPage } from '../pages'
import { patientById } from '../patients'
import { cropUrl, mockState, type MockRegimen } from '../state'

/*
 * A stand-in for the reading pipeline: an upload is "uploading" briefly,
 * then "reading", then done with a fixed, fictional outcome. A prescription
 * creates a regimen waiting for review, so it appears on the Checklist tab.
 */
export type Job = { status: UploadStatus; readyAt: number; readingAt: number; req: UploadRequest }
const jobs = new Map<string, Job>()
const byCapture = new Map<string, string>()
const seenFiles = new Set<string>() // `${patient}|${sha256}`, as UNIQUE (patient_id, sha256)

const UPLOAD_MS = 600
const READ_MS = 2400

/*
 * Where an uploaded prescription's regimen comes from. In the browser the
 * checklist is real, so the stand-in points at the patient's real
 * prescription awaiting review (see ../browser.ts). Under test it makes
 * one in the mock state, as below.
 */
type RegimenForUpload = (patientId: string, job: Job, registration_no: string, full_name: string) => Promise<string | null>
let regimenForUpload: RegimenForUpload = async (_pid, job, reg, name) => mockRegimen(job, reg, name)

export function setRegimenForUpload(fn: RegimenForUpload): void {
  regimenForUpload = fn
}

async function finish(job: Job, registration_no: string, full_name: string) {
  const id = job.status.id
  const docId = `doc-up-${id}`
  if (job.req.doc_type === 'lab_report') {
    job.status.outcome = {
      document_id: docId,
      values_in_record: 3,
      sent_to_queue: [{ reason: 'region_illegible', count: 1 }],
      regimen_id: null,
    }
    return
  }
  const regimen_id = await regimenForUpload(job.req.patient_id, job, registration_no, full_name)
  job.status.outcome = { document_id: docId, values_in_record: 0, sent_to_queue: [], regimen_id }
}

function mockRegimen(job: Job, registration_no: string, full_name: string): string {
  const id = job.status.id
  const docId = `doc-up-${id}`
  const date = localIsoDate(new Date())
  const page: RxPage = {
    doctor: 'Dr. Kavita Rao, MD (fictional)', clinic: 'Diabetes Clinic, Lucknow (fictional)',
    patientName: full_name, dateText: date.split('-').reverse().map(Number).join('/'),
    lines: [
      { drug: 'Tab. Metformin', dose: '500 mg', schedule: '1-0-1' },
      { drug: 'Tab. Vildagliptin', dose: '50 mg', schedule: '1-0-1' },
    ],
  }
  const regimen: MockRegimen = {
    id: `rx-up-${id}`, registration_no, document: { id: docId, document_date: date, issuing_source: page.doctor }, page,
    items: page.lines.map((l, i) => {
      const box = lineBox(page, i)
      return { id: `rx-up-${id}-item-${i + 1}`, drug_text: l.drug, dose_text: l.dose, schedule_text: l.schedule, box, crop_url: cropUrl(docId, box), confirmed_by_name: null, confirmed_at: null }
    }),
    activated_at: null, activated_by_name: null, superseded_at: null,
  }
  mockState().regimens.push(regimen)
  return regimen.id
}

export const uploadHandlers = [
  http.post('/api/uploads', async ({ request }) => {
    const req = (await request.json()) as UploadRequest
    if (!req.client_capture_id || !req.sha256 || !['prescription', 'lab_report'].includes(req.doc_type)) {
      return HttpResponse.json({ detail: 'client_capture_id, sha256 and doc_type are required' }, { status: 422 })
    }
    const patient = await patientById(req.patient_id)
    if (!patient) return HttpResponse.json({ detail: 'No such patient' }, { status: 404 })
    // A retry of the same capture returns the same upload.
    const existing = byCapture.get(req.client_capture_id)
    if (existing) return HttpResponse.json(jobs.get(existing)!.status)

    const id = `up-${jobs.size + 1}`
    const now = Date.now()
    const fileKey = `${req.patient_id}|${req.sha256}`
    // Only a file that was read successfully counts as in the record.
    const duplicate = seenFiles.has(fileKey)
    const job: Job = {
      req, readingAt: now + UPLOAD_MS, readyAt: now + UPLOAD_MS + READ_MS,
      status: { id, stage: duplicate ? 'duplicate' : 'uploading', outcome: null, failure: null },
    }
    jobs.set(id, job)
    byCapture.set(req.client_capture_id, id)
    return HttpResponse.json(job.status, { status: 201 })
  }),

  http.get('/api/uploads/:id', async ({ params }) => {
    const job = jobs.get(String(params.id))
    if (!job) return HttpResponse.json({ detail: 'No such upload' }, { status: 404 })
    if (job.status.stage === 'uploading' || job.status.stage === 'reading') {
      const now = Date.now()
      if (now >= job.readyAt) {
        const patient = await patientById(job.req.patient_id)
        if (!patient) return HttpResponse.json({ detail: 'No such patient' }, { status: 404 })
        if (job.req.file_name.includes('unreadable')) {
          job.status.stage = 'failed'
          job.status.failure = 'The page could not be found in this photograph.'
        } else {
          await finish(job, patient.registration_no, patient.full_name)
          job.status.stage = 'done'
          seenFiles.add(`${job.req.patient_id}|${job.req.sha256}`)
        }
      } else if (now >= job.readingAt) {
        job.status.stage = 'reading'
      }
    }
    return HttpResponse.json(job.status)
  }),
]

export function resetUploads(): void {
  jobs.clear()
  byCapture.clear()
  seenFiles.clear()
}
