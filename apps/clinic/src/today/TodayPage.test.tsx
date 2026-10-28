import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ClinicDay, DayVisit } from '../api/client'
import { installMockServer } from '../test/msw'
import { TodayPage } from './TodayPage'

const server = installMockServer()

const visit = (over: Partial<DayVisit> = {}): DayVisit => ({
  visit_id: 'v-1',
  scheduled_for: '2026-10-21T10:30:00+05:30',
  started_at: null,
  clinician_name: 'Dr. Demo Clinician',
  patient: { id: 'p-1', registration_no: 'DEV-0001', full_name: 'Asha Verma', year_of_birth: 1968, sex: 'F' },
  period_from: '2026-09-23',
  previous_visit: '2026-09-22',
  documents: { lab_reports: 1, prescriptions: 0 },
  waiting: { values: 2, prescription_lines: 0, review_regimen_id: null },
  checklist: { active_since: '2026-10-02', medicines: 3 },
  entries: { medicine_ticks: 51, glucose_readings: 30, answers: 1, meal_photos: 0, last_at: '2026-10-20T21:10:00+05:30' },
  ...over,
})

const asked: string[] = []

function setup(day: ClinicDay | ((date: string) => ClinicDay), path = '/today') {
  server.use(
    http.get('*/api/clinic-day', ({ request }) => {
      const date = new URL(request.url).searchParams.get('date') ?? ''
      asked.push(date)
      return HttpResponse.json(typeof day === 'function' ? day(date) : day)
    }),
  )
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/today" element={<><TodayPage /><Where /></>} />
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return userEvent.setup()
}

function Where() {
  const at = useLocation()
  return <output data-testid="where">{at.pathname + at.search}</output>
}

beforeEach(() => {
  asked.length = 0
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-21T09:00:00') })
})
afterEach(() => vi.useRealTimers())

describe('TodayPage', () => {
  it('lists the day’s visits in time order, each with its time and patient', async () => {
    setup({
      date: '2026-10-21',
      visits: [
        visit(),
        visit({ visit_id: 'v-2', scheduled_for: '2026-10-21T11:00:00+05:30', patient: { id: 'p-2', registration_no: 'DEV-0002', full_name: 'Imran Qureshi', year_of_birth: 1975, sex: 'M' } }),
      ],
    })
    const rows = await screen.findAllByRole('listitem')
    expect(rows.map((r) => within(r).getByRole('heading').textContent)).toEqual(['Asha Verma', 'Imran Qureshi'])
    expect(within(rows[0]).getByText('10:30')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'Today' })).toBeInTheDocument()
    expect(screen.getByText('2 visits booked')).toBeInTheDocument()
    expect(asked).toEqual(['2026-10-21'])
  })

  it('states each fact of the record as a count, since the last visit', async () => {
    setup({ date: '2026-10-21', visits: [visit()] })
    const row = await screen.findByRole('listitem')
    expect(within(row).getByText('Since the visit on 22 Sept 2026')).toBeInTheDocument()
    expect(within(row).getByText('1 lab report')).toBeInTheDocument()
    expect(within(row).getByRole('link', { name: '2 values in the confirm queue' })).toHaveAttribute('href', '/queue')
    expect(within(row).getByRole('link', { name: '3 medicines, since 2 Oct 2026' })).toHaveAttribute('href', '/patients/p-1/checklist')
    expect(within(row).getByText('51 medicine ticks, 30 glucose readings, 1 answer')).toBeInTheDocument()
    expect(within(row).getByText(/^Last entry 20 Oct 2026, 21:10$/)).toBeInTheDocument()
    expect(within(row).getAllByRole('link', { name: /Open the visit|Asha Verma/ }).map((l) => l.getAttribute('href')))
      .toEqual(['/patients/p-1/visit', '/patients/p-1/visit'])
  })

  it('says plainly when there is nothing, rather than leaving a gap', async () => {
    setup({
      date: '2026-10-21',
      visits: [visit({
        previous_visit: null,
        period_from: '2026-09-24',
        documents: { lab_reports: 0, prescriptions: 0 },
        waiting: { values: 0, prescription_lines: 0, review_regimen_id: null },
        checklist: { active_since: null, medicines: 0 },
        entries: { medicine_ticks: 0, glucose_readings: 0, answers: 0, meal_photos: 0, last_at: null },
      })],
    })
    const row = await screen.findByRole('listitem')
    for (const text of ['First visit. Covers from 24 Sept 2026', 'No documents', 'Nothing waiting', 'No checklist yet', 'Nothing recorded']) {
      expect(within(row).getByText(text)).toBeInTheDocument()
    }
  })

  it('links prescription lines waiting for review to that review', async () => {
    setup({ date: '2026-10-21', visits: [visit({ waiting: { values: 0, prescription_lines: 1, review_regimen_id: 'r-9' } })] })
    expect(await screen.findByRole('link', { name: '1 prescription line to review' }))
      .toHaveAttribute('href', '/patients/p-1/checklist/review/r-9')
  })

  it('moves to another day and back to today', async () => {
    const user = setup((date) => ({ date, visits: [] }))
    expect(await screen.findByText('No visits are booked for this day.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Next day' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Thursday, 22 October 2026' })).toBeInTheDocument()
    expect(screen.getByTestId('where')).toHaveTextContent('/today?date=2026-10-22')
    await user.click(screen.getByRole('button', { name: 'Back to today' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Today' })).toBeInTheDocument()
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/today$/)
    // Back on today, the day is fetched again: it may have changed meanwhile.
    expect(asked).toEqual(['2026-10-21', '2026-10-22', '2026-10-21'])
  })

  it('shows nothing interpretive', async () => {
    setup({ date: '2026-10-21', visits: [visit()] })
    await screen.findByRole('listitem')
    expect(document.body.textContent).not.toMatch(/\b(high|low|normal|good|bad|poor|risk|alert|urgent|overdue|late|missed|priority|score|%)\b/i)
  })
})
