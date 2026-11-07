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
  return patientId ? <TodayScreen onOpenSurvey={() => {}} onOpenPast={() => {}} onOpenSettings={() => {}} onOpenDocs={() => {}} /> : null
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

  it('lets a patient add a few words after a Yes or No, kept with the tap', async () => {
    const { api } = renderApp(<As patient="DEV-0001" />)
    fireEvent.press(await screen.findByTestId('answer-no'))
    expect(await screen.findByText('Your answer: No')).toBeTruthy()
    fireEvent.press(screen.getByTestId('add-words'))
    fireEvent.changeText(screen.getByTestId('answer-text'), 'I forgot the evening one')
    fireEvent.press(screen.getByTestId('send-answer'))
    expect(await screen.findByText('Your answer: No, I forgot the evening one')).toBeTruthy()
    expect((await api.today('DEV-0001')).answer).toBe('No, I forgot the evening one')
    // Words are words: no second round of adding to them.
    expect(screen.queryByTestId('add-words')).toBeNull()
  })

  it('keeps the tap when the words are called off', async () => {
    const { api } = renderApp(<As patient="DEV-0001" />)
    fireEvent.press(await screen.findByTestId('answer-yes'))
    fireEvent.press(await screen.findByTestId('add-words'))
    fireEvent.press(screen.getByTestId('cancel-words'))
    expect(await screen.findByText('Your answer: Yes')).toBeTruthy()
    expect((await api.today('DEV-0001')).answer).toBe('Yes')
  })

  it('records a spoken answer, plays it back first, and keeps it as recorded', async () => {
    const { api } = renderApp(<As patient="DEV-0001" />)
    fireEvent.press(await screen.findByTestId('speak-answer'))
    fireEvent.press(screen.getByTestId('start-recording'))
    fireEvent.press(await screen.findByTestId('stop-recording'))
    expect(await screen.findByTestId('playback')).toBeTruthy()
    expect(screen.getByText('Your doctor listens to it as you recorded it.')).toBeTruthy()
    fireEvent.press(screen.getByTestId('use-recording'))
    await waitFor(async () => expect((await api.today('DEV-0001')).answer_audio_uri).toBe('file:///answer.m4a'))
    expect((await api.today('DEV-0001')).answer).toBeNull()
    expect(await screen.findByTestId('playback')).toBeTruthy()
    expect(screen.queryByTestId('answer-given')).toBeNull()
  })

  it('keeps a tapped No with the words spoken after it', async () => {
    const { api } = renderApp(<As patient="DEV-0001" />)
    fireEvent.press(await screen.findByTestId('answer-no'))
    fireEvent.press(await screen.findByTestId('say-words'))
    fireEvent.press(screen.getByTestId('start-recording'))
    fireEvent.press(await screen.findByTestId('stop-recording'))
    fireEvent.press(await screen.findByTestId('use-recording'))
    await waitFor(async () => expect((await api.today('DEV-0001')).answer_audio_uri).toBe('file:///answer.m4a'))
    expect((await api.today('DEV-0001')).answer).toBe('No')
    expect(await screen.findByText('Your answer: No')).toBeTruthy()
  })

  it('asks which meal a photo is before sending it, and shows it back with its time', async () => {
    const { api } = renderApp(<As patient="DEV-0001" />)
    fireEvent.press(await screen.findByTestId('add-meal'))
    fireEvent.press(await screen.findByTestId('send-meal'))
    expect(screen.getByText('Choose which meal it is.')).toBeTruthy()
    expect((await api.today('DEV-0001')).meals).toEqual([])
    fireEvent.press(screen.getByTestId('meal-lunch'))
    fireEvent.press(screen.getByTestId('send-meal'))
    expect(await screen.findByText('1 photo today')).toBeTruthy()
    const [meal] = (await api.today('DEV-0001')).meals
    expect([meal.meal, meal.calories_text]).toEqual(['lunch', null])
    expect(within(screen.getByTestId(`meal-thumb-${meal.id}`)).getByText('Lunch')).toBeTruthy()
  })

  it('sends calories only as the patient typed them, and never a total', async () => {
    const { api } = renderApp(<As patient="DEV-0001" />)
    fireEvent.press(await screen.findByTestId('add-meal'))
    fireEvent.press(await screen.findByTestId('meal-snack'))
    fireEvent.changeText(screen.getByTestId('meal-calories'), 'about 300')
    fireEvent.press(screen.getByTestId('send-meal'))
    expect(screen.getByText('Type the calories as a number, or leave it empty.')).toBeTruthy()
    fireEvent.changeText(screen.getByTestId('meal-calories'), '300')
    fireEvent.press(screen.getByTestId('send-meal'))
    expect(await screen.findByText('300 kcal')).toBeTruthy()
    expect((await api.today('DEV-0001')).meals[0].calories_text).toBe('300')
    expect(screen.queryByText(/total|kcal today/i)).toBeNull()
  })

  it('lays out right to left for Urdu', async () => {
    const { toJSON } = renderApp(<As patient="DEV-0002" lang="ur" />)
    await screen.findByText('دوائیں')
    const root = toJSON() as { props: { style: unknown } }
    expect(JSON.stringify(root.props.style)).toContain('"direction":"rtl"')
  })
})
