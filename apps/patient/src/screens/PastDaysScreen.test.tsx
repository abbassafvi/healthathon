import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native'
import { useEffect } from 'react'
import { BackHandler } from 'react-native'

import { AppStateProvider, useApp } from '../AppState'
import { createMockApi } from '../data/mockApi'
import type { PastDay, PastDays, PatientApi } from '../data/types'
import { en } from '../i18n/en'
import type { Lang } from '../theme'
import { PastDaysScreen } from './PastDaysScreen'

const item = { id: 'i-1', drug_text: 'Tab. Metformin', dose_text: '500 mg', schedule_text: '1-0-1' }
const day = (date: string, over: Partial<PastDay> = {}): PastDay => ({ date, ticks: [], readings: [], answers: [], meals: [], ...over })

const yesterday = day('2026-10-25', {
  ticks: [{ item, ticked: true }, { item: { ...item, id: 'i-2', drug_text: 'Tab. Atorvastatin', dose_text: '10 mg', schedule_text: null }, ticked: false }],
  readings: [{ id: 'r-1', value_text: '142', context: 'fasting', occurred_at: '2026-10-25T07:31:00' }],
  answers: [{ question: { key: 'felt_unwell_today', text: { en: 'Did you feel unwell today?', hi: 'क्या आज आपकी तबीयत ठीक नहीं थी?', ur: 'کیا آج آپ کی طبیعت ٹھیک نہیں تھی؟' } }, answer_text: 'No', audio_uri: null, occurred_at: '2026-10-25T20:00:00' }],
  meals: [{ id: 'm-1', uri: 'http://clinic.test:8000/api/storage/meals/p/m-1.jpg', occurred_at: '2026-10-25T13:00:00', meal: 'lunch', calories_text: '420' }],
})

function As({ lang = 'en', onBack = () => {} }: { lang?: Lang; onBack?: () => void }) {
  const { choose, patientId, ready } = useApp()
  useEffect(() => {
    if (ready) choose({ lang, patientId: 'DEV-0001' })
  }, [ready, choose, lang])
  return patientId ? <PastDaysScreen onBack={onBack} /> : null
}

function setup(pages: (before?: string) => Promise<PastDays>, lang: Lang = 'en', onBack = () => {}) {
  const calls: (string | undefined)[] = []
  const api: PatientApi = {
    ...createMockApi(() => new Date('2026-10-26T09:00:00')),
    pastDays: (_pid, before) => {
      calls.push(before)
      return pages(before)
    },
  }
  render(<AppStateProvider api={api}><As lang={lang} onBack={onBack} /></AppStateProvider>)
  return { calls }
}

