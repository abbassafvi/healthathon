import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { installMockServer, TEST_PATIENTS } from '../test/msw'
import { UploadPage } from './UploadPage'
import { programUploads, resetUploadFixture, rxOutcome, uploadFixture } from './uploadFixture'

const server = installMockServer()

function setup() {
  server.use(http.get('*/api/patients', () => HttpResponse.json(TEST_PATIENTS)), ...uploadFixture)
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
  resetUploadFixture()
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
    // Either in-progress stage: the first poll can land before this runs.
    expect(row.closest('li')).toHaveAttribute('data-upload-stage', expect.stringMatching(/^(uploading|reading)$/))
    await waitFor(() => expect(within(session).getByText('3 values are in the record.')).toBeInTheDocument(), { timeout: 4000 })
    expect(within(session).getByText('1 sent to the confirm queue: This part of the image is hard to read.')).toBeInTheDocument()
    expect(within(session).getByRole('link', { name: 'Open the record' })).toHaveAttribute('href', '/patients/p-1/documents')
  })

  it('turns a prescription into a review link', async () => {
    const user = setup()
    programUploads([{ outcome: rxOutcome('rx-7') }])
    await choose(user, 'Rakesh Yadav (DEV-0004)', 'Prescription')
    await user.upload(screen.getByTestId('file-input'), [photo('rx.jpg')])
    await user.click(submitButton())
    const link = await screen.findByRole('link', { name: 'Review prescription' }, { timeout: 4000 })
    expect(link.getAttribute('href')).toBe('/patients/p-4/checklist/review/rx-7')
  })

  it('keeps a paper survey with the record without reading it', async () => {
    const user = setup()
    programUploads([{ outcome: { ...rxOutcome(null, 0, 0), document_id: 'doc-sf' } }])
    await choose(user, 'Asha Verma (DEV-0001)', 'Paper survey')
    expect(screen.getByText('Kept with the record as a photograph. Nothing on it is read.')).toBeInTheDocument()
    await user.upload(screen.getByTestId('file-input'), [photo('survey.jpg')])
    const submit = screen.getByRole('button', { name: 'Upload' })
    await user.click(submit)
    const session = screen.getByRole('region', { name: 'Uploaded in this session' })
    expect(await within(session).findByText('Kept with the record.', {}, { timeout: 4000 })).toBeInTheDocument()
    expect(within(session).getByText('Asha Verma, Paper survey')).toBeInTheDocument()
    expect(within(session).queryByText('Reading')).toBeNull()
    expect(within(session).getByRole('link', { name: 'See it on the Documents tab' })).toHaveAttribute('href', '/patients/p-1/documents')
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
    programUploads([{}, { stage: 'duplicate' }])
    await choose(user)
    await user.upload(screen.getByTestId('file-input'), [photo('same.jpg', 'identical bytes')])
    await user.click(submitButton())
    await screen.findByText('3 values are in the record.', {}, { timeout: 4000 })
    await user.upload(screen.getByTestId('file-input'), [photo('same-again.jpg', 'identical bytes')])
    await user.click(submitButton())
    expect(await screen.findByText('This photograph is already in this record. Nothing new was added.')).toBeInTheDocument()
  })
})

describe('what the upload is still waiting for', () => {
  it('names what is missing, so a disabled button is never silent', async () => {
    const user = setup()
    // Nothing chosen yet.
    expect(await screen.findByText('Still needed: a patient, a document type and a photograph.')).toBeInTheDocument()

    await user.selectOptions(await screen.findByLabelText('Patient'), await screen.findByRole('option', { name: 'Asha Verma (DEV-0001)' }))
    expect(screen.getByText('Still needed: a document type and a photograph.')).toBeInTheDocument()

    await user.click(screen.getByText('Laboratory report', { exact: true }))
    expect(screen.getByText('Still needed: a photograph.')).toBeInTheDocument()

    await user.upload(screen.getByTestId('file-input'), [photo('lab.jpg')])
    expect(screen.queryByText(/^Still needed/)).not.toBeInTheDocument()
    expect(submitButton()).toBeEnabled()
  })

  it('a photograph picked with no patient still says what is missing', async () => {
    const user = setup()
    await user.upload(screen.getByTestId('file-input'), [photo('rx.jpg')])
    expect(submitButton()).toBeDisabled()
    expect(screen.getByText('Still needed: a patient and a document type.')).toBeInTheDocument()
  })
})
