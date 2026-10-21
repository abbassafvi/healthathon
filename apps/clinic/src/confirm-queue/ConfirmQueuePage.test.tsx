import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { queueItem } from '../test/fixtures'
import { ConfirmQueuePage } from './ConfirmQueuePage'
import type { Scheduler } from './useReviewSession'

const first = queueItem({ id: 'a', value_text: '162', unit_text: 'mg/dL', candidate_readings: [] })
const second = queueItem({ id: 'b', value_text: '7.1' })

type Call = { url: string; body: unknown }

function mockApi(decisionStatus = 200) {
  const calls: Call[] = []
  let open = [first, second]
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = new URL(String(input)).pathname
      if (url === '/api/confirm-queue') {
        return Response.json({ items: open, open_count: open.length })
      }
      const body = JSON.parse(String(init?.body))
      calls.push({ url, body })
      if (decisionStatus !== 200) {
        return Response.json({ detail: 'nope' }, { status: decisionStatus })
      }
      open = open.filter((i) => !url.includes(`/${i.id}/`))
      return Response.json({ item_id: 'a', action: body.action, value_id: 'v', replacement_value_id: null })
    }),
  )
  return calls
}

/*
 * A scheduler the test drives: the undo window ends only when the test
 * says so, so nothing here depends on how fast the machine is.
 */
function manualClock() {
  let queued: { fn: () => void; ms: number } | null = null
  const schedule: Scheduler = (fn, ms) => {
    const job = { fn, ms }
    queued = job
    return () => {
      if (queued === job) queued = null
    }
  }
  return {
    schedule,
    pendingMs: () => queued?.ms ?? null,
    elapse: () =>
      act(() => {
        const job = queued
        queued = null
        job?.fn()
      }),
  }
}

function renderPage(clock = manualClock()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <ConfirmQueuePage schedule={clock.schedule} />
    </QueryClientProvider>,
  )
  return clock
}

async function paintAndPress(key: string) {
  fireEvent.load(await screen.findByAltText(/region of the page/i))
  await waitFor(() => expect(screen.getByRole('button', { name: /confirm as read/i })).toBeEnabled())
  fireEvent.keyDown(window, { key })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ConfirmQueuePage', () => {
  it('holds a decision for the undo window, then sends it', async () => {
    const calls = mockApi()
    const clock = renderPage()
    expect(await screen.findByText('1 of 2')).toBeInTheDocument()
    await paintAndPress('Enter')

    expect(await screen.findByText('Confirmed 162 mg/dL')).toBeInTheDocument()
    expect(screen.getByText('7.1')).toBeInTheDocument() // next item already showing
    expect(screen.getByText('2 of 2')).toBeInTheDocument()
    expect(clock.pendingMs()).toBe(5000)
    expect(calls).toHaveLength(0)

    clock.elapse()
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0].url).toBe('/api/confirm-queue/a/decision')
    expect(calls[0].body).toMatchObject({ action: 'confirm' })
  })

  it('undo with Z brings the item back and sends nothing', async () => {
    const calls = mockApi()
    const clock = renderPage()
    await paintAndPress('x')
    expect(await screen.findByText('Marked not a value')).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'z' })

    expect(await screen.findByText('162')).toBeInTheDocument()
    expect(screen.getByText('1 of 2')).toBeInTheDocument()
    expect(clock.pendingMs()).toBeNull() // the window was cancelled
    clock.elapse()
    expect(calls).toHaveLength(0)
  })

  it('a second decision sends the first one straight away', async () => {
    const calls = mockApi()
    renderPage()
    await paintAndPress('Enter')
    await paintAndPress('x')
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0].url).toContain('/a/')
  })

  it('says so when someone else settled the item first', async () => {
    mockApi(409)
    const clock = renderPage()
    await paintAndPress('Enter')
    clock.elapse()
    expect(await screen.findByText(/someone else settled/i)).toBeInTheDocument()
  })

  it('puts the item back when a decision fails to save', async () => {
    mockApi(500)
    const clock = renderPage()
    await paintAndPress('Enter')
    clock.elapse()
    expect(await screen.findByText(/was not saved/i)).toBeInTheDocument()
    expect(await screen.findByText('162')).toBeInTheDocument()
  })

  it('shows the empty state when nothing is waiting', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ items: [], open_count: 0 })))
    renderPage()
    expect(await screen.findByText('Nothing is waiting')).toBeInTheDocument()
  })
})
