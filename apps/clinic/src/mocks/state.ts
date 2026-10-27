/*
 * In-memory state behind the mock handlers. It is keyed by registration
 * number, so it lines up with the real seeded patients (DEV-0001..4), and
 * it lasts until reload. resetMockState() puts it back for tests.
 */
import type { PatientEntry, RegimenItem } from '../api/client'
import { localIsoDate } from '../lib/localDate'
import { generateEntries } from './entries'
import { lineBox, type RxLine, type RxPage } from './pages'

export const DEMO_CLINICIAN = 'Dr. Demo Clinician'

export type MockRegimen = {
  id: string
  registration_no: string
  document: { id: string; document_date: string; issuing_source: string }
  page: RxPage
  items: RegimenItem[]
  activated_at: string | null
  activated_by_name: string | null
  superseded_at: string | null
}

export type MockState = {
  regimens: MockRegimen[]
  /* Patient-reported entries by registration number. */
  entries: Record<string, PatientEntry[]>
}

const DOCTOR = 'Dr. Kavita Rao, MD (fictional)'
const CLINIC = 'Diabetes Clinic, Lucknow (fictional)'

export function daysAgo(n: number, now = new Date()): string {
  const d = new Date(now)
  d.setDate(d.getDate() - n)
  return localIsoDate(d)
}

function printed(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${Number(d)}/${Number(m)}/${y.slice(2)}`
}

function regimen(
  id: string,
  registration_no: string,
  patientName: string,
  date: string,
  lines: RxLine[],
  activated: { at: string } | null,
): MockRegimen {
  const docId = `doc-${id}`
  const page: RxPage = { doctor: DOCTOR, clinic: CLINIC, patientName, dateText: printed(date), lines }
  return {
    id,
    registration_no,
    document: { id: docId, document_date: date, issuing_source: DOCTOR },
    page,
    items: lines.map((l, i) => {
      const box = lineBox(page, i)
      return {
        id: `${id}-item-${i + 1}`,
        drug_text: l.drug,
        dose_text: l.dose,
        schedule_text: l.schedule,
        box,
        crop_url: cropUrl(docId, box),
        confirmed_by_name: activated ? DEMO_CLINICIAN : null,
        confirmed_at: activated ? `${activated.at}T10:00:00` : null,
      }
    }),
    activated_at: activated ? `${activated.at}T10:05:00` : null,
    activated_by_name: activated ? DEMO_CLINICIAN : null,
    superseded_at: null,
  }
}

/* A crop is the page SVG with a viewBox around the line, padded for context. */
export function cropUrl(docId: string, box: { x: number; y: number; w: number; h: number }): string {
  const pad = 24
  const x = Math.max(0, box.x * 1240 - pad)
  const y = Math.max(0, box.y * 1754 - pad)
  const w = box.w * 1240 + pad * 2
  const h = box.h * 1754 + pad * 2
  return `/mock/pages/${docId}.svg?crop=${[x, y, w, h].map((n) => n.toFixed(1)).join(',')}`
}

export function pageUrl(docId: string): string {
  return `/mock/pages/${docId}.svg`
}

function initialState(now = new Date()): MockState {
  const d = (n: number) => daysAgo(n, now)
  const regimens: MockRegimen[] = [
      regimen('rx-0001-a', 'DEV-0001', 'Asha Verma', d(19), [
        { drug: 'Tab. Metformin', dose: '500 mg', schedule: '1-0-1' },
        { drug: 'Tab. Glimepiride', dose: '1 mg', schedule: '1-0-0' },
        { drug: 'Tab. Atorvastatin', dose: '10 mg', schedule: '0-0-1' },
      ], { at: d(19) }),
      regimen('rx-0001-b', 'DEV-0001', 'Asha Verma', d(1), [
        { drug: 'Tab. Metformin', dose: '1000 mg', schedule: '1-0-1' },
        { drug: 'Tab. Glimepiride', dose: '1 mg', schedule: '1-0-0' },
        { drug: 'Tab. Atorvastatin', dose: '10 mg', schedule: '0-0-1' },
        { drug: 'Tab. Telmisartan', dose: '40 mg', schedule: '1-0-0' },
      ], null),
      regimen('rx-0002-a', 'DEV-0002', 'Imran Qureshi', d(3), [
        { drug: 'Tab. Sitagliptin', dose: '100 mg', schedule: '1-0-0' },
        { drug: 'Inj. Insulin Glargine', dose: '14 units', schedule: 'at bedtime' },
      ], null),
      regimen('rx-0003-a', 'DEV-0003', 'Meera Pillai', d(30), [
        { drug: 'Tab. Metformin', dose: '500 mg', schedule: '1-1-1' },
        { drug: 'Tab. Empagliflozin', dose: '10 mg', schedule: '1-0-0' },
      ], { at: d(30) }),
  ]
  return { regimens, entries: generateEntries(regimens, now) }
}

let state: MockState = initialState()

export function mockState(): MockState {
  return state
}

export function resetMockState(now?: Date): void {
  state = initialState(now)
}
