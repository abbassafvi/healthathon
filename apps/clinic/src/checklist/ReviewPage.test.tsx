import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { describe, expect, it } from 'vitest'

import { controlImages } from '../test/images'
import { installMockServer } from '../test/msw'
import { ReviewPage } from './ReviewPage'

installMockServer()

function setup(regimen = 'rx-0001-b') {
  controlImages()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/patients/p-1/checklist/review/${regimen}`]}>
        <Routes>
          <Route path="/patients/:patientId/checklist/review/:regimenId" element={<ReviewPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return userEvent.setup()
}

const rows = () => screen.getAllByRole('listitem')
const row = (n: number) => rows()[n - 1]
const crops = async () => screen.findAllByAltText(/is written on the prescription/)
const paintAll = async () => (await crops()).forEach((img) => fireEvent.load(img))
const confirmIn = (r: HTMLElement) => within(r).getByRole('button', { name: /^confirm/i })
const activate = () => screen.getByRole('button', { name: 'Activate checklist' })

describe('ReviewPage', () => {
  it('lists every line as printed, numbered, with activation locked', async () => {
    setup()
    expect(await screen.findByRole('heading', { name: 'Review prescription' })).toBeInTheDocument()
    expect(rows().map((r) => within(r).getByText(/^Tab\./).textContent)).toEqual([
      'Tab. Metformin', 'Tab. Glimepiride', 'Tab. Atorvastatin', 'Tab. Telmisartan',
    ])
    expect(screen.getByText('0 of 4 confirmed')).toBeInTheDocument()
    expect(screen.getByText(/replaces the checklist activated 2 Oct 2026 \(3 medicines\)/i)).toBeInTheDocument()
    expect(activate()).toBeDisabled()
  })

  it('keeps a line locked until its own crop has rendered', async () => {
    const user = setup()
    const [first, second] = await crops()
    expect(confirmIn(row(1))).toBeDisabled()
    await user.keyboard('{Enter}')
    expect(screen.getByText('0 of 4 confirmed')).toBeInTheDocument()
    fireEvent.load(first)
    await waitFor(() => expect(confirmIn(row(1))).toBeEnabled())
    expect(confirmIn(row(2))).toBeDisabled()
    fireEvent.load(second)
    await waitFor(() => expect(confirmIn(row(2))).toBeEnabled())
  })

  it('Enter confirms the focused line and moves to the next', async () => {
    const user = setup()
    await paintAll()
    await waitFor(() => expect(confirmIn(row(1))).toBeEnabled())
    expect(row(1)).toHaveAttribute('aria-current', 'true')
    await user.keyboard('{Enter}')
    expect(await within(row(1)).findByText(/^Confirmed by Dr\. Demo Clinician/)).toBeInTheDocument()
    await waitFor(() => expect(row(2)).toHaveAttribute('aria-current', 'true'))
    expect(screen.getByText('1 of 4 confirmed')).toBeInTheDocument()
  })

  it('shows Correct and Not a medicine only on the line in focus', async () => {
    const user = setup()
    await paintAll()
    await waitFor(() => expect(confirmIn(row(1))).toBeEnabled())
    expect(within(row(1)).getByRole('button', { name: /^Correct/ })).toBeInTheDocument()
    expect(within(row(2)).queryByRole('button', { name: /^Correct/ })).not.toBeInTheDocument()
    expect(within(row(2)).getByRole('button', { name: /^Confirm/ })).toBeInTheDocument()
    await user.keyboard('j')
    expect(within(row(2)).getByRole('button', { name: /^Correct/ })).toBeInTheDocument()
    expect(within(row(1)).queryByRole('button', { name: /^Correct/ })).not.toBeInTheDocument()
  })

  it('keeps heading levels in order', async () => {
    setup()
    await screen.findAllByRole('listitem')
    const levels = [...document.querySelectorAll('h1, h2, h3, h4')].map((h) => Number(h.tagName[1]))
    levels.forEach((l, i) => i > 0 && expect(l - levels[i - 1]).toBeLessThanOrEqual(1))
  })

  it('J and K move between lines', async () => {
    const user = setup()
    await paintAll()
    await user.keyboard('jj')
    expect(row(3)).toHaveAttribute('aria-current', 'true')
    await user.keyboard('k')
    expect(row(2)).toHaveAttribute('aria-current', 'true')
    await user.keyboard('kkkk')
    expect(row(1)).toHaveAttribute('aria-current', 'true')
  })

  it('C opens an empty correction form and saving confirms the typed text', async () => {
    const user = setup()
    await paintAll()
    await waitFor(() => expect(confirmIn(row(1))).toBeEnabled())
    await user.keyboard('c')
    const drug = screen.getByLabelText('Medicine as written')
    expect(drug).toHaveFocus()
    expect(drug).toHaveValue('')
    await user.type(drug, 'Tab. Metformin SR')
    await user.type(screen.getByLabelText('Dose as written'), '1000 mg{Enter}')
    expect(await within(row(1)).findByText('Tab. Metformin SR')).toBeInTheDocument()
    expect(within(row(1)).getByText(/^Confirmed by/)).toBeInTheDocument()
  })

  it('X removes a line that is not a medicine', async () => {
    const user = setup()
    await paintAll()
    await waitFor(() => expect(confirmIn(row(1))).toBeEnabled())
    await user.keyboard('x')
    await waitFor(() => expect(rows()).toHaveLength(3))
    expect(screen.queryByText('Tab. Metformin')).not.toBeInTheDocument()
  })

  it('activates once every line is confirmed', async () => {
    const user = setup()
    await paintAll()
    for (let n = 1; n <= 4; n++) {
      await waitFor(() => expect(confirmIn(row(n))).toBeEnabled())
      await user.click(confirmIn(row(n)))
      await within(row(n)).findByText(/^Confirmed by/)
    }
    await waitFor(() => expect(activate()).toBeEnabled())
    await user.click(activate())
    expect(await screen.findByText(/^Checklist active since/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^confirm/i })).not.toBeInTheDocument()
  })

  it('says a first checklist is a first checklist', async () => {
    setup('rx-0002-a')
    expect(await screen.findByText('This will be the first checklist for Imran Qureshi.')).toBeInTheDocument()
  })
})