describe('PastDaysScreen', () => {
  it('shows each earlier day as it was recorded, newest first', async () => {
    setup(async () => ({ days: [yesterday, day('2026-10-24')], next_before: null }))
    const y = await screen.findByTestId('day-2026-10-25')
    expect(within(y).getByText('25')).toBeTruthy()
    expect(within(y).getByText('Sun')).toBeTruthy()
    expect(within(screen.getByTestId('past-tick-i-1')).getByText('Taken')).toBeTruthy()
    expect(within(screen.getByTestId('past-tick-i-2')).getByText('Not taken')).toBeTruthy()
    expect(within(y).getByText('142')).toBeTruthy()
    expect(within(y).getByText('Before breakfast, 07:31')).toBeTruthy()
    expect(within(y).getByText('Did you feel unwell today?')).toBeTruthy()
    expect(within(y).getByText('No')).toBeTruthy()
    expect(within(screen.getByTestId('day-2026-10-24')).getByText(en.past.nothing)).toBeTruthy()
  })

  it('asks the clinic for small copies of its photos', async () => {
    setup(async () => ({ days: [yesterday], next_before: null }))
    await screen.findByTestId('day-2026-10-25')
    const img = screen.UNSAFE_getByType(require('react-native').Image)
    expect(img.props.source).toEqual({ uri: 'http://clinic.test:8000/api/storage/meals/p/m-1.jpg?width=320' })
    const meal = screen.getByTestId('meal-thumb-m-1')
    for (const text of ['Lunch', '13:00', '420 kcal']) expect(within(meal).getByText(text)).toBeTruthy()
  })

  it('plays a spoken answer back as recorded, beside any tap', async () => {
    const q = yesterday.answers[0].question
    setup(async () => ({
      days: [day('2026-10-25', { answers: [
        { question: q, answer_text: null, audio_uri: 'http://clinic.test:8000/api/storage/voice/p/a.m4a', occurred_at: '2026-10-25T20:00:00' },
      ] })],
      next_before: null,
    }))
    const y = await screen.findByTestId('day-2026-10-25')
    expect(within(y).getByTestId('playback')).toBeTruthy()
    expect(within(y).getByText(q.text.en)).toBeTruthy()
  })

  it('shows what was heard in a spoken answer under the recording, labelled', async () => {
    const q = yesterday.answers[0].question
    setup(async () => ({
      days: [day('2026-10-25', { answers: [
        { question: q, answer_text: null, audio_uri: 'http://clinic.test:8000/api/storage/voice/p/a.m4a', transcript: 'नहीं, शाम वाली भूल गया', occurred_at: '2026-10-25T20:00:00' },
        { question: q, answer_text: null, audio_uri: 'http://clinic.test:8000/api/storage/voice/p/b.m4a', transcript: null, occurred_at: '2026-10-25T20:05:00' },
      ] })],
      next_before: null,
    }))
    const y = await screen.findByTestId('day-2026-10-25')
    expect(within(y).getAllByTestId('playback')).toHaveLength(2)
    const [heard] = within(y).getAllByTestId('transcript')
    expect(within(heard!).getByText('Written down from your recording')).toBeTruthy()
    expect(within(heard!).getByText('नहीं, शाम वाली भूल गया')).toBeTruthy()
    expect(within(y).getAllByTestId('transcript')).toHaveLength(1)
  })

  it('loads earlier days on request, and stops at the first entry', async () => {
    const { calls } = setup(async (before) =>
      before ? { days: [day('2026-10-18')], next_before: null } : { days: [yesterday], next_before: '2026-10-19' },
    )
    fireEvent.press(await screen.findByTestId('more-days'))
    await screen.findByTestId('day-2026-10-18')
    expect(screen.getByTestId('day-2026-10-25')).toBeTruthy()
    expect(calls).toEqual([undefined, '2026-10-19'])
    expect(screen.queryByTestId('more-days')).toBeNull()
  })

  it('says when nothing has been recorded yet', async () => {
    setup(async () => ({ days: [], next_before: null }))
    expect(await screen.findByText(en.past.none)).toBeTruthy()
  })

  it('says when the days could not be loaded, and tries again', async () => {
    let fail = true
    setup(async () => {
      if (fail) throw new Error('offline')
      return { days: [yesterday], next_before: null }
    })
    expect(await screen.findByText(en.past.loadFailed)).toBeTruthy()
    fail = false
    fireEvent.press(screen.getByTestId('retry'))
    await screen.findByTestId('day-2026-10-25')
    expect(screen.queryByText(en.past.loadFailed)).toBeNull()
  })

  it('goes back to today', async () => {
    const onBack = jest.fn()
    setup(async () => ({ days: [], next_before: null }), 'en', onBack)
    fireEvent.press(await screen.findByTestId('back-to-today'))
    expect(onBack).toHaveBeenCalled()
  })

  it('shows the question in the language in use, and the drug as printed', async () => {
    setup(async () => ({ days: [yesterday], next_before: null }), 'hi')
    const y = await screen.findByTestId('day-2026-10-25')
    expect(within(y).getByText('क्या आज आपकी तबीयत ठीक नहीं थी?')).toBeTruthy()
    expect(within(y).getByText('Tab. Metformin')).toBeTruthy()
    expect(within(y).getByText('500 mg  1-0-1')).toBeTruthy()
  })

  it('lists a medicine nothing was marked for as not marked, in plain ink', async () => {
    setup(async () => ({ days: [day('2026-10-25', { ticks: [{ item, ticked: null }] })], next_before: null }))
    const row = await screen.findByTestId('past-tick-i-1')
    expect(within(row).getByText(en.past.notMarked)).toBeTruthy()
    expect(within(row).queryByText('Taken')).toBeNull()
  })

  it('shows a Yes or No in the language in use, and a written answer as written', async () => {
    const q = yesterday.answers[0].question
    setup(async () => ({
      days: [day('2026-10-25', { answers: [
        { question: q, answer_text: 'नहीं', audio_uri: null, occurred_at: '2026-10-25T20:00:00' },
        { question: q, answer_text: 'सुबह थोड़ा चक्कर आया', audio_uri: null, occurred_at: '2026-10-25T20:05:00' },
      ] })],
      next_before: null,
    }))
    const y = await screen.findByTestId('day-2026-10-25')
    expect(within(y).getByText('No')).toBeTruthy()
    expect(within(y).queryByText('नहीं')).toBeNull()
    expect(within(y).getByText('सुबह थोड़ा चक्कर आया')).toBeTruthy()
  })

  it("returns to today on Android's back, and from the end of the list", async () => {
    const handlers: ((e: never) => boolean | null | undefined)[] = []
    const spy = jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_e, h) => {
      handlers.push(h)
      return { remove: () => {} }
    })
    const onBack = jest.fn()
    setup(async () => ({ days: [yesterday], next_before: null }), 'en', onBack)
    await screen.findByTestId('day-2026-10-25')
    expect(handlers.at(-1)?.(undefined as never)).toBe(true)
    expect(onBack).toHaveBeenCalledTimes(1)
    fireEvent.press(screen.getByTestId('back-to-today-end'))
    expect(onBack).toHaveBeenCalledTimes(2)
    spy.mockRestore()
  })

  it('shows nothing interpretive', async () => {
    setup(async () => ({ days: [yesterday, day('2026-10-24')], next_before: null }))
    await screen.findByTestId('day-2026-10-25')
    await waitFor(() => expect(screen.toJSON()).toBeTruthy())
    const text = JSON.stringify(screen.toJSON())
    expect(text).not.toMatch(/\b(high|low|normal|good|bad|poor|target|range|average|trend|score|risk|missed|total|streak|well done|great)\b/i)
  })
})
