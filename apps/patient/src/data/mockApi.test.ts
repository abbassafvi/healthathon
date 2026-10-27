import { createMockApi, localDay } from './mockApi'

const NOW = new Date('2026-10-26T09:00:00') // a Monday

describe('patient mock API', () => {
  it('shows the checklist as printed and nothing recorded yet', async () => {
    const api = createMockApi(() => NOW)
    const t = await api.today('DEV-0001')
    expect(t.date).toBe('2026-10-26')
    expect(t.items.map((i) => `${i.drug_text} ${i.dose_text} ${i.schedule_text}`)).toEqual([
      'Tab. Metformin 500 mg 1-0-1', 'Tab. Glimepiride 1 mg 1-0-0', 'Tab. Atorvastatin 10 mg 0-0-1',
    ])
    expect(t.ticks).toEqual({})
    expect(t.readings).toEqual([])
  })

  it('has no checklist for a patient without one', async () => {
    expect((await createMockApi(() => NOW).today('DEV-0002')).items).toEqual([])
  })

  it('ticks and unticks, once per capture id', async () => {
    const api = createMockApi(() => NOW)
    await api.setTick('DEV-0001', 'rx-0001-a-item-1', true, 'c1')
    expect((await api.today('DEV-0001')).ticks).toEqual({ 'rx-0001-a-item-1': true })
    await api.setTick('DEV-0001', 'rx-0001-a-item-1', null, 'c1') // a retry of c1: ignored
    expect((await api.today('DEV-0001')).ticks).toEqual({ 'rx-0001-a-item-1': true })
    await api.setTick('DEV-0001', 'rx-0001-a-item-1', null, 'c2')
    expect((await api.today('DEV-0001')).ticks).toEqual({})
    await expect(api.setTick('DEV-0001', 'not-mine', true, 'c3')).rejects.toThrow('Not on this checklist')
  })

  it('stores a reading as typed, only with its context, once per capture id', async () => {
    const api = createMockApi(() => NOW)
    await api.addReading('DEV-0001', { value_text: ' 162 ', context: 'fasting' }, 'r1')
    await api.addReading('DEV-0001', { value_text: '162', context: 'fasting' }, 'r1')
    const t = await api.today('DEV-0001')
    expect(t.readings).toHaveLength(1)
    expect(t.readings[0]).toMatchObject({ value_text: '162', context: 'fasting' })
    await expect(api.addReading('DEV-0001', { value_text: 'high', context: 'fasting' }, 'r2')).rejects.toThrow()
    await expect(api.addReading('DEV-0001', { value_text: '140', context: 'soon' as never }, 'r3')).rejects.toThrow()
    // Any number is accepted: no range is applied.
    await api.addReading('DEV-0001', { value_text: '1410', context: 'random' }, 'r4')
  })

  it('keeps each day separate', async () => {
    let now = NOW
    const api = createMockApi(() => now)
    await api.setTick('DEV-0001', 'rx-0001-a-item-1', true, 'c1')
    now = new Date('2026-10-27T09:00:00')
    expect((await api.today('DEV-0001')).ticks).toEqual({})
    expect(localDay(now)).toBe('2026-10-27')
  })

  it('takes the survey once a week, and only complete', async () => {
    let now = NOW
    const api = createMockApi(() => now)
    await expect(api.submitSurvey('DEV-0001', { walk_days_week: '3' }, 's1')).rejects.toThrow()
    await api.submitSurvey('DEV-0001', { walk_days_week: '3', skipped_meal_week: 'No' }, 's2')
    expect((await api.today('DEV-0001')).survey.done).toBe(true)
    now = new Date('2026-11-01T09:00:00') // Sunday, same week
    expect((await api.today('DEV-0001')).survey.done).toBe(true)
    now = new Date('2026-11-02T09:00:00') // next Monday
    expect((await api.today('DEV-0001')).survey.done).toBe(false)
  })

  it('refuses writes without a capture id or for an unknown patient', async () => {
    const api = createMockApi(() => NOW)
    await expect(api.setTick('DEV-0001', 'rx-0001-a-item-1', true, '')).rejects.toThrow('capture id')
    await expect(api.today('NOBODY')).rejects.toThrow('No such patient')
  })
})
