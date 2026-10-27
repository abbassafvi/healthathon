import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Checklist } from '../../api/client'
import type { UploadRequest, UploadStatus } from '../../api/pending'
import { api, installMockServer } from '../../test/msw'

installMockServer()

const req = (over: Partial<UploadRequest> = {}): UploadRequest => ({
  client_capture_id: 'cap-1', patient_id: 'p-4', doc_type: 'lab_report', file_name: 'a.jpg',
  sha256: 'aa', captured_at: '2026-10-21T08:00:00Z', ...over,
})
const post = async (r: UploadRequest) => {
  const res = await api('/api/uploads', { method: 'POST', body: JSON.stringify(r), headers: { 'Content-Type': 'application/json' } })
  return { status: res.status, body: (await res.json()) as UploadStatus }
}
const status = async (id: string) => (await (await api(`/api/uploads/${id}`)).json()) as UploadStatus

beforeEach(() => vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-21T09:00:00') }))
afterEach(() => vi.useRealTimers())
const later = (ms: number) => vi.setSystemTime(Date.now() + ms)

describe('upload mock', () => {
  it('goes uploading, reading, done, and says where the values went', async () => {
    const { status: code, body } = await post(req())
    expect(code).toBe(201)
    expect(body.stage).toBe('uploading')
    later(700)
    expect((await status(body.id)).stage).toBe('reading')
    later(2500)
    const done = await status(body.id)
    expect(done.stage).toBe('done')
    expect(done.outcome).toMatchObject({ values_in_record: 3, sent_to_queue: [{ reason: 'region_illegible', count: 1 }], regimen_id: null })
  })

  it('turns a prescription into a regimen waiting for review', async () => {
    const { body } = await post(req({ doc_type: 'prescription' }))
    later(4000)
    const done = await status(body.id)
    expect(done.outcome!.regimen_id).toBeTruthy()
    const checklist: Checklist = await (await api('/api/patients/p-4/checklist')).json()
    expect(checklist.awaiting_review.map((a) => a.regimen_id)).toContain(done.outcome!.regimen_id)
    expect((await api(`/api/regimens/${done.outcome!.regimen_id}/review`)).status).toBe(200)
  })

  it('returns the same upload for a retried capture', async () => {
    const a = await post(req())
    const b = await post(req())
    expect(b.body.id).toBe(a.body.id)
  })

  it('recognises a photograph already in the record, once it has been read', async () => {
    const a = await post(req({ client_capture_id: 'c1' }))
    expect((await post(req({ client_capture_id: 'c2' }))).body.stage).toBe('uploading') // not read yet
    later(4000)
    await status(a.body.id)
    expect((await post(req({ client_capture_id: 'c3' }))).body.stage).toBe('duplicate')
    // The same photograph for another patient is a different document.
    expect((await post(req({ client_capture_id: 'c4', patient_id: 'p-3' }))).body.stage).toBe('uploading')
  })

  it('fails an unreadable photograph without marking it as in the record', async () => {
    const a = await post(req({ client_capture_id: 'u1', file_name: 'unreadable.jpg', sha256: 'bb' }))
    later(4000)
    const s = await status(a.body.id)
    expect(s.stage).toBe('failed')
    expect(s.failure).toMatch(/could not be found/)
    expect((await post(req({ client_capture_id: 'u2', file_name: 'retake.jpg', sha256: 'bb' }))).body.stage).toBe('uploading')
  })

  it('rejects an upload without its keys, and an unknown patient', async () => {
    expect((await post(req({ sha256: '' }))).status).toBe(422)
    expect((await post(req({ client_capture_id: '' }))).status).toBe(422)
    expect((await post(req({ patient_id: 'nobody' }))).status).toBe(404)
  })
})
