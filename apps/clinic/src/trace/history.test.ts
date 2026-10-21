import { describe, expect, it } from 'vitest'

import { trace } from '../test/fixtures'
import { describeHistory } from './history'

describe('describeHistory', () => {
  it('says no person changed an accepted value', () => {
    expect(describeHistory(trace())).toBe('Accepted by the checks. No person changed it.')
  })

  it('names who confirmed a value and when', () => {
    const t = trace({ history: { kind: 'confirmed', actor_name: 'Dr. Demo Clinician', at: '2026-10-21T14:02:00', original_value_text: null, original_unit_text: null } })
    expect(describeHistory(t)).toMatch(/^Confirmed as read by Dr\. Demo Clinician, 21 Oct 2026,? 14:02\.$/)
  })

  it('falls back when a confirmation has no recorded person', () => {
    const t = trace({ history: { kind: 'confirmed', actor_name: null, at: null, original_value_text: null, original_unit_text: null } })
    expect(describeHistory(t)).toBe('Confirmed as read by a person.')
  })

  it('keeps the original reading of a correction', () => {
    const t = trace({ history: { kind: 'corrected', actor_name: 'Dr. Demo Clinician', at: '2026-10-21T14:02:00', original_value_text: '162', original_unit_text: 'mg/dL' } })
    expect(describeHistory(t)).toMatch(/The reader had 162 mg\/dL\.$/)
  })

  it('names who typed a clinician-entered value', () => {
    const t = trace({ provenance_kind: 'clinician_entered', entered_by_name: 'Dr. Rao', page: null, box: null })
    expect(describeHistory(t)).toBe('Typed by Dr. Rao. There is no page image for this value.')
  })

  it('describes a register transcription', () => {
    expect(describeHistory(trace({ provenance_kind: 'register_transcription' }))).toMatch(/^Transcribed/)
  })
})
