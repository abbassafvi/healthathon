import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { MemoryRouter, Route, Routes } from 'react-router'
import { describe, expect, it } from 'vitest'

import { installMockServer } from '../test/msw'
import { initials } from '../lib/names'
import { AppShell } from './AppShell'
import { NotFound } from './NotFound'

const server = installMockServer()

function setup(path = '/today') {
  server.use(
    http.get('*/api/me', () => HttpResponse.json({ id: 'u-1', full_name: 'Dr. Demo Clinician', role: 'clinician' })),
    http.get('*/api/confirm-queue', () => HttpResponse.json({ items: [], open_count: 5 })),
  )
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="today" element={<main>today</main>} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('AppShell', () => {
  it('says who is signed in, by name and role', async () => {
    setup()
    expect(await screen.findByText('Signed in as Dr. Demo Clinician')).toBeInTheDocument()
    const me = screen.getByTestId('signed-in')
    expect(me).toHaveTextContent('DC')
    expect(me).toHaveTextContent('Clinician')
  })

  it('marks the demonstration as fictional on every screen', () => {
    setup()
    expect(screen.getByText('Demo: fictional patients')).toBeInTheDocument()
  })

  it('names the build and the boundary in the footer', () => {
    setup()
    const footer = screen.getByRole('contentinfo')
    expect(footer).toHaveTextContent(/Consultation Readiness \d+\.\d+\.\d+, build \w+/)
    expect(footer).toHaveTextContent('Assistive, not diagnostic.')
  })

  it('counts the confirm queue in the navigation', async () => {
    setup()
    const nav = screen.getByRole('navigation', { name: 'Main' })
    expect(await within(nav).findByText('5')).toBeInTheDocument()
  })

  it('gives an unknown address its own page, with the places that exist', () => {
    setup('/nowhere')
    expect(screen.getByRole('heading', { name: 'There is no page at this address' })).toBeInTheDocument()
    const links = within(screen.getByRole('main')).getAllByRole('link').map((l) => l.getAttribute('href'))
    expect(links).toEqual(['/today', '/queue', '/patients', '/upload', '/audit'])
    expect(document.title).toBe('There is no page at this address · Consultation Readiness')
  })
})

describe('initials', () => {
  it('leaves out titles and takes the first and last names', () => {
    expect(initials('Dr. Demo Clinician')).toBe('DC')
    expect(initials('Priya Verma')).toBe('PV')
    expect(initials('Kavita Devi Rao')).toBe('KR')
    expect(initials('Imran')).toBe('IM')
  })
})
