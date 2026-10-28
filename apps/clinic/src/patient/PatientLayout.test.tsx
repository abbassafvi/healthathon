import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { MemoryRouter, Route, Routes } from 'react-router'
import { describe, expect, it } from 'vitest'

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
  })
})
