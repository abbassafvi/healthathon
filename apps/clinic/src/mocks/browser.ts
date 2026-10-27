import { bypass } from 'msw'
import { setupWorker } from 'msw/browser'

import { handlers } from './handlers'
import { setPatientLookup, type PatientRef } from './patients'

/*
 * Starts the mock layer in the browser. Only endpoints in ./handlers are
 * mocked; every other request goes to the real API untouched.
 */
export async function startMocks(): Promise<void> {
  let cache: Promise<PatientRef[]> | null = null
  setPatientLookup(() => {
    cache ??= fetch(bypass(new Request('/api/patients'))).then((r) => r.json() as Promise<PatientRef[]>)
    return cache
  })
  await setupWorker(...handlers).start({ onUnhandledRequest: 'bypass', quiet: true })
}
