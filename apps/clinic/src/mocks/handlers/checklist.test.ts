import { describe, expect, it } from 'vitest'

import type { Checklist, RegimenReview } from '../../api/client'
import { api, installMockServer } from '../../test/msw'

installMockServer()

const json = async <T>(path: string, init?: RequestInit) => {
  const res = await api(path, init)
  return { status: res.status, body: res.status === 204 ? null : ((await res.json()) as T) }
}
const post = (body: unknown) => ({ method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } })

describe('checklist mock', () => {
  it('returns the active checklist and the prescription waiting for review', async () => {
    const { body } = await json<Checklist>('/api/patients/p-1/checklist')
    expect(body!.active!.items.map((i) => i.drug_text)).toEqual(['Tab. Metformin', 'Tab. Glimepiride', 'Tab. Atorvastatin'])
    expect(body!.awaiting_review).toHaveLength(1)
    expect(body!.awaiting_review[0]).toMatchObject({ regimen_id: 'rx-0001-b', item_count: 4, confirmed_count: 0 })
  })

  it('returns no active checklist for a patient without one', async () => {
    const { body } = await json<Checklist>('/api/patients/p-4/checklist')
    expect(body).toEqual({ active: null, awaiting_review: [] })
  })

  it('404s for an unknown patient or prescription', async () => {
    expect((await api('/api/patients/zzz/checklist')).status).toBe(404)
    expect((await api('/api/regimens/zzz/review')).status).toBe(404)
  })

  it('says what activation would replace', async () => {
    const { body } = await json<RegimenReview>('/api/regimens/rx-0001-b/review')
    expect(body!.replaces).toEqual({ activated_at: '2026-10-02T10:05:00', item_count: 3 })
    const first = await json<RegimenReview>('/api/regimens/rx-0002-a/review')
    expect(first.body!.replaces).toBeNull()
  })

  it('refuses a confirmation without decision latency', async () => {
    expect((await api('/api/regimen-items/rx-0001-b-item-1/confirm', post({}))).status).toBe(422)
    expect((await api('/api/regimen-items/rx-0001-b-item-1/confirm', post({ decision_latency_ms: -1 }))).status).toBe(422)
  })

  it('applies a correction, trimmed, and refuses an empty one', async () => {
    const bad = await api('/api/regimen-items/rx-0001-b-item-1/confirm', post({ decision_latency_ms: 900, drug_text: '  ' }))
    expect(bad.status).toBe(422)
    const { body } = await json<{ drug_text: string; confirmed_by_name: string }>(
      '/api/regimen-items/rx-0001-b-item-1/confirm',
      post({ decision_latency_ms: 900, drug_text: ' Tab. Metformin SR ', dose_text: '1000 mg', schedule_text: '' }),
    )
    expect(body).toMatchObject({ drug_text: 'Tab. Metformin SR', dose_text: '1000 mg', schedule_text: null, confirmed_by_name: 'Dr. Demo Clinician' })
  })

  it('will not activate until every medicine is confirmed, then supersedes the old checklist', async () => {
    expect((await api('/api/regimens/rx-0001-b/activate', post({}))).status).toBe(409)
    for (const n of [1, 2, 3, 4]) {
      expect((await api(`/api/regimen-items/rx-0001-b-item-${n}/confirm`, post({ decision_latency_ms: 800 }))).status).toBe(200)
    }
    expect((await api('/api/regimens/rx-0001-b/activate', post({}))).status).toBe(200)
    const { body } = await json<Checklist>('/api/patients/p-1/checklist')
    expect(body!.active!.id).toBe('rx-0001-b')
    expect(body!.active!.items).toHaveLength(4)
    expect(body!.awaiting_review).toEqual([])
    // An active checklist cannot be changed or activated again.
    expect((await api('/api/regimens/rx-0001-b/activate', post({}))).status).toBe(409)
    expect((await api('/api/regimen-items/rx-0001-b-item-1/confirm', post({ decision_latency_ms: 1 }))).status).toBe(409)
    expect((await api('/api/regimen-items/rx-0001-b-item-1', { method: 'DELETE' })).status).toBe(409)
  })

  it('removes a line that is not a medicine, and needs at least one to activate', async () => {
    for (const n of [1, 2]) {
      expect((await api(`/api/regimen-items/rx-0002-a-item-${n}`, { method: 'DELETE' })).status).toBe(204)
    }
    expect((await api('/api/regimens/rx-0002-a/activate', post({}))).status).toBe(409)
  })

  it('serves the page and crops as SVG', async () => {
    const { body } = await json<RegimenReview>('/api/regimens/rx-0001-b/review')
    const page = await api(body!.page.url)
    expect(page.headers.get('content-type')).toBe('image/svg+xml')
    const svg = await page.text()
    expect(svg).toContain('viewBox="0 0 1240 1754"')
    expect(svg).toContain('Tab. Telmisartan 40 mg')
    const crop = await (await api(body!.items[0].crop_url)).text()
    expect(crop).toMatch(/viewBox="[\d.]+ [\d.]+ [\d.]+ [\d.]+"/)
    expect(crop).not.toContain('viewBox="0 0 1240 1754"')
  })

  it('draws every box around its own line', async () => {
    const { body } = await json<RegimenReview>('/api/regimens/rx-0001-b/review')
    const ys = body!.items.map((i) => i.box.y)
    expect([...ys].sort((a, b) => a - b)).toEqual(ys) // top to bottom
    for (let i = 1; i < ys.length; i++) {
      expect(ys[i]).toBeGreaterThan(ys[i - 1] + body!.items[i - 1].box.h) // no overlap
    }
    for (const it of body!.items) {
      expect(it.box.x + it.box.w).toBeLessThanOrEqual(1)
      expect(it.box.y + it.box.h).toBeLessThanOrEqual(1)
    }
  })
})
