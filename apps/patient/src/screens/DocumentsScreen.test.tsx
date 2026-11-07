import { fireEvent, render, screen, waitFor } from '@testing-library/react-native'
import { useEffect } from 'react'

import { AppStateProvider, useApp } from '../AppState'
import { createMockApi } from '../data/mockApi'
import type { PatientApi, PatientDoc, UploadStatus } from '../data/types'
import { en } from '../i18n/en'
import type { Lang } from '../theme'
import { DocumentsScreen } from './DocumentsScreen'

jest.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: jest.fn(async () => ({ granted: true })),
  launchCameraAsync: jest.fn(async () => ({ canceled: false, assets: [{ uri: 'file:///rx.jpg' }] })),
  launchImageLibraryAsync: jest.fn(async () => ({ canceled: true })),
}))

const rx: PatientDoc = {
  id: 'd-1',
  doc_type: 'prescription',
  document_date: null,
  received_at: '2026-10-25T10:00:00',
  sent_from: 'patient_app',
  page_uri: 'http://clinic.test:8000/page.png',
  lines: [{ drug_text: 'Tab. Metformin', dose_text: '500 mg', schedule_text: '1-0-1', checked: false }],
  values: [],
  advice: [{ text: 'Walk 30 minutes daily', checked: false }],
}

function As({ lang = 'en', onBack = () => {} }: { lang?: Lang; onBack?: () => void }) {
  const { choose, patientId, ready } = useApp()
  useEffect(() => {
    if (ready) choose({ lang, patientId: 'DEV-0001' })
  }, [ready, choose, lang])
  return patientId ? <DocumentsScreen onBack={onBack} /> : null
}

function setup(over: Partial<PatientApi> = {}, lang: Lang = 'en') {
  const api: PatientApi = { ...createMockApi(() => new Date('2026-10-26T09:00:00')), ...over }
  render(<AppStateProvider api={api}><As lang={lang} /></AppStateProvider>)
  return api
}

describe('DocumentsScreen', () => {
  it('lists a document with the medicines read off it', async () => {
    setup({ documents: async () => [rx] })
    expect(await screen.findByText('Tab. Metformin')).toBeTruthy()
    expect(screen.getByText('500 mg  1-0-1')).toBeTruthy()
    expect(screen.getByText('Walk 30 minutes daily')).toBeTruthy()
  })

  it('says a reading no clinician has checked is unchecked', async () => {
    setup({ documents: async () => [rx] })
    await screen.findByText('Tab. Metformin')
    expect(screen.getAllByText(en.docs.unchecked).length).toBe(2)
    expect(screen.queryByText(en.docs.checked)).toBeNull()
  })

  it('says so when a clinician has checked a reading', async () => {
    const checked = { ...rx, lines: [{ ...rx.lines[0], checked: true }], advice: [] }
    setup({ documents: async () => [checked] })
    await screen.findByText('Tab. Metformin')
    expect(screen.getByText(en.docs.checked)).toBeTruthy()
  })

  it('shows no number for a laboratory value nobody has settled', async () => {
    const lab: PatientDoc = {
      ...rx,
      id: 'd-2',
      doc_type: 'lab_report',
      lines: [],
      advice: [],
      values: [{ analyte_name: 'HbA1c', value_text: null, unit_text: null, checked: false }],
    }
    setup({ documents: async () => [lab] })
    expect(await screen.findByText('HbA1c')).toBeTruthy()
    expect(screen.getByText(en.docs.valueWaiting)).toBeTruthy()
  })

  it('shows a settled laboratory value as printed, with its unit', async () => {
    const lab: PatientDoc = {
      ...rx,
      id: 'd-3',
      doc_type: 'lab_report',
      lines: [],
      advice: [],
      values: [{ analyte_name: 'HbA1c', value_text: '7.4', unit_text: '%', checked: true }],
    }
    setup({ documents: async () => [lab] })
    expect(await screen.findByText('7.4 %')).toBeTruthy()
  })

  it('says who sent each page', async () => {
    setup({ documents: async () => [rx, { ...rx, id: 'd-9', sent_from: 'desk_scan' }] })
    await screen.findByText(en.docs.sentByYou)
    expect(screen.getByText(en.docs.sentByClinic)).toBeTruthy()
  })

  it('sends a photographed page once the patient says what it is', async () => {
    const sent: string[] = []
    setup({
      documents: async () => [],
      sendDocument: async (_pid, d) => {
        sent.push(d.docType)
        return { id: 'u-1', stage: 'done', document_id: 'd-1', failure: null } as UploadStatus
      },
    })
    await screen.findByTestId('docs-empty')
    fireEvent.press(screen.getByTestId('docs-add'))
    fireEvent.press(await screen.findByTestId('doc-kind-prescription'))
    fireEvent.press(screen.getByTestId('doc-send'))
    await waitFor(() => expect(sent).toEqual(['prescription']))
  })

  it('will not send until the patient says what the page is', async () => {
    const sent: string[] = []
    setup({
      documents: async () => [],
      sendDocument: async (_pid, d) => {
        sent.push(d.docType)
        return { id: 'u-1', stage: 'done', document_id: 'd-1', failure: null } as UploadStatus
      },
    })
    await screen.findByTestId('docs-empty')
    fireEvent.press(screen.getByTestId('docs-add'))
    fireEvent.press(await screen.findByTestId('doc-send'))
    expect(sent).toEqual([])
    expect(screen.getByTestId('doc-kind-needed')).toBeTruthy()
  })

  it('waits while the clinic reads the page, then lists it', async () => {
    const stages: UploadStatus['stage'][] = ['reading', 'done']
    let n = 0
    let docs: PatientDoc[] = []
    setup({
      documents: async () => docs,
      sendDocument: async () => ({ id: 'u-1', stage: 'reading', document_id: null, failure: null }),
      uploadStatus: async () => {
        const stage = stages[Math.min(n++, stages.length - 1)]
        if (stage === 'done') docs = [rx]
        return { id: 'u-1', stage, document_id: stage === 'done' ? 'd-1' : null, failure: null }
      },
    })
    await screen.findByTestId('docs-empty')
    fireEvent.press(screen.getByTestId('docs-add'))
    fireEvent.press(await screen.findByTestId('doc-kind-prescription'))
    fireEvent.press(screen.getByTestId('doc-send'))
    expect(await screen.findByTestId('docs-reading')).toBeTruthy()
    expect(await screen.findByText('Tab. Metformin')).toBeTruthy()
  })

  it('keeps the photograph and says so when sending fails', async () => {
    setup({
      documents: async () => [],
      sendDocument: async () => {
        throw new Error('no network')
      },
    })
    await screen.findByTestId('docs-empty')
    fireEvent.press(screen.getByTestId('docs-add'))
    fireEvent.press(await screen.findByTestId('doc-kind-prescription'))
    fireEvent.press(screen.getByTestId('doc-send'))
    expect(await screen.findByTestId('docs-failed')).toBeTruthy()
  })

  it('says so when the documents cannot be loaded, and tries again', async () => {
    let fail = true
    setup({
      documents: async () => {
        if (fail) throw new Error('offline')
        return [rx]
      },
    })
    const retry = await screen.findByTestId('docs-retry')
    fail = false
    fireEvent.press(retry)
    expect(await screen.findByText('Tab. Metformin')).toBeTruthy()
  })

  it('runs in Urdu', async () => {
    setup({ documents: async () => [rx] }, 'ur')
    expect(await screen.findByText('نسخہ')).toBeTruthy()
  })
})
