import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll } from 'vitest'

import { handlers } from '../mocks/handlers'
import { resetPaperFormIdempotency } from '../mocks/handlers/paperForm'
import { resetUploads } from '../mocks/handlers/upload'
import { setPatientLookup, type PatientRef } from '../mocks/patients'
import { resetMockState } from '../mocks/state'

export const TEST_PATIENTS: PatientRef[] = [
  { id: 'p-1', registration_no: 'DEV-0001', full_name: 'Asha Verma' },
  { id: 'p-2', registration_no: 'DEV-0002', full_name: 'Imran Qureshi' },
  { id: 'p-3', registration_no: 'DEV-0003', full_name: 'Meera Pillai' },
  { id: 'p-4', registration_no: 'DEV-0004', full_name: 'Rakesh Yadav' },
]

/*
 * Runs the real mock handlers under Node for a test file, against a fresh
 * mock state per test. Call at the top level of the test file.
 */
export function installMockServer() {
  const server = setupServer(...handlers)
  beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
  afterEach(() => {
    server.resetHandlers()
    resetMockState(new Date('2026-10-21T09:00:00'))
    resetPaperFormIdempotency()
    resetUploads()
    setPatientLookup(async () => TEST_PATIENTS)
  })
  afterAll(() => server.close())
  resetMockState(new Date('2026-10-21T09:00:00'))
  setPatientLookup(async () => TEST_PATIENTS)
  return server
}

export const api = (path: string, init?: RequestInit) => fetch(new URL(path, window.location.origin), init)
