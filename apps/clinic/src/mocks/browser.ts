import { bypass } from 'msw'
import { setupWorker } from 'msw/browser'

import type { Checklist } from '../api/client'
import { browserHandlers } from './handlers'
import { setRegimenForUpload } from './handlers/upload'
import { setPatientLookup, type PatientRef } from './patients'

/*
 * Starts the mock layer in the browser. Only endpoints in browserHandlers
 * are mocked; every other request goes to the real API untouched.
 */
export async function startMocks(): Promise<void> {
  let cache: Promise<PatientRef[]> | null = null
  setPatientLookup(() => {
    cache ??= fetch(bypass(new Request('/api/patients'))).then((r) => r.json() as Promise<PatientRef[]>)
    return cache
  })
  // A stand-in read of a prescription leads to the patient's real one awaiting review.
  setRegimenForUpload(async (patientId) => {
    const res = await fetch(bypass(new Request(`/api/patients/${patientId}/checklist`)))
    if (!res.ok) return null
    const checklist = (await res.json()) as Checklist
    return checklist.awaiting_review[0]?.regimen_id ?? null
  })
  await setupWorker(...browserHandlers).start({ onUnhandledRequest: 'bypass', quiet: true })
}
