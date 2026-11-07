import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { patientListItem } from '../test/fixtures'
import { installMockServer } from '../test/msw'
import { PatientLayout } from './PatientLayout'

const server = installMockServer()

const asha = patientListItem(
  { id: 'p-1', registration_no: 'DEV-0001', full_name: 'Asha Verma', year_of_birth: 1968, sex: 'F', preferred_language: 'hi' },
  {
    caregiver: { full_name: 'Priya Verma', relationship: 'daughter' },
    last_visit: '2026-09-29T11:00:00+05:30',
    next_visit: '2026-11-04T10:00:00+05:30',
    checklist_since: '2026-10-09T10:05:00+05:30',
    checklist_medicines: 3,
    sms_phone_last4: '0001',
  },
)

function setup(path: string, patient = asha) {
  server.use(http.get('*/api/patients', () => HttpResponse.json([patient])))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/patients/:patientId" element={<PatientLayout />}>
            <Route path="visit" element={<p>visit</p>} />
            <Route path="documents/:documentId/reading" element={<p>reading</p>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

/*
 * The header writes a near date in words ("Tomorrow, 10:00"), so a test
 * that names an absolute date only holds on days when the fixture's
 * visit is not near. The clock is fixed here so the assertion means the
 * same thing whatever day the suite runs.
 */
beforeEach(() => vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-20T09:00:00+05:30') }))
afterEach(() => vi.useRealTimers())

describe('PatientLayout', () => {
  it('says who the patient is and where their care stands, in dates and counts', async () => {
    setup('/patients/p-1/visit')
    await screen.findByRole('heading', { name: 'Asha Verma' })
    expect(screen.getByText('Born 1968')).toBeInTheDocument()
    expect(screen.getByText('Female')).toBeInTheDocument()
    expect(screen.getByText('Reads Hindi')).toBeInTheDocument()
    expect(screen.getByText('Caregiver Priya Verma, daughter')).toBeInTheDocument()
    expect(screen.getByText('Patient since 3 Nov 2025')).toBeInTheDocument()
    const facts = screen.getByLabelText('About this patient')
    expect(facts).toHaveTextContent(/Next visit4 Nov 2026,? 10:00/)
    expect(facts).toHaveTextContent('Last visit29 Sept 2026')
    expect(facts).toHaveTextContent('Checklist3 medicines, since 9 Oct 2026')
  })

  it('names the phone SMS is read from, and links to the SMS card', async () => {
    setup('/patients/p-1/visit')
    const facts = await screen.findByLabelText('About this patient')
    expect(within(facts).getByRole('link', { name: 'Phone ending 0001' })).toHaveAttribute('href', '/patients/p-1/sms-card')
  })

  it('says a booked visit has not started once its time has passed', async () => {
    setup('/patients/p-1/visit', { ...asha, next_visit: '2026-10-01T10:00:00+05:30' })
    expect(await screen.findByLabelText('About this patient')).toHaveTextContent(/Next visit1 Oct 2026,? 10:00, not started/)
  })

  it('offers an upload with the patient already chosen', async () => {
    setup('/patients/p-1/visit')
    const upload = await screen.findByRole('link', { name: 'Upload a document' })
    expect(upload).toHaveAttribute('href', '/upload?patient=p-1')
  })

  it('names the browser tab after the section and the patient', async () => {
    setup('/patients/p-1/documents/d-1/reading')
    await screen.findByRole('heading', { name: 'Asha Verma' })
    expect(document.title).toBe('How this document was read · Asha Verma · Consultation Readiness')
  })

  it('says plainly when nothing is booked and there is no checklist', async () => {
    setup('/patients/p-1/visit', patientListItem({ id: 'p-1', registration_no: 'DEV-0001', full_name: 'Asha Verma' }))
    const facts = await screen.findByLabelText('About this patient')
    expect(facts).toHaveTextContent('Next visitNone booked')
    expect(facts).toHaveTextContent('ChecklistNone yet')
    expect(facts).toHaveTextContent('SMSNot set up')
    expect(within(facts).queryByRole('link')).not.toBeInTheDocument()
  })
})
