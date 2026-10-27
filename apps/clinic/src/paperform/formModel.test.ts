import { describe, expect, it } from 'vitest'

import { cellKey, counts, nextCell, toSubmission, validate, weekDates, type Draft } from './formModel'

const draft = (over: Partial<Draft> = {}): Draft => ({
  weekFrom: '2026-10-13', language: 'hi', cells: {}, glucose: [], answers: {}, ...over,
})

describe('paper form model', () => {
  it('lays out seven consecutive days across a month end', () => {
    expect(weekDates('2026-10-28')).toEqual(['2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03'])
  })

  it('cycles a cell blank, ticked, not ticked, blank', () => {
    expect([nextCell('blank'), nextCell('ticked'), nextCell('not_ticked')]).toEqual(['ticked', 'not_ticked', 'blank'])
  })

  it('leaves blank cells out of the submission, since blank means no entry', () => {
    const s = toSubmission(draft({ cells: { [cellKey('i1', '2026-10-13')]: 'ticked', [cellKey('i1', '2026-10-14')]: 'blank', [cellKey('i2', '2026-10-13')]: 'not_ticked' } }), 'cap-1')
    expect(s.ticks).toEqual([
      { regimen_item_id: 'i1', date: '2026-10-13', ticked: true },
      { regimen_item_id: 'i2', date: '2026-10-13', ticked: false },
    ])
    expect(s.week_from).toBe('2026-10-13')
    expect(s.week_to).toBe('2026-10-19')
    expect(s.client_capture_id).toBe('cap-1')
  })

  it('requires every reading to have a value written as a number and a context', () => {
    const d = draft({ glucose: [
      { key: 'a', date: '2026-10-13', time: '', value: '', context: '', insulin: '' },
      { key: 'b', date: '2026-10-13', time: '', value: '1 40', context: 'fasting', insulin: 'x' },
      { key: 'c', date: '2026-10-13', time: '07:10', value: '140', context: 'fasting', insulin: '' },
    ] })
    expect(validate(d).map((p) => p.field)).toEqual(['glucose-a-value', 'glucose-a-context', 'glucose-b-value', 'glucose-b-insulin'])
  })

  it('accepts any number as written: no range is applied', () => {
    for (const value of ['20', '600', '1410', '5.6']) {
      expect(validate(draft({ glucose: [{ key: 'a', date: '2026-10-13', time: '', value, context: 'random', insulin: '' }] }))).toEqual([])
    }
  })

  it('keeps answers as written, dropping empty ones', () => {
    const s = toSubmission(draft({ answers: { 'felt_unwell_today|2026-10-13': '  नहीं ', 'felt_unwell_today|2026-10-14': '  ' } }), 'c')
    expect(s.answers).toEqual([{ question_key: 'felt_unwell_today', date: '2026-10-13', answer_text: 'नहीं' }])
    expect(s.language).toBe('hi')
  })

  it('counts what will be saved', () => {
    const s = toSubmission(draft({
      cells: { [cellKey('i1', '2026-10-13')]: 'ticked', [cellKey('i1', '2026-10-14')]: 'ticked', [cellKey('i1', '2026-10-15')]: 'not_ticked' },
      glucose: [{ key: 'a', date: '2026-10-13', time: '', value: '140', context: 'fasting', insulin: '14' }],
    }), 'c')
    expect(counts(s)).toEqual({ ticked: 2, notTicked: 1, readings: 1, answers: 0 })
    expect(s.glucose[0]).toEqual({ date: '2026-10-13', time: null, value_text: '140', context: 'fasting', insulin_units: 14 })
  })
})
