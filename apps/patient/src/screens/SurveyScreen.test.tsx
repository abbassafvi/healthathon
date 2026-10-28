import { fireEvent, screen, waitFor } from '@testing-library/react-native'
import { useEffect } from 'react'

import { useApp } from '../AppState'
import { renderApp } from '../test/render'
import { SurveyScreen } from './SurveyScreen'

function As({ onDone = () => {} }: { onDone?: () => void }) {
  const { choose, ready, patientId } = useApp()
  useEffect(() => {
    if (ready) choose({ lang: 'en', patientId: 'DEV-0001' })
    // Once, when storage is ready.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready])
  return patientId ? <SurveyScreen onDone={onDone} /> : null
}

describe('SurveyScreen', () => {
  it('takes a spoken answer for any question, and sends it with the written ones', async () => {
    const onDone = jest.fn()
    const { api } = renderApp(<As onDone={onDone} />)
    const [first, second] = await api.surveyQuestions('DEV-0001')
    const submit = jest.spyOn(api, 'submitSurvey')
    fireEvent.changeText(await screen.findByTestId(`survey-${first.key}`), '3')
    expect(screen.getByRole('button', { name: 'Send answers' }).props.accessibilityState?.disabled).toBe(true)
    fireEvent.press(screen.getByTestId(`speak-${second.key}`))
    fireEvent.press(screen.getByTestId('start-recording'))
    fireEvent.press(await screen.findByTestId('stop-recording'))
    fireEvent.press(await screen.findByTestId('use-recording'))
    expect(await screen.findByTestId(`spoken-${second.key}`)).toBeTruthy()
    fireEvent.press(screen.getByRole('button', { name: 'Send answers' }))
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    const [, written, , recordings] = submit.mock.calls[0]
    expect(written).toEqual({ [first.key]: '3' })
    expect(Object.keys(recordings ?? {})).toEqual([second.key])
  })

  it('lets a recording be removed, and then the question needs an answer again', async () => {
    const { api } = renderApp(<As />)
    const [, second] = await api.surveyQuestions('DEV-0001')
    fireEvent.press(await screen.findByTestId(`speak-${second.key}`))
    fireEvent.press(screen.getByTestId('start-recording'))
    fireEvent.press(await screen.findByTestId('stop-recording'))
    fireEvent.press(await screen.findByTestId('use-recording'))
    fireEvent.press(await screen.findByTestId(`remove-${second.key}`))
    expect(screen.queryByTestId(`spoken-${second.key}`)).toBeNull()
    expect(screen.getByTestId(`speak-${second.key}`)).toBeTruthy()
  })
})
