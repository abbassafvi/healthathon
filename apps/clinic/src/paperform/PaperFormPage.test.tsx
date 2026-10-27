import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { installMockServer, TEST_PATIENTS } from '../test/msw'
import { PaperFormPage } from './PaperFormPage'

const server = installMockServer()

function setup() {
  const languages: Record<string, string> = { 'DEV-0001': 'hi', 'DEV-0002': 'ur' }
  server.use(
    http.get('*/api/patients', () =>
      HttpResponse.json(TEST_PATIENTS.map((p) => ({ ...p, preferred_language: languages[p.registration_no] ?? 'en' }))),
    ),
  )
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/patients/p-1/paper-form']}>
        <Routes>
          <Route path="/patients/:patientId/paper-form" element={<PaperFormPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return userEvent.setup()
}

const cells = () => [...document.querySelectorAll<HTMLButtonElement>('[data-cell]')]
const free = () => cells().filter((c) => !c.hasAttribute('data-locked'))
const locked = () => cells().filter((c) => c.hasAttribute('data-locked'))

beforeEach(() => vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-21T09:00:00') }))
afterEach(() => vi.useRealTimers())

describe('PaperFormPage', () => {
  it('shows last week, with days already recorded in the app locked', async () => {
    setup()
    await screen.findByRole('grid', { name: 'Medicine ticks' })
    expect(screen.getByText('14 Oct 2026 to 20 Oct 2026')).toBeInTheDocument()
    expect(locked().length).toBeGreaterThan(0)
    expect(free().length).toBeGreaterThan(0)
    const l = locked()[0]
    expect(l).toHaveAttribute('aria-disabled', 'true')
    expect(l.getAttribute('aria-label')).toMatch(/Already recorded in the app$/)
    const before = l.dataset.value
    fireEvent.click(l)
    fireEvent.keyDown(l, { key: 't' })
    expect(l.dataset.value).toBe(before)
  })

  it("starts the answers in the patient's language", async () => {
    const user = setup()
    await screen.findByRole('grid')
    const select = screen.getByLabelText('Answers written in')
    await waitFor(() => expect(select).toHaveValue('hi'))
    // A choice the staff make is kept.
    await user.selectOptions(select, 'en')
    expect(select).toHaveValue('en')
  })

  it('shows days already answered in the app instead of a box to retype them', async () => {
    setup()
    await screen.findByRole('grid')
    const lockedRows = [...document.querySelectorAll<HTMLElement>('[data-answer-locked]')]
    expect(lockedRows.length).toBeGreaterThan(0)
    for (const row of lockedRows) {
      expect(row).toHaveTextContent('Already recorded in the app')
      expect(row.querySelector('input')).toBeNull()
    }
    const inputs = document.querySelectorAll('input[id^="answer-"]').length
    expect(inputs + lockedRows.length).toBe(7)
  })

  it('fills a free box with T, N, Space and Delete, and moves with arrows', async () => {
    setup()
    await screen.findByRole('grid')
    const cell = free()[0]
    cell.focus()
    fireEvent.keyDown(cell, { key: 't' })
    expect(cell.dataset.value).toBe('ticked')
    fireEvent.keyDown(cell, { key: 'n' })
    expect(cell.dataset.value).toBe('not_ticked')
    fireEvent.keyDown(cell, { key: 'Delete' })
    expect(cell.dataset.value).toBe('blank')
    fireEvent.click(cell)
    expect(cell.dataset.value).toBe('ticked')
    fireEvent.keyDown(cell, { key: 'ArrowRight' })
    expect(document.activeElement).not.toBe(cell)
    expect(document.activeElement).toHaveAttribute('data-cell')
  })

  it('will not go to the summary until every reading has a value and a context', async () => {
    const user = setup()
    await screen.findByRole('grid')
    await user.click(screen.getByRole('button', { name: 'Add a reading' }))
    await user.click(screen.getByRole('button', { name: 'Check before saving' }))
    const alert = screen.getByRole('alert')
    expect(within(alert).getByRole('link', { name: 'Reading 1 has no value.' })).toHaveAttribute('href', '#glucose-' + document.querySelector('fieldset input[inputmode]')!.id.split('-')[1] + '-value')
    expect(within(alert).getByText('Reading 1 needs its context.')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'You are about to save' })).not.toBeInTheDocument()
  })

  it('summarises, saves, and the entries reach the record', async () => {
    const user = setup()
    await screen.findByRole('grid')
    fireEvent.keyDown(free()[0], { key: 't' })
    await user.click(screen.getByRole('button', { name: 'Add a reading' }))
    await user.type(screen.getByLabelText('Reading (mg/dL)'), '142')
    await user.selectOptions(screen.getByLabelText('Context'), 'fasting')
    await user.type(screen.getByLabelText(/14 Oct 2026, Answer for 14 Oct 2026/), 'No')
    await user.click(screen.getByRole('button', { name: 'Check before saving' }))

    expect(screen.getByRole('heading', { name: 'You are about to save' })).toBeInTheDocument()
    expect(screen.getByText('For Asha Verma, 14 Oct 2026 to 20 Oct 2026, from a paper form.')).toBeInTheDocument()
    expect(screen.getByText('1 ticked, 0 not ticked')).toBeInTheDocument()
    expect(screen.getByText('1 glucose readings')).toBeInTheDocument()
    expect(screen.getByText('1 answers')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save the form' }))

    expect(await screen.findByText(/^Saved\. 3 entries are now in the record/)).toBeInTheDocument()
    const page = await (await fetch(new URL('/api/patients/p-1/entries?from=2026-10-14&to=2026-10-20', window.location.origin))).json()
    expect(page.entries.filter((e: { id: string; channel: string; entered_by: string }) => e.channel === 'paper_form' && e.entered_by === 'clinic_staff' && e.id.startsWith('pf-')).length).toBe(3)
  })

  it('says so when the app recorded a day after the form was opened', async () => {
    const user = setup()
    await screen.findByRole('grid')
    fireEvent.keyDown(free()[0], { key: 't' })
    server.use(http.post('*/api/patients/:id/paper-form', () => HttpResponse.json({ detail: 'taken' }, { status: 409 })))
    await user.click(screen.getByRole('button', { name: 'Check before saving' }))
    await user.click(screen.getByRole('button', { name: 'Save the form' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('recorded in the app since the form was opened')
  })

  it('goes back to the form with everything kept', async () => {
    const user = setup()
    await screen.findByRole('grid')
    const cell = free()[0]
    const key = cell.dataset.cell
    fireEvent.keyDown(cell, { key: 'n' })
    await user.click(screen.getByRole('button', { name: 'Check before saving' }))
    await user.click(screen.getByRole('button', { name: 'Back to the form' }))
    await waitFor(() => expect(document.querySelector(`[data-cell="${key}"]`)).toHaveAttribute('data-value', 'not_ticked'))
  })
})
