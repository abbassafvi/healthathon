import { describe, expect, it } from 'vitest'

import type { EntriesPage, PaperFormSubmission } from '../../api/client'
import { api, installMockServer } from '../../test/msw'

installMockServer()

const post = (body: unknown) => api('/api/patients/p-1/paper-form', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } })

const form = (over: Partial<PaperFormSubmission> = {}): PaperFormSubmission => ({
  client_capture_id: 'cap-1', week_from: '2026-10-13', week_to: '2026-10-19', language: 'hi',
  ticks: [], glucose: [], answers: [], ...over,
})

async function freeCell(): Promise<{ item: string; date: string }> {
  const page: EntriesPage = await (await api('/api/patients/p-1/entries?from=2026-10-13&to=2026-10-19')).json()
  for (const item of page.regimen_items) {
    for (let d = 13; d <= 19; d++) {
      const date = `2026-10-${d}`
      if (!page.entries.some((e) => e.kind === 'medication_tick' && e.regimen_item.id === item.id && e.tick_date === date)) return { item: item.id, date }
    }
  }
  throw new Error('no free cell in fixtures')
}

describe('paper form mock', () => {
  it('stores entries as written, marked paper form and clinic staff', async () => {
    const cell = await freeCell()
    const res = await post(form({
      ticks: [{ regimen_item_id: cell.item, date: cell.date, ticked: false }],
      glucose: [{ date: '2026-10-14', time: '07:15', value_text: ' 142 ', context: 'fasting', insulin_units: null }],
      answers: [{ date: '2026-10-14', question_key: 'felt_unwell_today', answer_text: 'नहीं' }],
    }))
    expect(await res.json()).toEqual({ created: 3, duplicate: false })
    const page: EntriesPage = await (await api('/api/patients/p-1/entries?from=2026-10-13&to=2026-10-19')).json()
    const mine = page.entries.filter((e) => e.id.startsWith('pf-cap-1'))
    expect(mine).toHaveLength(3)
    expect(mine.every((e) => e.channel === 'paper_form' && e.entered_by === 'clinic_staff')).toBe(true)
    expect(mine.find((e) => e.kind === 'glucose_reading')).toMatchObject({ value_text: '142', occurred_at: '2026-10-14T07:15:00' })
    expect(mine.find((e) => e.kind === 'survey_answer')).toMatchObject({ answer_text: 'नहीं', language: 'hi' })
  })

  it('saves a form only once per capture id', async () => {
    const glucose = [{ date: '2026-10-14', time: null, value_text: '150', context: 'random' as const, insulin_units: null }]
    expect(await (await post(form({ glucose }))).json()).toEqual({ created: 1, duplicate: false })
    expect(await (await post(form({ glucose }))).json()).toEqual({ created: 1, duplicate: true })
    const page: EntriesPage = await (await api('/api/patients/p-1/entries?from=2026-10-14&to=2026-10-14')).json()
    expect(page.entries.filter((e) => e.id.startsWith('pf-cap-1'))).toHaveLength(1)
  })

  it('refuses a tick for a day already recorded in the app', async () => {
    const page: EntriesPage = await (await api('/api/patients/p-1/entries?from=2026-10-13&to=2026-10-19')).json()
    const taken = page.entries.find((e) => e.kind === 'medication_tick')!
    if (taken.kind !== 'medication_tick') throw new Error()
    const res = await post(form({ ticks: [{ regimen_item_id: taken.regimen_item.id, date: taken.tick_date, ticked: true }] }))
    expect(res.status).toBe(409)
  })

  it.each([
    ['a reading without context', { glucose: [{ date: '2026-10-14', time: null, value_text: '150', context: 'soon', insulin_units: null }] }],
    ['a reading that is not a number', { glucose: [{ date: '2026-10-14', time: null, value_text: 'high', context: 'random', insulin_units: null }] }],
    ['a reading outside the week', { glucose: [{ date: '2026-10-21', time: null, value_text: '150', context: 'random', insulin_units: null }] }],
    ['a bad time', { glucose: [{ date: '2026-10-14', time: '7pm', value_text: '150', context: 'random', insulin_units: null }] }],
    ['an empty answer', { answers: [{ date: '2026-10-14', question_key: 'felt_unwell_today', answer_text: '  ' }] }],
    ['an unknown question', { answers: [{ date: '2026-10-14', question_key: 'made_up', answer_text: 'yes' }] }],
    ['a medicine not on the checklist', { ticks: [{ regimen_item_id: 'nope', date: '2026-10-14', ticked: true }] }],
    ['a backwards week', { week_from: '2026-10-19', week_to: '2026-10-13' }],
  ])('rejects %s', async (_name, over) => {
    const res = await post(form(over as Partial<PaperFormSubmission>))
    expect(res.status).toBe(422)
  })

  it('accepts any number as written; no range is applied', async () => {
    const res = await post(form({ client_capture_id: 'cap-big', glucose: [{ date: '2026-10-14', time: null, value_text: '1410', context: 'random', insulin_units: null }] }))
    expect(res.status).toBe(200)
  })
})
