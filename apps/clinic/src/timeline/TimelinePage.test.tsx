import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { installMockServer } from '../test/msw'
import { TimelinePage } from './TimelinePage'

const server = installMockServer()

const record = (documents: unknown[] = []) => ({
  patient: { id: 'p-1', registration_no: 'DEV-0001', full_name: 'Asha Verma', year_of_birth: 1968, sex: 'F' },
  documents,
})

const labReport = {
  id: 'd-1', doc_type: 'lab_report', document_date: '2026-10-12', issuing_source: 'Sunrise Diagnostics (fictional)',
  values: [{ id: 'v-1', analyte_code: 'hba1c', analyte_name: 'HbA1c', value_text: '8.4', unit_text: '%', observed_at: '2026-10-12' }],
}

function setup(patient = 'p-1', documents: unknown[] = [labReport]) {
  server.use(http.get('*/api/patients/:id/record', () => HttpResponse.json(record(documents))))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/patients/${patient}/timeline`]}>
        <Routes>
          <Route path="/patients/:patientId/timeline" element={<TimelinePage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const day = (iso: string) => document.querySelector<HTMLElement>(`[data-day="${iso}"]`)!

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-21T09:00:00') })
})
afterEach(() => vi.useRealTimers())

describe('TimelinePage', () => {
  it('lists 28 days, newest first', async () => {
    setup()
    await screen.findAllByText('Medicines')
    const days = [...document.querySelectorAll('[data-day]')].map((el) => el.getAttribute('data-day'))
    expect(days).toHaveLength(28)
    expect(days[0]).toBe('2026-10-21')
    expect(days[27]).toBe('2026-09-24')
  })

  it('keeps documents and patient entries in separate columns of the same day', async () => {
    setup()
    await screen.findAllByText('Medicines')
    const d = day('2026-10-12')
    const docs = within(d).getByRole('region', { name: /From documents/ })
    const patient = within(d).getByRole('region', { name: /From the patient/ })
    expect(within(docs).getByRole('link', { name: /HbA1c 8\.4 %, see where it came from/ })).toHaveAttribute(
      'href', '/patients/p-1/documents/values/v-1',
    )
    expect(within(patient).queryByText('HbA1c')).not.toBeInTheDocument()
    expect(within(patient).getByText('Medicines')).toBeInTheDocument()
  })

  it('shows every medicine on the checklist each day, including gaps', async () => {
    setup()
    await screen.findAllByText('Medicines')
    const states = [...document.querySelectorAll('[data-tick-state]')].map((el) => el.getAttribute('data-tick-state'))
    expect(states).toContain('ticked')
    expect(states).toContain('no_entry')
    // Ticks start the day the checklist was activated (2 Oct), three medicines a day.
    expect(day('2026-10-01').querySelector('[data-tick-state]')).toBeNull()
    expect(day('2026-10-02').querySelectorAll('[data-tick-state]')).toHaveLength(3)
  })

  it('shows answers as given, in their language and direction', async () => {
    setup()
    const hindi = (await screen.findAllByText(/^(नहीं|सुबह थोड़ा चक्कर आया)$/))[0]
    expect(hindi).toHaveAttribute('lang', 'hi')
    expect(screen.getAllByText('Did you feel unwell today?').length).toBeGreaterThan(5)
    expect(screen.getAllByText('Answered in Hindi').length).toBeGreaterThan(5)
  })

  it('renders Urdu answers right to left', async () => {
    setup('p-2', [])
    const urdu = (await screen.findAllByText(/^(نہیں|صبح تھوڑا چکر آیا)$/))[0]
    expect(urdu).toHaveAttribute('dir', 'rtl')
    expect(urdu).toHaveAttribute('lang', 'ur')
  })

  it('marks entries that did not come from the patient in the app', async () => {
    setup()
    await screen.findAllByText('Medicines')
    expect(screen.getAllByText(/entered by Priya Verma \(daughter\)/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Paper form, entered by clinic staff/).length).toBeGreaterThan(0)
    expect(screen.queryByText(/^App$/)).not.toBeInTheDocument()
  })

  it('shows meal photos small, and opens each as it was sent', async () => {
    setup()
    const links = await screen.findAllByRole('link', { name: 'Open the photograph' })
    for (const link of links) {
      const photo = link.getAttribute('href')!
      expect(link.querySelector('img')).toHaveAttribute('src', `${photo}?width=320`)
    }
  })

  it('every glucose reading carries its context, and nothing interpretive appears', async () => {
    setup()
    await screen.findAllByText('Medicines')
    const text = document.body.textContent ?? ''
    expect(text).not.toMatch(/\b(high|low|normal|target|average|trend|abnormal|good|poor)\b/i)
    for (const label of screen.getAllByText('Glucose')) {
      expect(label.parentElement!.textContent).toMatch(/mg\/dL(Fasting|Before a meal|After a meal|Bedtime|Overnight|Not linked to a meal)/)
    }
  })

  it('loads four more weeks on request', async () => {
    setup()
    await screen.findAllByText('Medicines')
    const user = userEvent.setup({ advanceTimers: () => {} })
    await user.click(screen.getByRole('button', { name: 'Show four more weeks' }))
    await screen.findByText(/^27 Aug 2026 to 21 Oct 2026$/)
    expect(document.querySelectorAll('[data-day]')).toHaveLength(56)
  })

  it('explains an empty record', async () => {
    setup('p-4', [])
    expect(await screen.findByText('Nothing is in this record for these four weeks.')).toBeInTheDocument()
  })
})
