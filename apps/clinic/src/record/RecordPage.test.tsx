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

function setup(start = '/patients/p-1/documents', traceStatus = 200) {
  controlImages()
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
    const url = new URL(String(input)).pathname
    if (url === '/api/patients') return Response.json([patientListItem(record.patient)])
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

afterEach(() => vi.unstubAllGlobals())

describe('RecordPage', () => {
  it('lists values exactly as printed, in page order', async () => {
    setup()
    expect(await screen.findByRole('heading', { name: 'Asha Verma' })).toBeInTheDocument()
    const links = screen.getAllByRole('link').filter((l) => l.hasAttribute('data-value-id'))
    expect(links.map((l) => l.textContent)).toEqual(['HbA1c8.4%', 'LDL cholesterol118mg/dL'])
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
