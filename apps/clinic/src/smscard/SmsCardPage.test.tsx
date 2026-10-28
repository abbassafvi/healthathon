import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { patientListItem } from '../test/fixtures'
import { installMockServer } from '../test/msw'
import { SmsCardPage } from './SmsCardPage'

const server = installMockServer()

const asha = patientListItem({ id: 'p-1', registration_no: 'DEV-0001', full_name: 'Asha Verma', preferred_language: 'hi' }, { sms_phone_last4: '0001' })
const rakesh = patientListItem({ id: 'p-4', registration_no: 'DEV-0004', full_name: 'Rakesh Yadav', preferred_language: 'en' })

function setup(patient = 'p-1', patients = [asha, { ...rakesh, sms_phone_last4: '0004' }]) {
  server.use(http.get('*/api/patients', () => HttpResponse.json(patients)))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/patients/${patient}/sms-card`]}>
        <Routes>
          <Route path="/patients/:patientId/sms-card" element={<SmsCardPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return userEvent.setup()
}

const card = () => screen.findByTestId('sms-card')

afterEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
})

describe('SmsCardPage', () => {
  it('opens in the language the patient reads, and says a Hindi card is a draft', async () => {
    setup()
    const c = await card()
    expect(c).toHaveAttribute('lang', 'hi')
    expect(c).toHaveAttribute('dir', 'ltr')
    expect(within(c).getByRole('heading', { level: 2 })).toHaveTextContent('अपनी डायरी SMS से भेजिए')
    expect(screen.getByRole('note')).toHaveTextContent('This Hindi card is a draft until a speaker reviews it.')
    expect(screen.getByRole('radio', { name: 'हिन्दी' })).toBeChecked()
  })

  it('numbers the medicines in checklist order, the order SMS counts them in', async () => {
    const user = setup()
    await user.click(await screen.findByRole('radio', { name: 'English' }))
    const c = await card()
    const meds = within(c).getByRole('list', { name: 'A medicine' })
    expect(within(meds).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      '1Tab. Metformin500 mg1-0-1',
      '2Tab. Glimepiride1 mg1-0-0',
      '3Tab. Atorvastatin10 mg0-0-1',
    ])
    expect(c).toHaveTextContent('Your medicines, from your list of 2 October 2026')
    expect(c).toHaveTextContent('Send them from your phone ending in 0001.')
    expect(screen.queryByRole('note')).not.toBeInTheDocument()
  })

  it('gives an example message the SMS reader accepts, with the first two medicines', async () => {
    const user = setup()
    await user.click(await screen.findByRole('radio', { name: 'English' }))
    const lines = [...within(await card()).getByTestId('sms-example').children].map((l) => l.textContent)
    expect(lines).toEqual(['G 142 F', 'T 1 Y', 'T 2 Y', 'Q walked after dinner'])
  })

  it('labels the one number on the card as an example, so it cannot read as a target', async () => {
    const user = setup()
    await user.click(await screen.findByRole('radio', { name: 'English' }))
    expect(await card()).toHaveTextContent('142 is only an example. Send the number your meter shows.')
  })

  it('lays an Urdu card right to left, and keeps the codes and medicines left to right', async () => {
    const user = setup()
    await user.click(await screen.findByRole('radio', { name: 'اردو' }))
    const c = await card()
    expect(c).toHaveAttribute('dir', 'rtl')
    expect(c).toHaveAttribute('lang', 'ur')
    expect(within(c).getByTestId('sms-example')).toHaveAttribute('dir', 'ltr')
    expect(within(c).getByText('Tab. Metformin').parentElement).toHaveAttribute('dir', 'ltr')
    expect(screen.getByRole('note')).toHaveTextContent('This Urdu card is a draft')
  })

  it('says a patient with no medicines yet has none to number', async () => {
    const user = setup('p-4')
    await user.click(await screen.findByRole('radio', { name: 'English' }))
    const c = await card()
    expect(c).toHaveTextContent('There are no medicines on your list yet.')
    expect([...within(c).getByTestId('sms-example').children].map((l) => l.textContent)).toEqual(['G 142 F', 'Q walked after dinner'])
  })

  it('makes no card for a patient SMS would refuse, and says why', async () => {
    setup('p-4', [asha, rakesh])
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Rakesh Yadav has not agreed to SMS, or has no phone on record, so messages from them are refused.',
    )
    expect(screen.queryByTestId('sms-card')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Print' })).not.toBeInTheDocument()
  })

  it('will not print without the number patients send to, and says what to type', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => {})
    const user = setup()
    await user.click(await screen.findByRole('button', { name: 'Print' }))
    expect(print).not.toHaveBeenCalled()
    const field = screen.getByLabelText('Clinic SMS number')
    expect(field).toHaveFocus()
    expect(field).toHaveAttribute('aria-invalid', 'true')
    expect(field).toHaveAccessibleDescription('Type the number patients send to, in digits. It prints on the card.')
    await user.type(field, 'call us')
    await user.click(screen.getByRole('button', { name: 'Print' }))
    expect(print).not.toHaveBeenCalled()
  })

  it('prints the clinic number on the card, and remembers it on this computer', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => {})
    const user = setup()
    await user.type(await screen.findByLabelText('Clinic SMS number'), '+91 55500 00099')
    expect(within(await card()).getByTestId('sms-number')).toHaveTextContent('+91 55500 00099')
    await user.click(screen.getByRole('button', { name: 'Print' }))
    expect(print).toHaveBeenCalledOnce()
    expect(localStorage.getItem('smsCard.clinicNumber')).toBe('+91 55500 00099')
  })

  it('opens with the number this computer remembers', async () => {
    localStorage.setItem('smsCard.clinicNumber', '55500 00099')
    setup()
    expect(await screen.findByLabelText('Clinic SMS number')).toHaveValue('55500 00099')
    expect(within(await card()).getByTestId('sms-number')).toHaveTextContent('55500 00099')
  })

  it('marks a draft translation on the paper itself, and not a reviewed one', async () => {
    const user = setup()
    expect(await card()).toHaveTextContent('Draft translation, not reviewed by a speaker. Not for patients.')
    await user.click(screen.getByRole('radio', { name: 'English' }))
    expect(await card()).not.toHaveTextContent('Draft translation')
  })

  it('says so when the card cannot be made, and tries again', async () => {
    let fail = true
    server.use(http.get('*/api/patients/p-1/checklist', () => (fail ? HttpResponse.json({}, { status: 503 }) : undefined)))
    const user = setup()
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('The card could not be made.')
    fail = false
    await user.click(within(alert).getByRole('button', { name: 'Try again' }))
    expect(await card()).toBeInTheDocument()
  })
})
