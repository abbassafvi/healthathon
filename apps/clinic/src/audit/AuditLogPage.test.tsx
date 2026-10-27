import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it } from 'vitest'

import type { AuditEntry, AuditLog } from '../api/client'
import { installMockServer } from '../test/msw'
import { AuditLogPage } from './AuditLogPage'

const server = installMockServer()

const entry = (over: Partial<AuditEntry>): AuditEntry => ({
  id: 1, occurred_at: '2026-10-21T10:02:00+05:30', action: 'value.confirm', kind: 'decision',
  actor_name: 'Dr. Demo Clinician', actor_role: 'clinician',
  patient: { id: 'p-1', registration_no: 'DEV-0001', full_name: 'Asha Verma' },
  reason_code: null, decision_latency_ms: null, ...over,
})

const asked: URLSearchParams[] = []

function setup(pages: (params: URLSearchParams) => AuditLog) {
  server.use(
    http.get('*/api/audit-log', ({ request }) => {
      const params = new URL(request.url).searchParams
      asked.push(params)
      return HttpResponse.json(pages(params))
    }),
  )
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/audit']}>
        <Routes>
          <Route path="/audit" element={<AuditLogPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return userEvent.setup()
}

const intact = { checked: 12, intact: true, first_broken_id: null }

beforeEach(() => {
  asked.length = 0
})

describe('AuditLogPage', () => {
  it('states that the chain checks out, and how many events were checked', async () => {
    setup(() => ({ chain: intact, entries: [entry({})], next_before: null }))
    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent('Chain intact12 events checked. Each hash follows from the one before it.')
  })

  it('names the first event that does not follow when the chain is broken', async () => {
    setup(() => ({ chain: { checked: 6, intact: false, first_broken_id: 7 }, entries: [entry({})], next_before: null }))
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Chain broken at event 76 events before it check out. Everything from event 7 on cannot be trusted.',
    )
  })

  it('says what happened in words, who did it, and for whom', async () => {
    setup(() => ({
      chain: intact,
      next_before: null,
      entries: [
        entry({ id: 3, action: 'reading.record', kind: 'patient', actor_name: null, actor_role: null }),
        entry({ id: 2, action: 'value.correct', reason_code: 'readers_disagree', decision_latency_ms: 3400 }),
        entry({ id: 1, action: 'sms.refuse', kind: 'patient', actor_name: null, actor_role: null, patient: null }),
      ],
    }))
    const table = await screen.findByRole('table')
    const [, ...body] = within(table).getAllByRole('row')
    expect(body[0]).toHaveTextContent('The patientRecorded a glucose readingAsha Verma3')
    expect(body[1]).toHaveTextContent('Dr. Demo ClinicianCorrected a valueReason: Two readings of this region disagree. 3.4 s to decide')
    expect(body[2]).toHaveTextContent('SMS gatewayAn SMS was refused1')
    expect(within(body[0]).getByRole('link', { name: 'Asha Verma' })).toHaveAttribute('href', '/patients/p-1/visit')
  })

  it('filters by kind', async () => {
    const user = setup((p) => ({ chain: intact, entries: [entry({ id: p.get('kind') ? 9 : 1 })], next_before: null }))
    await screen.findByRole('table')
    await user.click(screen.getByRole('button', { name: 'Decisions' }))
    expect(screen.getByRole('button', { name: 'Decisions' })).toHaveAttribute('aria-pressed', 'true')
    await screen.findByText('9')
    expect(asked.map((p) => p.get('kind'))).toEqual([null, 'decision'])
  })

  it('goes back through older events on request', async () => {
    const user = setup((p) =>
      p.get('before')
        ? { chain: intact, entries: [entry({ id: 1 })], next_before: null }
        : { chain: intact, entries: [entry({ id: 3 }), entry({ id: 2 })], next_before: 2 },
    )
    await screen.findByRole('table')
    await user.click(screen.getByRole('button', { name: 'Show older events' }))
    await screen.findByText('1')
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(4)
    expect(asked.map((p) => p.get('before'))).toEqual([null, '2'])
    expect(screen.queryByRole('button', { name: 'Show older events' })).not.toBeInTheDocument()
  })
})
