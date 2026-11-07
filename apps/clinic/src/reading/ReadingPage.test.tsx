import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { MemoryRouter, Route, Routes } from 'react-router'
import { describe, expect, it } from 'vitest'

import type { DocumentReading, ReadValue } from '../api/client'
import { installMockServer } from '../test/msw'
import { ReadingPage } from './ReadingPage'

const server = installMockServer()

const pass = (code: ReadValue['checks'][number]['code']) => ({ code, outcome: 'pass' as const })
const five = (failed?: string): ReadValue['checks'] =>
  (['grounding', 'reread_agreement', 'cross_document', 'well_formed', 'legibility'] as const).map((code) =>
    code === failed ? { code, outcome: 'fail' as const } : code === 'cross_document' ? { code, outcome: 'not_applicable' as const } : pass(code),
  )

const value = (over: Partial<ReadValue>): ReadValue => ({
  id: 'v', analyte_name: 'HbA1c', page_no: 1, box: { x: 0.1, y: 0.1, w: 0.1, h: 0.02 },
  went_to: 'record', reason: null, checks: five(), waiting: false,
  shown: { value_text: '8.4', unit_text: '%' }, settled: null, ...over,
})

const base: Omit<DocumentReading, 'values' | 'lines'> = {
  document: { id: 'd-1', doc_type: 'lab_report', document_date: '2026-10-18', issuing_source: 'Sunrise Diagnostics (fictional)', received_at: '2026-10-21T09:12:00+05:30', page_count: 1, sent_from: 'desk_scan' },
  patient: { id: 'p-1', registration_no: 'DEV-0001', full_name: 'Asha Verma' },
  pages: [{ page_no: 1, url: '/api/storage/dev/pages/a.png', width_px: 1240, height_px: 1754 }],
  run: { reader_name: 'dev-seed', reader_version: '0', profile_version: 'dev', code_commit: 'abc123', started_at: '2026-10-21T09:12:00+05:30', finished_at: null },
}

const lab: DocumentReading = {
  ...base,
  lines: [],
  values: [
    value({ id: 'v-1' }),
    value({ id: 'v-2', analyte_name: 'Fasting plasma glucose', went_to: 'person', reason: 'region_illegible', checks: five('legibility'), waiting: true, shown: null }),
    value({
      id: 'v-3', analyte_name: 'LDL cholesterol', went_to: 'person', reason: 'readers_disagree', checks: five('reread_agreement'),
      shown: { value_text: '96', unit_text: 'mg/dL' },
      settled: { action: 'corrected', by_name: 'Dr. Demo Clinician', at: '2026-10-21T10:02:00+05:30', decision_latency_ms: 3400, original_value_text: '86', original_unit_text: 'mg/dL' },
    }),
    value({
      id: 'v-4', analyte_name: 'Triglycerides', went_to: 'person', reason: 'outside_assay_range', checks: five('well_formed'), shown: null,
      settled: { action: 'discarded', by_name: 'Dr. Demo Clinician', at: '2026-10-21T10:03:00+05:30', decision_latency_ms: 2100, original_value_text: null, original_unit_text: null },
    }),
  ],
}

