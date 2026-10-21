import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { describe, expect, it } from 'vitest'

import { installMockServer } from '../test/msw'
import { ChecklistPage } from './ChecklistPage'

installMockServer()

function setup(patient: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/patients/${patient}/checklist`]}>
        <Routes>
          <Route path="/patients/:patientId/checklist" element={<ChecklistPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('ChecklistPage', () => {
  it('shows the active checklist as printed, each with its crop, and who activated it', async () => {
    setup('p-1')
    const active = await screen.findByRole('region', { name: 'Active checklist' })
    const items = within(active).getAllByRole('listitem')
    expect(items).toHaveLength(3)
    expect(items[0]).toHaveTextContent('Tab. Metformin500 mg1-0-1')
    expect(within(items[0]).getByRole('img', { name: /Tab\. Metformin is written/ })).toBeInTheDocument()
    expect(within(active).getByText(/^Activated 2 Oct 2026, 10:05 by Dr\. Demo Clinician/)).toBeInTheDocument()
  })

  it('lists a prescription waiting for review with its progress and a link', async () => {
    setup('p-1')
    const waiting = await screen.findByRole('region', { name: 'Waiting for review' })
    expect(within(waiting).getByText('0 of 4 confirmed')).toBeInTheDocument()
    expect(within(waiting).getByRole('link', { name: 'Review' })).toHaveAttribute(
      'href', '/patients/p-1/checklist/review/rx-0001-b',
    )
  })

  it('explains how a checklist starts when there is none', async () => {
    setup('p-4')
    expect(await screen.findByText('No checklist is active.')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Waiting for review' })).not.toBeInTheDocument()
  })

  it('says so when the checklist cannot be loaded', async () => {
    setup('nobody')
    expect(await screen.findByText('The checklist could not be loaded.')).toBeInTheDocument()
  })
})
