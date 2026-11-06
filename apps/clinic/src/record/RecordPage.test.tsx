import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { patientListItem, trace } from '../test/fixtures'
import { controlImages } from '../test/images'
import { PatientLayout } from '../patient/PatientLayout'
import { TracePanel } from '../trace/TracePanel'
import { RecordPage } from './RecordPage'

const record = {
  patient: { id: 'p-1', registration_no: 'DEV-0001', full_name: 'Asha Verma', year_of_birth: 1968, sex: 'F' },
  documents: [
    {
      id: 'd-1', doc_type: 'lab_report', document_date: '2026-10-12', issuing_source: 'Sunrise Diagnostics (fictional)',
      values: [
        { id: 'v-1', analyte_code: 'hba1c', analyte_name: 'HbA1c', value_text: '8.4', unit_text: '%', observed_at: '2026-10-12' },
        { id: 'v-2', analyte_code: 'ldl', analyte_name: 'LDL cholesterol', value_text: '118', unit_text: 'mg/dL', observed_at: '2026-10-12' },
      ],
    },
  ],
}

function Where() {
  return <span data-testid="where">{useLocation().pathname}</span>
}

let checklist: unknown = { active: null, awaiting_review: [] }

function setup(start = '/patients/p-1/documents', traceStatus = 200) {
  controlImages()
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
    const url = new URL(String(input)).pathname
    if (url === '/api/patients') return Response.json([patientListItem(record.patient)])
    if (url === '/api/patients/p-1/checklist') return Response.json(checklist)
    if (url === '/api/patients/p-1/record') return Response.json(record)
    if (url.startsWith('/api/values/')) {
      return traceStatus === 200
        ? Response.json(trace())
        : Response.json({ detail: 'This value is not shown in the record' }, { status: traceStatus })
    }
    return Response.json({ detail: 'not found' }, { status: 404 })
  }))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[start]}>
        <Routes>
          <Route path="/patients/:patientId" element={<PatientLayout />}>
            <Route path="documents" element={<RecordPage />}>
              <Route path="values/:valueId" element={<TracePanel />} />
            </Route>
          </Route>
        </Routes>
        <Where />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return userEvent.setup()
}

afterEach(() => {
  vi.unstubAllGlobals()
  checklist = { active: null, awaiting_review: [] }
})

describe('RecordPage', () => {
  it('lists values exactly as printed, in page order', async () => {
    setup()
    expect(await screen.findByRole('heading', { name: 'Asha Verma' })).toBeInTheDocument()
    const links = screen.getAllByRole('link').filter((l) => l.hasAttribute('data-value-id'))
    expect(links.map((l) => l.textContent)).toEqual(['HbA1c8.4%', 'LDL cholesterol118mg/dL'])
  })

  it('lists prescriptions among the documents, newest first, with where each stands', async () => {
    const rx = (id: string, date: string) => ({ id, document_date: date, issuing_source: 'Dr. Kavita Rao, MD (fictional)' })
    checklist = {
      active: { id: 'r-1', activated_at: '2026-10-09T10:05:00+05:30', activated_by_name: 'Dr. Demo Clinician', source_document: rx('d-rx1', '2026-10-09'), items: [{}, {}, {}] },
      awaiting_review: [{ regimen_id: 'r-2', document: rx('d-rx2', '2026-10-27'), item_count: 4, confirmed_count: 1, settled_count: 1 }],
    }
    setup()
    await screen.findByRole('heading', { name: 'Asha Verma' })
    const headings = await screen.findAllByRole('heading', { level: 2 })
    expect(headings.map((h) => h.textContent)).toEqual([
      expect.stringContaining('Prescription27 Oct 2026'),
      expect.stringContaining('Lab report12 Oct 2026'),
      expect.stringContaining('Prescription9 Oct 2026'),
    ])
    expect(screen.getByText('Select a value to see where it came from on the page.').closest('section')).toHaveTextContent(/^Lab report/)
    expect(screen.getByText('3 lines waiting for review before they reach the checklist.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Review the lines' })).toHaveAttribute('href', '/patients/p-1/checklist/review/r-2')
    expect(screen.getByText('The checklist in force since 9 Oct 2026: 3 medicines.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open the checklist' })).toHaveAttribute('href', '/patients/p-1/checklist')
    expect(screen.getAllByRole('link', { name: 'How this prescription was read' }).map((l) => l.getAttribute('href'))).toEqual([
      '/patients/p-1/documents/d-rx2/reading', '/patients/p-1/documents/d-rx1/reading',
    ])
  })

  it('opens the trace beside the record, and Escape returns focus to the value', async () => {
    const user = setup()
    const row = await screen.findByRole('link', { name: /HbA1c/ })
    await user.click(row)
    expect(screen.getByTestId('where')).toHaveTextContent('/patients/p-1/documents/values/v-1')
    const panel = await screen.findByRole('dialog', { name: 'Where this value came from' })
    expect(panel).toBeInTheDocument()
    expect(row).toHaveAttribute('aria-current', 'true')
    expect(await screen.findByTestId('trace-history')).toHaveTextContent('Accepted by the checks.')
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Where this value came from' })).toHaveFocus())

    await user.keyboard('{Escape}')
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/patients\/p-1\/documents$/)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('link', { name: /HbA1c/ })).toHaveFocus())
  })

  it('the close button closes the trace', async () => {
    const user = setup('/patients/p-1/documents/values/v-1')
    await user.click(await screen.findByRole('button', { name: /close/i }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('explains a value that is not in the record', async () => {
    setup('/patients/p-1/documents/values/v-9', 404)
    expect(await screen.findByText(/this value is not shown in the record/i)).toBeInTheDocument()
  })

  it('says so when the patient does not exist', async () => {
    setup('/patients/nobody/documents')
    expect(await screen.findByText('There is no patient with this record.')).toBeInTheDocument()
  })
})