function setup(reading: DocumentReading) {
  server.use(http.get('*/api/documents/:id/reading', () => HttpResponse.json(reading)))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/patients/p-1/documents/d-1/reading']}>
        <Routes>
          <Route path="/patients/:patientId/documents/:documentId/reading" element={<ReadingPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return userEvent.setup()
}

const rows = () => screen.getAllByRole('listitem').filter((li) => li.parentElement?.tagName === 'OL')

describe('ReadingPage', () => {
  it('leads with how much went straight to the record and how much to a person', async () => {
    setup(lab)
    await screen.findByRole('heading', { name: 'How this document was read' })
    const summary = screen.getByText('values read').parentElement!.parentElement!
    expect(summary).toHaveTextContent('4values read')
    expect(summary).toHaveTextContent('1passed every check that applied and went straight to the record')
    expect(summary).toHaveTextContent('3went to a person')
    expect(summary).toHaveTextContent('2 settled, 1 still waiting.')
    expect(screen.getByText(/checks every value five ways/)).toBeInTheDocument()
  })

  it('lists each value in page order, numbered as on the page, with where it went', async () => {
    setup(lab)
    await screen.findByText('HbA1c')
    expect(rows().map((r) => within(r).getByRole('button').textContent)).toEqual([
      'HbA1c8.4%',
      'Fasting plasma glucoseNot shown until a person settles it',
      'LDL cholesterol96mg/dL',
      'TriglyceridesNot a value',
    ])
    expect(rows()[0]).toHaveTextContent('Went straight to the record.')
    expect(rows()[1]).toHaveTextContent('Went to a person. This part of the image is hard to read.')
    expect(within(rows()[1]).getByRole('link', { name: 'Waiting in the confirm queue' })).toHaveAttribute('href', '/queue')
  })

  it('names who settled a value, how, and how long it took', async () => {
    setup(lab)
    await screen.findByText('HbA1c')
    expect(rows()[2]).toHaveTextContent('Corrected by Dr. Demo Clinician, 21 Oct 2026, 10:02, after 3.4 s. The reader had 86 mg/dL.')
    expect(rows()[3]).toHaveTextContent('Marked not a value by Dr. Demo Clinician, 21 Oct 2026, 10:03, after 2.1 s.')
  })

  it('spells out a failed check first, counts the rest, and says why one did not apply', async () => {
    setup(lab)
    await screen.findByText('HbA1c')
    const checks = (i: number) => within(rows()[i]).getByRole('list', { name: 'Checks' })
    expect(within(checks(1)).getAllByRole('listitem').map((c) => c.textContent)).toEqual([
      '✕Region hard to read', '✓Passed the other 3 checks', '○No other document to compare',
    ])
    expect(within(checks(1)).getByText('Region hard to read').closest('li')).toHaveAttribute('data-outcome', 'fail')
    expect(within(checks(0)).getAllByRole('listitem').map((c) => c.textContent)).toEqual([
      '✓Passed 4 checks', '○No other document to compare',
    ])
  })

  it('counts every check as passed when all five did', async () => {
    const all = (['grounding', 'reread_agreement', 'cross_document', 'well_formed', 'legibility'] as const).map(pass)
    setup({ ...lab, values: [{ ...lab.values[0], checks: all }] })
    await screen.findByText('HbA1c')
    expect(within(rows()[0]).getByRole('list', { name: 'Checks' })).toHaveTextContent('✓Passed all 5 checks')
  })

  it('for a prescription, keeps lines waiting for review off the page and links once to the review', async () => {
    setup({
      ...base,
      document: { ...base.document, doc_type: 'prescription' },
      values: [],
      lines: [
        { id: 'l-1', page_no: 1, box: null, state: 'waiting', drug_text: null, dose_text: null, schedule_text: null, by_name: null, at: null, original_text: null, regimen_id: 'r-9' },
        { id: 'l-2', page_no: 1, box: null, state: 'corrected', drug_text: 'Inj. Insulin Glargine', dose_text: '12 units', schedule_text: 'at bedtime', by_name: 'Dr. Demo Clinician', at: '2026-10-21T10:05:00+05:30', original_text: 'Inj. Insulin Glargine 14 units at bedtime', regimen_id: 'r-9' },
      ],
    })
    await screen.findByText('lines read')
    expect(screen.getByText(/Every line of a handwritten prescription goes to a person/)).toHaveTextContent('1 still waiting for review.')
    expect(screen.getByRole('link', { name: 'Review the waiting lines' })).toHaveAttribute('href', '/patients/p-1/checklist/review/r-9')
    expect(within(rows()[0]).queryByRole('link')).toBeNull()
    expect(rows()[0]).toHaveTextContent('Waiting for review. Not shown until a person reviews it.')
    expect(rows()[1]).toHaveTextContent('Corrected by Dr. Demo Clinician, 21 Oct 2026, 10:05. The reader had Inj. Insulin Glargine 14 units at bedtime.')
  })

  it('marks the value chosen, so its box is the one drawn in the accent', async () => {
    const user = setup(lab)
    await screen.findByText('HbA1c')
    const second = within(rows()[1]).getByRole('button')
    expect(second).toHaveAttribute('aria-pressed', 'false')
    await user.click(second)
    expect(second).toHaveAttribute('aria-pressed', 'true')
  })

  it('names the reader run it came from', async () => {
    setup(lab)
    expect(await screen.findByText('Read by dev-seed 0, profile dev, code abc123, 21 Oct 2026, 09:12')).toBeInTheDocument()
  })
})
