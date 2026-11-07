import { delay, http, HttpResponse } from 'msw'

import type { Checklist, ItemDecision, RegimenReview } from '../../api/client'
import { PAGE_H, PAGE_W, prescriptionSvg } from '../pages'
import { patientById, patientByRegistration } from '../patients'
import { DEMO_CLINICIAN, mockState, pageUrl, type MockRegimen } from '../state'

const notFound = (detail: string) => HttpResponse.json({ detail }, { status: 404 })
const conflict = (detail: string) => HttpResponse.json({ detail }, { status: 409 })
const now = () => new Date().toISOString()

function activeFor(reg: string): MockRegimen | undefined {
  return mockState().regimens.find((r) => r.registration_no === reg && r.activated_at && !r.superseded_at)
}

function itemOwner(itemId: string): MockRegimen | undefined {
  return mockState().regimens.find((r) => r.items.some((i) => i.id === itemId))
}

const docRef = (r: MockRegimen) => ({ ...r.document })

export const checklistHandlers = [
  http.get('/api/patients/:patientId/checklist', async ({ params }) => {
    const patient = await patientById(String(params.patientId))
    if (!patient) return notFound('No such patient')
    const mine = mockState().regimens.filter((r) => r.registration_no === patient.registration_no)
    const active = activeFor(patient.registration_no)
    const body: Checklist = {
      active: active
        ? {
            id: active.id,
            activated_at: active.activated_at!,
            activated_by_name: active.activated_by_name!,
            source_document: docRef(active),
            items: active.items,
            advice: [],
          }
        : null,
      awaiting_review: mine
        .filter((r) => !r.activated_at)
        .map((r) => ({
          regimen_id: r.id,
          document: docRef(r),
          item_count: r.items.length,
          confirmed_count: r.items.filter((i) => i.confirmed_at).length,
          settled_count: r.items.filter((i) => i.confirmed_at || i.accepted_at).length,
        })),
    }
    return HttpResponse.json(body)
  }),

  http.get('/api/regimens/:regimenId/review', async ({ params }) => {
    const r = mockState().regimens.find((x) => x.id === params.regimenId)
    if (!r) return notFound('No such prescription')
    const patient = await patientByRegistration(r.registration_no)
    if (!patient) return notFound('No such patient')
    const current = activeFor(r.registration_no)
    const body: RegimenReview = {
      regimen_id: r.id,
      patient,
      document: docRef(r),
      page: { url: pageUrl(r.document.id), width_px: PAGE_W, height_px: PAGE_H },
      items: r.items,
      advice: [],
      replaces:
        current && current.id !== r.id ? { activated_at: current.activated_at!, item_count: current.items.length } : null,
      activated_at: r.activated_at,
    }
    return HttpResponse.json(body)
  }),

  http.post('/api/regimen-items/:itemId/confirm', async ({ params, request }) => {
    const r = itemOwner(String(params.itemId))
    if (!r) return notFound('No such item')
    if (r.activated_at) return conflict('This checklist is already active')
    const body = (await request.json()) as ItemDecision
    if (!Number.isInteger(body.decision_latency_ms) || body.decision_latency_ms < 0) {
      return HttpResponse.json({ detail: 'decision_latency_ms is required' }, { status: 422 })
    }
    const item = r.items.find((i) => i.id === params.itemId)!
    if (body.drug_text != null && !body.drug_text.trim()) {
      return HttpResponse.json({ detail: 'drug_text cannot be empty' }, { status: 422 })
    }
    if (body.dose_text != null && !body.dose_text.trim()) {
      return HttpResponse.json({ detail: 'dose_text cannot be empty' }, { status: 422 })
    }
    Object.assign(item, {
      drug_text: body.drug_text?.trim() ?? item.drug_text,
      dose_text: body.dose_text?.trim() ?? item.dose_text,
      schedule_text: body.schedule_text === undefined ? item.schedule_text : body.schedule_text?.trim() || null,
      confirmed_by_name: DEMO_CLINICIAN,
      confirmed_at: now(),
    })
    return HttpResponse.json(item)
  }),

  http.delete('/api/regimen-items/:itemId', ({ params }) => {
    const r = itemOwner(String(params.itemId))
    if (!r) return notFound('No such item')
    if (r.activated_at) return conflict('This checklist is already active')
    r.items = r.items.filter((i) => i.id !== params.itemId)
    return new HttpResponse(null, { status: 204 })
  }),

  http.post('/api/regimens/:regimenId/activate', ({ params }) => {
    const r = mockState().regimens.find((x) => x.id === params.regimenId)
    if (!r) return notFound('No such prescription')
    if (r.activated_at) return conflict('This checklist is already active')
    if (r.items.length === 0) return conflict('A checklist needs at least one medicine')
    if (r.items.some((i) => !i.confirmed_at)) return conflict('Every medicine must be confirmed first')
    const current = activeFor(r.registration_no)
    const at = now()
    if (current) current.superseded_at = at
    r.activated_at = at
    r.activated_by_name = DEMO_CLINICIAN
    return HttpResponse.json({ activated_at: at })
  }),

  http.get('/mock/pages/:file', async ({ params, request }) => {
    // e2e tests set this before the page loads to hold crops back.
    const hold = (globalThis as { __MOCK_IMAGE_DELAY_MS?: number }).__MOCK_IMAGE_DELAY_MS
    if (hold) await delay(hold)
    const docId = String(params.file).replace(/\.svg$/, '')
    const r = mockState().regimens.find((x) => x.document.id === docId)
    if (!r) return new HttpResponse(null, { status: 404 })
    const crop = new URL(request.url).searchParams.get('crop')
    const [x, y, w, h] = crop ? crop.split(',').map(Number) : []
    const svg = prescriptionSvg(r.page, crop ? { x, y, w, h } : undefined)
    return new HttpResponse(svg, { headers: { 'Content-Type': 'image/svg+xml' } })
  }),
]
