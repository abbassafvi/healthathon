import type { QueueItem } from '../api/client'

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
