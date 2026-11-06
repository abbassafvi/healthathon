import { http, HttpResponse } from 'msw'

import type { UploadOutcome, UploadStatus } from '../api/client'

/*
 * A stand-in for the reading pipeline, for the screen tests only.
 *
 * It never reads the request body: under jsdom a multipart body never
 * finishes streaming, so a handler that awaits it hangs. What the
 * pipeline decides from a photograph is settled by the API's own tests
 * in api/tests and by the browser tests in e2e; these screen tests say
 * what the page does with each answer, so each test programs the answers
 * it wants.
 */
export type UploadPlan = { stage?: 'duplicate'; outcome?: UploadOutcome; failure?: string }

const LAB: UploadOutcome = {
  document_id: 'doc-1',
  values_in_record: 3,
  sent_to_queue: [{ reason: 'region_illegible', count: 1 }],
  regimen_id: null,
  lines_accepted: 0,
  lines_for_a_person: 0,
}

export const rxOutcome = (regimenId: string | null, accepted = 2, waiting = 0): UploadOutcome => ({
  document_id: 'doc-rx',
  values_in_record: 0,
  sent_to_queue: [],
  regimen_id: regimenId,
  lines_accepted: accepted,
  lines_for_a_person: waiting,
})

type Job = { status: UploadStatus; plan: UploadPlan; polls: number }

let plans: UploadPlan[] = []
let posted = 0
const jobs = new Map<string, Job>()

/* Stages advance per poll, so no test has to move a clock. */
const POLLS_BEFORE_DONE = 2

export function resetUploadFixture(): void {
  plans = []
  posted = 0
  jobs.clear()
}

/* What the pipeline answers, in the order the page uploads. */
export function programUploads(next: UploadPlan[]): void {
  plans = next
}

export const uploadFixture = [
  http.post('*/api/uploads', () => {
    const plan = plans[posted] ?? {}
    posted += 1
    const id = `up-${posted}`
    const status: UploadStatus = {
      id,
      stage: plan.stage ?? 'uploading',
      outcome: null,
      failure: null,
    }
    jobs.set(id, { status, plan, polls: 0 })
    return HttpResponse.json(status, { status: 201 })
  }),

  http.get('*/api/uploads/:id', ({ params }) => {
    const job = jobs.get(String(params.id))
    if (!job) return HttpResponse.json({ detail: 'No such upload' }, { status: 404 })
    if (job.status.stage === 'uploading' || job.status.stage === 'reading') {
      job.polls += 1
      if (job.polls < POLLS_BEFORE_DONE) {
        job.status.stage = 'reading'
      } else if (job.plan.failure) {
        job.status.stage = 'failed'
        job.status.failure = job.plan.failure
      } else {
        job.status.stage = 'done'
        job.status.outcome = job.plan.outcome ?? LAB
      }
    }
    return HttpResponse.json(job.status)
  }),
]
