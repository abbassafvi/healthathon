import { http, HttpResponse } from 'msw'

import type { TestOrder, VisitSummary } from '../../api/pending'
import { localIsoDate } from '../../lib/localDate'
import { computeScore } from '../compliance'
import { patientById } from '../patients'
import { DEMO_CLINICIAN, daysAgo, mockState } from '../state'

/* Orders written on earlier prescriptions. Matching is record-keeping, not a reminder. */
const ORDERS: Record<string, { analyte_name: string; daysAgo: number; matched: boolean }[]> = {
  'DEV-0001': [
    { analyte_name: 'HbA1c', daysAgo: 28, matched: true },
    { analyte_name: 'Urine albumin/creatinine ratio', daysAgo: 28, matched: false },
  ],
  'DEV-0003': [{ analyte_name: 'Serum creatinine', daysAgo: 30, matched: true }],
}

export const visitHandlers = [
  http.get('/api/patients/:patientId/visit', async ({ params }) => {
    const patient = await patientById(String(params.patientId))
    if (!patient) return HttpResponse.json({ detail: 'No such patient' }, { status: 404 })
    const now = new Date()
    const state = mockState()
    const previous = daysAgo(29, now)
    const from = daysAgo(28, now)
    const to = localIsoDate(now)
    const active = state.regimens.find((r) => r.registration_no === patient.registration_no && r.activated_at && !r.superseded_at)
    const orders: TestOrder[] = (ORDERS[patient.registration_no] ?? []).map((o, i) => ({
      id: `order-${patient.registration_no}-${i + 1}`,
      analyte_name: o.analyte_name,
      ordered_on: daysAgo(o.daysAgo, now),
      matched_value_id: o.matched ? `matched-${i + 1}` : null,
    }))
    const body: VisitSummary = {
      visit: { scheduled_for: `${to}T11:30:00`, clinician_name: DEMO_CLINICIAN },
      period: { from, to, previous_visit: previous },
      orders,
      compliance: computeScore(active, state.entries[patient.registration_no] ?? [], from, to, now),
    }
    return HttpResponse.json(body)
  }),
]
