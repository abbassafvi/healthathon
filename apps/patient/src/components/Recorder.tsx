import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioPlayer,
  useAudioPlayerStatus,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio'
import { useEffect, useState } from 'react'
import { AccessibilityInfo, StyleSheet, View } from 'react-native'

import { useApp } from '../AppState'
import { fmt } from '../i18n'
import { color, radius, space } from '../theme'
import { Button } from './Button'
import { Txt } from './Txt'

/* Speech needs one channel and a modest bit rate: a two-minute answer stays under 1 MB. */
const OPTIONS = { ...RecordingPresets.HIGH_QUALITY, numberOfChannels: 1, bitRate: 64000 }
const MAX_SECONDS = 120

type Phase = 'idle' | 'recording' | 'recorded' | 'denied' | 'failed'

/*
 * Speak instead of typing. The microphone is on only between Start and
 * Stop, and for two minutes at most. The recording is played back before
 * it goes, and it reaches the clinic as recorded: nothing transcribes it.
 */
export function Recorder({ sendLabel, onDone, onCancel }: { sendLabel: string; onDone: (uri: string) => void; onCancel: () => void }) {
  const { t } = useApp()
  const recorder = useAudioRecorder(OPTIONS)
  const state = useAudioRecorderState(recorder, 250)
  const [phase, setPhase] = useState<Phase>('idle')
  const [uri, setUri] = useState<string | null>(null)

  const start = async () => {
    try {
      const permission = await requestRecordingPermissionsAsync()
      if (!permission.granted) return setPhase('denied')
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true })
      await recorder.prepareToRecordAsync()
      recorder.record({ forDuration: MAX_SECONDS })
      setPhase('recording')
      // Said once; the running time is not read out as it changes.
      AccessibilityInfo.announceForAccessibility(fmt(t.voice.recording, { time: clock(0) }))
    } catch {
      setPhase('failed')
    }
  }
  const stop = async () => {
    try {
      await recorder.stop()
      await setAudioModeAsync({ allowsRecording: false })
      if (!recorder.uri) return setPhase('failed')
      setUri(recorder.uri)
      setPhase('recorded')
    } catch {
      setPhase('failed')
    }
  }
  // At two minutes the recorder stops itself; take what it has.
  useEffect(() => {
    if (phase === 'recording' && !state.isRecording && state.durationMillis > 0) void stop()
    // stop() is the same every render; only the recorder's state matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, state.isRecording])

  return (
    <View style={styles.box} testID="recorder">
      {phase === 'idle' && <Button kind="primary" label={t.voice.start} onPress={() => void start()} testID="start-recording" />}
      {phase === 'recording' && (
        <>
          <View style={styles.live}>
            <View style={styles.dot} />
            <Txt size={20} weight="medium" testID="recording-time">{fmt(t.voice.recording, { time: clock(state.durationMillis / 1000) })}</Txt>
          </View>
          <Button kind="primary" label={t.voice.stop} onPress={() => void stop()} testID="stop-recording" />
        </>
      )}
      {phase === 'recorded' && uri && (
        <>
          <Playback uri={uri} />
          <Txt size={15} tone="ink3">{t.voice.note}</Txt>
          <Button kind="primary" label={sendLabel} onPress={() => onDone(uri)} testID="use-recording" />
          <Button label={t.voice.again} onPress={() => { setUri(null); setPhase('idle') }} testID="record-again" />
        </>
      )}
      {(phase === 'denied' || phase === 'failed') && (
        <Txt size={17} accessibilityLiveRegion="polite" testID="recording-problem">{phase === 'denied' ? t.voice.denied : t.voice.failed}</Txt>
      )}
      {phase === 'failed' && <Button label={t.voice.again} onPress={() => setPhase('idle')} testID="record-again" />}
      <Button kind="quiet" label={t.voice.cancel} onPress={onCancel} testID="cancel-recording" style={styles.inline} />
    </View>
  )
}

/* A recording played as it was made, with its length. */
export function Playback({ uri }: { uri: string }) {
  const { t } = useApp()
  const player = useAudioPlayer(uri)
  const status = useAudioPlayerStatus(player)
  const toggle = () => {
    if (status.playing) return player.pause()
    if (status.didJustFinish || (status.duration > 0 && status.currentTime >= status.duration)) void player.seekTo(0)
    player.play()
  }
  return (
    <View style={styles.playback} testID="playback">
      <Button label={status.playing ? t.voice.pause : t.voice.play} onPress={toggle} testID="play-recording" style={styles.play} />
      <View>
        <Txt size={16} weight="medium">{t.voice.yours}</Txt>
        {status.duration > 0 && <Txt latin size={15} tone="ink2">{clock(status.duration)}</Txt>}
      </View>
    </View>
  )
}

/* 75 seconds as 1:15. */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

const styles = StyleSheet.create({
  box: { gap: space.sm, padding: space.lg, borderRadius: radius.md, borderWidth: 1.5, borderColor: color.lineStrong, backgroundColor: color.surface },
  live: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  // The one live state: a solid dot while the microphone is on.
  dot: { width: 14, height: 14, borderRadius: radius.pill, backgroundColor: color.accent },
  playback: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  play: { minWidth: 112 },
  inline: { alignSelf: 'flex-start', paddingHorizontal: 0 },
})
