import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { VisitSummary } from '../api/client'
import { installMockServer } from '../test/msw'
import { recount } from './score'
import { VisitPage } from './VisitPage'

const server = installMockServer()

const labReport = {
  id: 'd-1', doc_type: 'lab_report', document_date: '2026-10-12', issuing_source: 'Sunrise Diagnostics (fictional)',
  values: [{ id: 'v-1', analyte_code: 'hba1c', analyte_name: 'HbA1c', value_text: '8.4', unit_text: '%', observed_at: '2026-10-12' }],
}
const oldReport = { ...labReport, id: 'd-0', document_date: '2026-08-01', values: [{ ...labReport.values[0], id: 'v-0', value_text: '9.9' }] }

function setup(patient = 'p-1') {
  server.use(
    http.get('*/api/patients/:id/record', () =>
      HttpResponse.json({ patient: { id: patient, registration_no: 'X', full_name: 'X', year_of_birth: null, sex: null }, documents: [labReport, oldReport] }),
    ),
  )
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/patients/${patient}/visit`]}>
        <Routes>
          <Route path="/patients/:patientId/visit" element={<VisitPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return userEvent.setup()
}

async function summary(patient = 'p-1'): Promise<VisitSummary> {
  return (await fetch(new URL(`/api/patients/${patient}/visit`, window.location.origin))).json()
}

beforeEach(() => vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-21T09:00:00') }))
afterEach(() => vi.useRealTimers())

describe('VisitPage', () => {
  it('puts documents and patient entries in two halves for the same period', async () => {
    setup()
    const docs = await screen.findByRole('region', { name: /From documents since the last visit/ })
    const patient = screen.getByRole('region', { name: /From the patient since the last visit/ })
    expect(within(docs).getByRole('link', { name: /HbA1c/ })).toHaveAttribute('href', '/patients/p-1/documents/values/v-1')
    // A document from before the period is not on this page.
    expect(within(docs).queryByText('9.9')).not.toBeInTheDocument()
    expect(within(patient).getByRole('region', { name: 'Glucose readings' })).toBeInTheDocument()
    expect(screen.getByText(/^Covers 23 Sept 2026 to 21 Oct 2026, since the visit on 22 Sept 2026\.$/)).toBeInTheDocument()
  })

  it('leads the score with its count, and the count matches its own days', async () => {
    setup()
    const count = await screen.findByTestId('score-count')
    const s = (await summary()).compliance!
    expect(recount(s).matches).toBe(true)
    expect(count).toHaveTextContent(`${s.ticked_count} of ${s.expected_count} ticks`)
    expect(screen.getByTestId('score-percent')).toHaveTextContent(`${s.score_percent}%`)
    expect(screen.getByText(/Glucose readings and answers are not part of it\. Shown to clinicians only\./)).toBeInTheDocument()
  })

  it('refuses to show a score that does not match its day array', async () => {
    const real = await summary()
    server.use(http.get('*/api/patients/:id/visit', () =>
      HttpResponse.json({ ...real, compliance: { ...real.compliance!, ticked_count: real.compliance!.ticked_count + 3 } }),
    ))
    setup()
    expect(await screen.findByRole('alert')).toHaveTextContent('does not match the day array')
    expect(screen.queryByTestId('score-count')).not.toBeInTheDocument()
    expect(screen.getByRole('grid', { name: 'Ticks by medicine and day' })).toBeInTheDocument()
  })

  it('opens the day array, and each cell says what it came from', async () => {
    const user = setup()
    await user.click(await screen.findByRole('button', { name: 'Show the days' }))
    const grid = screen.getByRole('grid', { name: 'Ticks by medicine and day' })
    const s = (await summary()).compliance!
    expect(within(grid).getAllByRole('button')).toHaveLength(s.expected_count)

    const gap = grid.querySelector<HTMLElement>('[data-cell-state="no_entry"]')!
    await user.click(gap)
    expect(screen.getByTestId('cell-detail')).toHaveTextContent('No entry. Nothing was recorded for this medicine on this day.')
    const tick = grid.querySelector<HTMLElement>('[data-cell-state="ticked"]')!
    await user.click(tick)
    expect(screen.getByTestId('cell-detail')).toHaveTextContent(/Ticked at \d{2}:\d{2}\./)
  })

  it('moves through the day array with the arrow keys, across weeks, with one tab stop', async () => {
    const user = setup()
    await user.click(await screen.findByRole('button', { name: 'Show the days' }))
    const grid = screen.getByRole('grid')
    const tabbable = within(grid).getAllByRole('button').filter((b) => b.tabIndex === 0)
    expect(tabbable).toHaveLength(1)
    tabbable[0].focus()
    const before = document.activeElement!.getAttribute('data-date')!
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' })
    const after = document.activeElement!.getAttribute('data-date')!
    expect(after < before).toBe(true)
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' })
    expect(document.activeElement).toHaveAttribute('data-date')
  })

  it('shows the newest readings and answers, with the rest in place on request', async () => {
    const user = setup()
    const table = await screen.findByRole('table')
    expect(table.querySelectorAll('tbody tr')).toHaveLength(10)
    const more = screen.getAllByRole('button', { name: /^Show all \d+$/ })[0]
    const total = Number(more.textContent!.match(/\d+/)![0])
    await user.click(more)
    expect(table.querySelectorAll('tbody tr')).toHaveLength(total)
    expect(screen.getAllByRole('button', { name: 'Show fewer' })[0]).toHaveAttribute('aria-expanded', 'true')
    // Nothing on the page scrolls inside the page.
    expect(document.querySelector('[class*="overflow-y-auto"]')).toBeNull()
  })

  it('states an order with no report as a fact about the record', async () => {
    setup()
    const orders = await screen.findByRole('region', { name: 'Tests ordered' })
    expect(within(orders).getByText('No matching report in this record')).toBeInTheDocument()
    expect(within(orders).getByText('Report in this record')).toBeInTheDocument()
    expect(orders.textContent).not.toMatch(/due|overdue|missing|should|recommend/i)
  })

  it('says there is nothing to count without a checklist', async () => {
    setup('p-2')
    expect(await screen.findByText('No checklist was active in this period, so there are no ticks to count.')).toBeInTheDocument()
  })

  it('shows nothing interpretive anywhere on the page', async () => {
    setup()
    await screen.findByTestId('score-count')
    expect(document.body.textContent).not.toMatch(/\b(high|low|normal|target|average|trend|abnormal|good|poor|risk|control)\b/i)
  })
})
