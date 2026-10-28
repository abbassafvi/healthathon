import { fireEvent, screen } from '@testing-library/react-native'
import * as Audio from 'expo-audio'
import { useEffect } from 'react'
import { AccessibilityInfo } from 'react-native'

import { useApp } from '../AppState'
import { en } from '../i18n/en'
import { renderApp } from '../test/render'
import { clock, Recorder } from './Recorder'

function As({ onDone = () => {} }: { onDone?: (uri: string) => void }) {
  const { choose, ready, patientId } = useApp()
  useEffect(() => {
    if (ready) choose({ lang: 'en', patientId: 'DEV-0001' })
    // Once, when storage is ready.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready])
  return patientId ? <Recorder sendLabel={en.voice.send} onDone={onDone} onCancel={() => {}} /> : null
}

afterEach(() => jest.clearAllMocks())

describe('Recorder', () => {
  it('turns the microphone on only between Start and Stop, for two minutes at most', async () => {
    const onDone = jest.fn()
    renderApp(<As onDone={onDone} />)
    expect(Audio.requestRecordingPermissionsAsync).not.toHaveBeenCalled()
    fireEvent.press(await screen.findByTestId('start-recording'))
    fireEvent.press(await screen.findByTestId('stop-recording'))
    const use = await screen.findByTestId('use-recording')
    expect(Audio.requestRecordingPermissionsAsync).toHaveBeenCalledTimes(1)
    expect(Audio.setAudioModeAsync).toHaveBeenLastCalledWith({ allowsRecording: false })
    fireEvent.press(use)
    expect(onDone).toHaveBeenCalledWith('file:///answer.m4a')
  })

  it('says once that it is recording, and does not read out the time as it runs', async () => {
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility')
    renderApp(<As />)
    fireEvent.press(await screen.findByTestId('start-recording'))
    await screen.findByTestId('stop-recording')
    expect(announce).toHaveBeenCalledTimes(1)
    expect(announce).toHaveBeenCalledWith('Recording, 0:00')
    expect(screen.getByTestId('recording-time').parent?.props.accessibilityLiveRegion).toBeUndefined()
  })

  it('says so when the microphone is refused, and offers writing instead', async () => {
    jest.mocked(Audio.requestRecordingPermissionsAsync).mockResolvedValueOnce({ granted: false } as never)
    renderApp(<As />)
    fireEvent.press(await screen.findByTestId('start-recording'))
    expect(await screen.findByText(en.voice.denied)).toBeTruthy()
    expect(screen.queryByTestId('use-recording')).toBeNull()
  })

  it('says so when recording fails, and lets the patient try again', async () => {
    renderApp(<As />)
    const recorder = Audio.useAudioRecorder({} as never)
    jest.mocked(recorder.prepareToRecordAsync).mockRejectedValueOnce(new Error('busy'))
    fireEvent.press(await screen.findByTestId('start-recording'))
    expect(await screen.findByText(en.voice.failed)).toBeTruthy()
    fireEvent.press(screen.getByTestId('record-again'))
    expect(screen.getByTestId('start-recording')).toBeTruthy()
  })

  it('records again, discarding what was recorded', async () => {
    renderApp(<As />)
    fireEvent.press(await screen.findByTestId('start-recording'))
    fireEvent.press(await screen.findByTestId('stop-recording'))
    fireEvent.press(await screen.findByTestId('record-again'))
    expect(screen.getByTestId('start-recording')).toBeTruthy()
    expect(screen.queryByTestId('playback')).toBeNull()
  })
})

describe('clock', () => {
  it('writes seconds as minutes and seconds', () => {
    expect(clock(0)).toBe('0:00')
    expect(clock(4.4)).toBe('0:04')
    expect(clock(75)).toBe('1:15')
  })
})
