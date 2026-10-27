import { http, HttpResponse } from 'msw'

import type { EntriesPage } from '../../api/client'
import { localIsoDate } from '../../lib/localDate'
import { DAYS, mealSvg } from '../entries'
import { patientById } from '../patients'
import { mockState } from '../state'

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

export const entriesHandlers = [
  http.get('/api/patients/:patientId/entries', async ({ params, request }) => {
    const patient = await patientById(String(params.patientId))
    if (!patient) return HttpResponse.json({ detail: 'No such patient' }, { status: 404 })
    const q = new URL(request.url).searchParams
    const today = new Date()
    const start = new Date(today)
    start.setDate(start.getDate() - (DAYS - 1))
    const from = q.get('from') ?? localIsoDate(start)
    const to = q.get('to') ?? localIsoDate(today)
    if (!DAY_RE.test(from) || !DAY_RE.test(to) || from > to) {
      return HttpResponse.json({ detail: 'from and to must be dates, from on or before to' }, { status: 422 })
    }
    const state = mockState()
    const entries = (state.entries[patient.registration_no] ?? []).filter((e) => {
      const day = e.occurred_at.slice(0, 10)
      return day >= from && day <= to
    })
    const regimen_items = state.regimens
      .filter((r) => r.registration_no === patient.registration_no && r.activated_at)
      .filter((r) => r.activated_at!.slice(0, 10) <= to && (!r.superseded_at || r.superseded_at.slice(0, 10) >= from))
      .flatMap((r) =>
        r.items.map((i) => ({
          id: i.id,
          drug_text: i.drug_text,
          dose_text: i.dose_text,
          schedule_text: i.schedule_text,
          active_from: r.activated_at!.slice(0, 10),
          active_until: r.superseded_at ? r.superseded_at.slice(0, 10) : null,
        })),
      )
    const body: EntriesPage = { entries, regimen_items, from, to }
    return HttpResponse.json(body)
  }),

  http.get('/mock/meals/:file', ({ params }) => {
    const id = String(params.file).replace(/\.svg$/, '')
    return new HttpResponse(mealSvg(id), { headers: { 'Content-Type': 'image/svg+xml' } })
  }),
]
