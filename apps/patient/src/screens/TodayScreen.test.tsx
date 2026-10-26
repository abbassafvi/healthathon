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
  return patientId ? <TodayScreen onOpenSurvey={() => {}} /> : null
}

describe('TodayScreen', () => {
  it('sets the date large and greets the patient by name', async () => {
    renderApp(<As patient="DEV-0001" />)
    expect(await screen.findByText('26')).toBeTruthy()
    expect(screen.getByText('October')).toBeTruthy()
    expect(screen.getByText('Mon')).toBeTruthy()
    expect(screen.getByText('Hello, Asha')).toBeTruthy()
  })

  it('ticks a medicine and untick it again', async () => {
    const { api } = renderApp(<As patient="DEV-0001" />)
    const row = await screen.findByTestId('tick-rx-0001-a-item-1')
    expect(row.props.accessibilityState).toMatchObject({ checked: false })
    fireEvent.press(row)
    await waitFor(() => expect(screen.getByTestId('tick-rx-0001-a-item-1').props.accessibilityState).toMatchObject({ checked: true }))
    expect((await api.today('DEV-0001')).ticks).toEqual({ 'rx-0001-a-item-1': true })
    fireEvent.press(screen.getByTestId('tick-rx-0001-a-item-1'))
    await waitFor(async () => expect((await api.today('DEV-0001')).ticks).toEqual({}))
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
    expect(await screen.findByText('1 photos today')).toBeTruthy()
  })

  it('lays out right to left for Urdu', async () => {
    const { toJSON } = renderApp(<As patient="DEV-0002" lang="ur" />)
    await screen.findByText('دوائیں')
    const root = toJSON() as { props: { style: unknown } }
    expect(JSON.stringify(root.props.style)).toContain('"direction":"rtl"')
  })
})
