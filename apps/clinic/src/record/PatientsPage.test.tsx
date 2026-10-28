import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { describe, expect, it } from 'vitest'

import { patientListItem } from '../test/fixtures'
import { installMockServer } from '../test/msw'
import { PatientsPage } from './PatientsPage'

const server = installMockServer()

const asha = patientListItem(
  { id: 'p-1', registration_no: 'DEV-0001', full_name: 'Asha Verma', year_of_birth: 1968, sex: 'F', preferred_language: 'hi' },
  {
    caregiver: { full_name: 'Priya Verma', relationship: 'daughter' },
    last_visit: '2026-09-29T11:00:00+05:30',
    next_visit: '2026-11-04T10:00:00+05:30',
    checklist_since: '2026-10-09T10:05:00+05:30',
    checklist_medicines: 3,
    waiting_values: 1,
    waiting_lines: 4,
    last_entry_at: '2026-10-20T21:40:00+05:30',
  },
)
const imran = patientListItem({ id: 'p-2', registration_no: 'DEV-0002', full_name: 'Imran Qureshi', year_of_birth: 1975, sex: 'M', preferred_language: 'ur' })

function Where() {
  return <span data-testid="where">{useLocation().pathname + useLocation().search}</span>
}

function setup(patients = [asha, imran], path = '/patients') {
  server.use(http.get('*/api/patients', () => HttpResponse.json(patients)))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/patients" element={<><PatientsPage /><Where /></>} />
          <Route path="/patients/:id" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return userEvent.setup()
}

const row = (name: string) => screen.getByRole('link', { name }).closest('tr')!

describe('PatientsPage', () => {
  it("shows what each patient's record holds now, in words and dates", async () => {
    setup()
    await screen.findByRole('link', { name: 'Asha Verma' })
    expect(screen.getByRole('status')).toHaveTextContent('2 enrolled')
    const a = row('Asha Verma')
    expect(a).toHaveTextContent('DEV-0001')
    expect(a).toHaveTextContent('Born 1968FemaleHindi')
    expect(a).toHaveTextContent('Priya Verma')
    expect(a).toHaveTextContent('29 Sept 2026')
    expect(a).toHaveTextContent('3 medicines')
    expect(a).toHaveTextContent('since 9 Oct 2026')
    expect(a).toHaveTextContent('1 value')
    expect(a).toHaveTextContent('4 prescription lines')
    const i = row('Imran Qureshi')
    for (const none of ['None named', 'None booked', 'None yet', 'Nothing', 'Nothing yet']) expect(i).toHaveTextContent(none)
  })

  it('says a booked visit has not started once its time has passed', async () => {
    setup([{ ...asha, next_visit: '2026-10-01T10:00:00+05:30' }])
    await screen.findByRole('link', { name: 'Asha Verma' })
    expect(row('Asha Verma')).toHaveTextContent(/1 Oct 2026,? 10:00, not started/)
  })

  it('finds a patient by name or registration number, and keeps the search in the address', async () => {
    const user = setup()
    await screen.findByRole('link', { name: 'Asha Verma' })
    await user.type(screen.getByLabelText('Find a patient'), 'qures')
    expect(screen.queryByRole('link', { name: 'Asha Verma' })).toBeNull()
    expect(screen.getByRole('link', { name: 'Imran Qureshi' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Showing 1 of 2')
    expect(screen.getByTestId('where')).toHaveTextContent('/patients?q=qures')
    await user.clear(screen.getByLabelText('Find a patient'))
    await user.type(screen.getByLabelText('Find a patient'), 'dev-0001')
    expect(screen.getByRole('link', { name: 'Asha Verma' })).toBeInTheDocument()
  })

  it('says when nothing matches, and clears the search', async () => {
    const user = setup([asha, imran], '/patients?q=zzz')
    expect(await screen.findByText('No patient matches "zzz".')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Clear' }))
    expect(screen.getByRole('link', { name: 'Asha Verma' })).toBeInTheDocument()
    expect(screen.getByLabelText('Find a patient')).toHaveFocus()
  })

  it('jumps to the search with the / key', async () => {
    const user = setup()
    await screen.findByRole('link', { name: 'Asha Verma' })
    await user.keyboard('/')
    expect(screen.getByLabelText('Find a patient')).toHaveFocus()
  })

  it('names the browser tab', async () => {
    setup()
    await screen.findByRole('link', { name: 'Asha Verma' })
    expect(document.title).toBe('Patients · Consultation Readiness')
  })

  it('says when the list could not be loaded, and tries again', async () => {
    let fail = true
    server.use(http.get('*/api/patients', () => (fail ? HttpResponse.json({}, { status: 500 }) : HttpResponse.json([asha]))))
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={client}><MemoryRouter><PatientsPage /></MemoryRouter></QueryClientProvider>)
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('The patient list could not be loaded.')
    fail = false
    await userEvent.setup().click(within(alert).getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('link', { name: 'Asha Verma' })).toBeInTheDocument()
  })

  it('judges no one: no colour, rank or flag words', async () => {
    setup()
    await screen.findByRole('link', { name: 'Asha Verma' })
    expect(document.body.textContent).not.toMatch(/\b(high|low|normal|abnormal|risk|overdue|missed|poor|good|bad|urgent|priority)\b/i)
  })
})
