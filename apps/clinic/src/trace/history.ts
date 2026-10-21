import type { Trace } from '../api/client'
import { formatDateTime } from '../lib/dates'
import { en, fmt } from '../strings/en'

/* How a value reached the record, as one plain sentence. */
export function describeHistory(t: Trace): string {
  if (t.provenance_kind === 'clinician_entered') {
    return fmt(en.trace.clinicianEntered, { name: t.entered_by_name ?? 'a clinician' })
  }
  if (t.provenance_kind === 'register_transcription') return en.trace.transcribed
  const h = t.history
  if (h.kind === 'corrected') {
    const original = [h.original_value_text, h.original_unit_text].filter(Boolean).join(' ')
    return fmt(en.trace.corrected, {
      name: h.actor_name ?? 'a person',
      when: h.at ? formatDateTime(h.at) : '',
      original,
    })
  }
  if (h.kind === 'confirmed') {
    if (!h.actor_name || !h.at) return en.trace.confirmedUnknown
    return fmt(en.trace.confirmed, { name: h.actor_name, when: formatDateTime(h.at) })
  }
  return en.trace.accepted
}
