import { fireEvent, screen, waitFor, within } from '@testing-library/react-native'
import { useEffect } from 'react'

import { useApp } from '../AppState'
import type { Lang } from '../theme'
import { renderApp } from '../test/render'
import { TodayScreen } from './TodayScreen'

/* Signs in as a patient, then shows Today, as the app does after Welcome. */
function As({ patient, lang = 'en' }: { patient: string; lang?: Lang }) {
  const { choose, patientId, ready } = useApp()
  // Like the app, act only once stored settings have loaded.
  useEffect(() => {
    if (ready) choose({ lang, patientId: patient })
  }, [ready, choose, lang, patient])
  return patientId ? <TodayScreen onOpenSurvey={() => {}} onOpenPast={() => {}} onOpenSettings={() => {}} /> : null
}

describe('TodayScreen', () => {
  it('sets the date large and greets the patient by name', async () => {
    renderApp(<As patient="DEV-0001" />)
    expect(await screen.findByText('26')).toBeTruthy()
    expect(screen.getByText('October')).toBeTruthy()
    expect(screen.getByText('Mon')).toBeTruthy()
    expect(screen.getByText('Hello, Asha')).toBeTruthy()
  })

  it('records taken, not taken, and clears a choice with a second tap', async () => {
    const { api } = renderApp(<As patient="DEV-0001" />)
    const taken = () => screen.getByTestId('tick-rx-0001-a-item-1-taken')
    const notTaken = () => screen.getByTestId('tick-rx-0001-a-item-1-not-taken')
    await screen.findByTestId('tick-rx-0001-a-item-1')
    expect(taken().props['aria-pressed']).toBe(false)
    expect(notTaken().props['aria-pressed']).toBe(false)

    fireEvent.press(taken())
    await waitFor(() => expect(taken().props['aria-pressed']).toBe(true))
    expect((await api.today('DEV-0001')).ticks).toEqual({ 'rx-0001-a-item-1': true })

    fireEvent.press(notTaken())
    await waitFor(() => expect(notTaken().props['aria-pressed']).toBe(true))
    expect(taken().props['aria-pressed']).toBe(false)
    expect((await api.today('DEV-0001')).ticks).toEqual({ 'rx-0001-a-item-1': false })

    fireEvent.press(notTaken())
    await waitFor(async () => expect((await api.today('DEV-0001')).ticks).toEqual({}))
    await waitFor(() => expect(notTaken().props['aria-pressed']).toBe(false))
  })

  it('names the medicine on each answer, for a screen reader', async () => {
    renderApp(<As patient="DEV-0001" />)
    await screen.findByTestId('tick-rx-0001-a-item-1')
    expect(screen.getByLabelText('Taken, Tab. Metformin 500 mg 1-0-1')).toBeTruthy()
    expect(screen.getByLabelText('Not taken, Tab. Metformin 500 mg 1-0-1')).toBeTruthy()
  })

  it('says a write failed instead of pretending it was saved', async () => {
    const { api } = renderApp(<As patient="DEV-0001" />)
    await screen.findByTestId('tick-rx-0001-a-item-1')
    api.setTick = async () => {
      throw new Error('offline')
    }
    fireEvent.press(screen.getByTestId('tick-rx-0001-a-item-1-taken'))
    expect(await screen.findByText('That was not saved. Check the internet connection and try again.')).toBeTruthy()
    expect(screen.getByTestId('tick-rx-0001-a-item-1-taken').props['aria-pressed']).toBe(false)
  })

  it('offers to try again when today cannot be loaded', async () => {
    const { api } = renderApp(<As patient="DEV-0001" />)
    const real = api.today
    let fail = true
    api.today = (pid) => (fail ? Promise.reject(new Error('offline')) : real(pid))
    expect(await screen.findByText('Today could not be loaded. Check the internet connection.')).toBeTruthy()
    fail = false
    fireEvent.press(screen.getByTestId('retry'))
    expect(await screen.findByText('Hello, Asha')).toBeTruthy()
  })

  it('lets the day’s answer be changed after a mistaken tap', async () => {
    const { api } = renderApp(<As patient="DEV-0001" />)
    fireEvent.press(await screen.findByTestId('answer-yes'))
    expect(await screen.findByText('Your answer: Yes')).toBeTruthy()
    fireEvent.press(screen.getByTestId('change-answer'))
    fireEvent.press(screen.getByTestId('answer-no'))
    expect(await screen.findByText('Your answer: No')).toBeTruthy()
    expect((await api.today('DEV-0001')).answer).toBe('No')
  })

  it('says so when there is no medicine list yet', async () => {
    renderApp(<As patient="DEV-0002" />)
    expect(await screen.findByText('Your doctor has not given you a medicine list yet.')).toBeTruthy()
  })

  it('will not save a reading without a number and a time of day', async () => {
    const { api } = renderApp(<As patient="DEV-0001" />)
    fireEvent.press(await screen.findByTestId('add-reading'))
    fireEvent.press(screen.getByRole('button', { name: 'Save reading' }))
    expect(screen.getByText('Type the number from your meter.')).toBeTruthy()
    expect(screen.getByText('Choose when you took it.')).toBeTruthy()
    fireEvent.changeText(screen.getByTestId('glucose-value'), '162')
    fireEvent.press(screen.getByRole('button', { name: 'Save reading' }))
    expect((await api.today('DEV-0001')).readings).toEqual([])
    fireEvent.press(screen.getByTestId('context-fasting'))
    fireEvent.press(screen.getByRole('button', { name: 'Save reading' }))
    const reading = await screen.findByTestId('reading')
    expect(within(reading).getByText('162')).toBeTruthy()
    expect(within(reading).getByText(/Before breakfast/)).toBeTruthy()
  })

  it('records the answer to the day’s question as given', async () => {
    const { api } = renderApp(<As patient="DEV-0001" />)
    fireEvent.press(await screen.findByRole('button', { name: 'Write your own answer' }))
    fireEvent.changeText(screen.getByTestId('answer-text'), 'A little dizzy after lunch')
    fireEvent.press(screen.getByRole('button', { name: 'Send' }))
    expect(await screen.findByText('Your answer: A little dizzy after lunch')).toBeTruthy()
    expect((await api.today('DEV-0001')).answer).toBe('A little dizzy after lunch')
  })

  it('adds a meal photo and shows only a count, never an estimate', async () => {
    renderApp(<As patient="DEV-0001" />)
    fireEvent.press(await screen.findByTestId('add-meal'))
    expect(await screen.findByText('1 photo today')).toBeTruthy()
  })

  it('lays out right to left for Urdu', async () => {
    const { toJSON } = renderApp(<As patient="DEV-0002" lang="ur" />)
    await screen.findByText('دوائیں')
    const root = toJSON() as { props: { style: unknown } }
    expect(JSON.stringify(root.props.style)).toContain('"direction":"rtl"')
  })
})
