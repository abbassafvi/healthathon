import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { installMockServer, TEST_PATIENTS } from '../test/msw'
import { UploadPage } from './UploadPage'

const server = installMockServer()

function setup() {
  server.use(http.get('*/api/patients', () => HttpResponse.json(TEST_PATIENTS)))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <UploadPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return userEvent.setup({ applyAccept: false })
}

const photo = (name: string, body = name) => new File([body], name, { type: 'image/jpeg', lastModified: 1_760_000_000_000 })
const submitButton = () => screen.getByRole('button', { name: /^Upload and read/ })

beforeEach(() => {
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:preview', revokeObjectURL: () => {} }))
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-21T09:00:00') })
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

async function choose(user: ReturnType<typeof userEvent.setup>, patient = 'Asha Verma (DEV-0001)', type = 'Laboratory report') {
  await user.selectOptions(await screen.findByLabelText('Patient'), await screen.findByRole('option', { name: patient }))
  await user.click(screen.getByText(type, { exact: true }))
}

describe('UploadPage', () => {
  it('says plainly that only fictional documents may be uploaded', () => {
    setup()
    expect(screen.getByText('Prototype: upload fictional documents only. No real patient data, at any stage.')).toBeInTheDocument()
  })

  it('needs a patient, a type and a photograph before it uploads', async () => {
    const user = setup()
    expect(submitButton()).toBeDisabled()
    await choose(user)
    expect(submitButton()).toBeDisabled()
    await user.upload(screen.getByTestId('file-input'), [photo('a.jpg'), photo('b.jpg')])
    expect(submitButton()).toBeEnabled()
    expect(submitButton()).toHaveTextContent('Upload and read 2 photographs')
  })

  it('refuses a file that is not a photograph, and lets a picked photograph be removed', async () => {
    const user = setup()
    await user.upload(screen.getByTestId('file-input'), [photo('a.jpg'), new File(['x'], 'notes.pdf', { type: 'application/pdf' })])
    expect(screen.getByRole('alert')).toHaveTextContent('notes.pdf is not a photograph, so it was not added.')
    expect(screen.getByRole('img', { name: 'a.jpg' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Remove a.jpg' }))
    expect(screen.queryByRole('img', { name: 'a.jpg' })).not.toBeInTheDocument()
  })

  it('reads a lab report and says where its values went', async () => {
    const user = setup()
    await choose(user)
    await user.upload(screen.getByTestId('file-input'), [photo('lab.jpg')])
    await user.click(submitButton())
    const session = screen.getByRole('region', { name: 'Uploaded in this session' })
    const row = await within(session).findByText('lab.jpg')
    expect(row.closest('li')).toHaveAttribute('data-upload-stage', 'uploading')
    vi.setSystemTime(new Date('2026-10-21T09:00:10'))
    await waitFor(() => expect(within(session).getByText('3 values are in the record.')).toBeInTheDocument(), { timeout: 4000 })
    expect(within(session).getByText('1 sent to the confirm queue: This part of the image is hard to read.')).toBeInTheDocument()
    expect(within(session).getByRole('link', { name: 'Open the record' })).toHaveAttribute('href', '/patients/p-1/documents')
  })

  it('turns a prescription into a review link', async () => {
    const user = setup()
    await choose(user, 'Rakesh Yadav (DEV-0004)', 'Prescription')
    await user.upload(screen.getByTestId('file-input'), [photo('rx.jpg')])
    await user.click(submitButton())
    vi.setSystemTime(new Date('2026-10-21T09:00:10'))
    const link = await screen.findByRole('link', { name: 'Review prescription' }, { timeout: 4000 })
    expect(link.getAttribute('href')).toMatch(/^\/patients\/p-4\/checklist\/review\/rx-up-/)
  })

  it('keeps the photographs and says so when an upload does not start', async () => {
    const user = setup()
    server.use(http.post('*/api/uploads', () => HttpResponse.json({ detail: 'down' }, { status: 503 })))
    await choose(user)
    await user.upload(screen.getByTestId('file-input'), [photo('lab.jpg')])
    await user.click(submitButton())
    expect(await screen.findByRole('alert')).toHaveTextContent('The upload did not start.')
    expect(screen.getByRole('img', { name: 'lab.jpg' })).toBeInTheDocument()
  })

  it('recognises the same photograph uploaded twice for the same patient', async () => {
    const user = setup()
    await choose(user)
    await user.upload(screen.getByTestId('file-input'), [photo('same.jpg', 'identical bytes')])
    await user.click(submitButton())
    vi.setSystemTime(new Date('2026-10-21T09:00:10'))
    await screen.findByText('3 values are in the record.', {}, { timeout: 4000 })
    await user.upload(screen.getByTestId('file-input'), [photo('same-again.jpg', 'identical bytes')])
    await user.click(submitButton())
    expect(await screen.findByText('This photograph is already in this record. Nothing new was added.')).toBeInTheDocument()
  })
})
