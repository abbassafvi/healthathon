import { describe, expect, it } from 'vitest'

import type { EntriesPage, GlucoseEntry, TickEntry, AnswerEntry } from '../../api/client'
import { api, installMockServer } from '../../test/msw'
import { mockState, resetMockState } from '../state'

installMockServer()

const NOW = new Date('2026-10-21T09:00:00')
const get = async (path: string) => {
  const res = await api(path)
  return { status: res.status, body: (await res.json()) as EntriesPage }
}
// The handler defaults to the real clock; pass the range explicitly.
const RANGE = '?from=2026-09-24&to=2026-10-21'

describe('entries mock', () => {
  it('returns four weeks of entries in time order, all inside the range', async () => {
    const { body } = await get(`/api/patients/p-1/entries${RANGE}`)
    expect(body.entries.length).toBeGreaterThan(60)
    const times = body.entries.map((e) => e.occurred_at)
    expect(times).toEqual([...times].sort())
    for (const e of body.entries) {
      expect(e.occurred_at.slice(0, 10) >= '2026-09-24' && e.occurred_at.slice(0, 10) <= '2026-10-21').toBe(true)
    }
  })

  it('never stores a glucose reading without its context', async () => {
    const { body } = await get(`/api/patients/p-1/entries${RANGE}`)
    const readings = body.entries.filter((e): e is GlucoseEntry => e.kind === 'glucose_reading')
    expect(readings.length).toBeGreaterThan(10)
    for (const g of readings) {
      expect(['fasting', 'before_meal', 'after_meal', 'bedtime', 'overnight', 'random']).toContain(g.context)
      expect(g.value_text).toMatch(/^\d+$/)
    }
  })

  it('records ticks only from activation, with real gaps and unticked days', async () => {
    const { body } = await get(`/api/patients/p-1/entries${RANGE}`)
    const ticks = body.entries.filter((e): e is TickEntry => e.kind === 'medication_tick')
    const activated = mockState().regimens.find((r) => r.id === 'rx-0001-a')!.activated_at!.slice(0, 10)
    expect(ticks.every((t) => t.tick_date >= activated)).toBe(true)
    expect(ticks.some((t) => !t.ticked)).toBe(true)
    const days = new Set(ticks.map((t) => t.tick_date)).size
    const expected = days * 3
    expect(ticks.length).toBeLessThan(expected) // some item-days have no entry at all
    expect(body.regimen_items.map((i) => i.drug_text)).toEqual(['Tab. Metformin', 'Tab. Glimepiride', 'Tab. Atorvastatin'])
  })

  it('keeps answers as given, in the language shown, with the English question', async () => {
    const { body } = await get(`/api/patients/p-1/entries${RANGE}`)
    const answers = body.entries.filter((e): e is AnswerEntry => e.kind === 'survey_answer')
    expect(answers.length).toBeGreaterThan(10)
    const daily = answers.find((a) => a.set === 'daily')!
    expect(daily.question_text).toBe('Did you feel unwell today?')
    expect(daily.question_text_shown).toBe('क्या आज आपकी तबीयत ठीक नहीं थी?')
    expect(daily.language).toBe('hi')
    expect(answers.some((a) => a.set === 'survey')).toBe(true)
  })

  it('marks who entered each entry and through which route', async () => {
    const one = (await get(`/api/patients/p-1/entries${RANGE}`)).body.entries
    expect(one.some((e) => e.entered_by === 'caregiver' && e.caregiver_name === 'Priya Verma (daughter)')).toBe(true)
    expect(one.some((e) => e.channel === 'paper_form' && e.entered_by === 'clinic_staff')).toBe(true)
    expect(one.filter((e) => e.entered_by !== 'caregiver').every((e) => e.caregiver_name === null)).toBe(true)
    const two = (await get(`/api/patients/p-2/entries${RANGE}`)).body
    expect(two.entries.some((e) => e.channel === 'sms')).toBe(true)
    expect(two.entries.some((e) => e.kind === 'medication_tick')).toBe(false) // no active checklist
  })

  it('only ever receives meal photographs through the app', async () => {
    for (const p of ['p-1', 'p-2', 'p-3']) {
      const { body } = await get(`/api/patients/${p}/entries${RANGE}`)
      const meals = body.entries.filter((e) => e.kind === 'meal_photo')
      expect(meals.length).toBeGreaterThan(0)
      expect(meals.every((m) => m.channel === 'patient_app' && m.entered_by !== 'clinic_staff')).toBe(true)
    }
  })

  it('returns nothing for a patient who has recorded nothing', async () => {
    const { body } = await get(`/api/patients/p-4/entries${RANGE}`)
    expect(body.entries).toEqual([])
    expect(body.regimen_items).toEqual([])
  })

  it('narrows to a requested range and rejects a bad one', async () => {
    const { body } = await get('/api/patients/p-1/entries?from=2026-10-20&to=2026-10-20')
    expect(body.entries.every((e) => e.occurred_at.startsWith('2026-10-20'))).toBe(true)
    expect((await api('/api/patients/p-1/entries?from=2026-10-21&to=2026-10-01')).status).toBe(422)
    expect((await api('/api/patients/p-1/entries?from=yesterday&to=2026-10-01')).status).toBe(422)
    expect((await api('/api/patients/zzz/entries')).status).toBe(404)
  })

  it('generates the same entries every time', () => {
    resetMockState(NOW)
    const a = JSON.stringify(mockState().entries)
    resetMockState(NOW)
    expect(JSON.stringify(mockState().entries)).toBe(a)
  })

  it('serves meal photographs as drawn images with no estimate', async () => {
    const { body } = await get(`/api/patients/p-1/entries${RANGE}`)
    const meal = body.entries.find((e) => e.kind === 'meal_photo')!
    const svg = await (await api((meal as { photo_url: string }).photo_url)).text()
    expect(svg).toContain('Fictional meal photograph')
    expect(svg).not.toMatch(/calorie|kcal|carb|portion|protein/i)
  })
})
