import type { QueueItem, Trace } from '../api/client'

export function queueItem(overrides: Partial<QueueItem> = {}): QueueItem {
  return {
    id: 'item-1',
    reason: 'readers_disagree',
    created_at: '2026-10-21T09:00:00Z',
    analyte_code: 'hba1c',
    analyte_name: 'HbA1c',
    value_text: '7.1',
    unit_text: '%',
    candidate_readings: [
      { value_text: '7.1', unit_text: '%' },
      { value_text: '7.7', unit_text: '%' },
    ],
    crop_url: '/api/storage/dev/crops/item-1.png',
    patient: { id: 'p-1', registration_no: 'DEV-0002', full_name: 'Imran Qureshi' },
    document: { id: 'd-1', doc_type: 'lab_report', document_date: '2026-10-08' },
    ...overrides,
  }
}

export function trace(overrides: Partial<Trace> = {}): Trace {
  return {
    value: {
      id: 'v-1',
      analyte_code: 'hba1c',
      analyte_name: 'HbA1c',
      value_text: '8.4',
      unit_text: '%',
      observed_at: '2026-10-12',
    },
    patient: { id: 'p-1', registration_no: 'DEV-0001', full_name: 'Asha Verma', year_of_birth: 1968, sex: 'F' },
    document: { id: 'd-1', doc_type: 'lab_report', document_date: '2026-10-12', issuing_source: 'Sunrise Diagnostics (fictional)' },
    provenance_kind: 'source_document',
    page: { url: '/api/storage/dev/pages/DEV-0001-lab.png', page_no: 1, page_count: 1, width_px: 1240, height_px: 1754 },
    box: { x: 0.55, y: 0.3, w: 0.06, h: 0.025 },
    located_by_text: false,
    entered_by_name: null,
    reader_name: 'dev-seed',
    reader_version: '0',
    history: { kind: 'accepted', actor_name: null, at: null, original_value_text: null, original_unit_text: null },
    ...overrides,
  }
}
