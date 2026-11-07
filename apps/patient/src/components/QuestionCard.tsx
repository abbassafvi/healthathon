import { useState } from 'react'
import { StyleSheet, TextInput, View } from 'react-native'

import { useApp } from '../AppState'
import type { Question } from '../data/types'
import { fmt, isTapped, shownAnswer } from '../i18n'
import { color, font, lineHeightFactor, radius, space } from '../theme'
import { Button } from './Button'
import { Playback, Recorder } from './Recorder'
import { Section } from './Section'
import { Transcript } from './Transcript'
import { Txt } from './Txt'

type Mode = 'choose' | 'write' | 'speak' | 'words' | 'sayWords'

/* What the patient gave: words or a tap, a recording, or a tap with a recording. */
export type GivenAnswer = { text: string | null; audioUri?: string }

/*
 * The day's question. A patient taps Yes or No, or writes or speaks an
 * answer of their own; after a Yes or No they can add a few words, typed
 * or spoken ("No, I forgot the evening one"). Answers are stored exactly
 * as given, a recording as recorded, never scored. When the clinic writes
 * a recording down, the transcript is shown under it, labelled. A
 * mistaken answer can be put right: the newest one is the one kept.
 */
export function QuestionCard({ question, answer, answerAudio, answerTranscript, onAnswer }: {
  question: Question
  answer: string | null
  answerAudio: string | null
  answerTranscript?: string | null
  onAnswer: (a: GivenAnswer) => void
}) {
  const { t, lang } = useApp()
  const [mode, setMode] = useState<Mode | null>(null)
  const answered = answer !== null || answerAudio !== null
  const shown = mode ?? (answered ? null : 'choose')
  const send = (a: GivenAnswer) => {
    setMode(null)
    onAnswer(a)
  }
  const tapped = answer !== null && isTapped(answer) ? shownAnswer(answer, t) : null

  return (
    <Section title={t.today.question}>
      <Txt size={20} weight="medium">{question.text[lang]}</Txt>
      {shown === null && answered && (
        <View style={styles.gap}>
          {answer !== null && (
            <Txt size={18} tone="ink2" testID="answer-given">{fmt(t.today.answered, { answer: shownAnswer(answer, t) })}</Txt>
          )}
          {answerAudio && <Playback uri={answerAudio} />}
          {answerAudio && answerTranscript && <Transcript text={answerTranscript} />}
          {tapped && !answerAudio && (
            <>
              <Button kind="quiet" label={t.today.addWords} onPress={() => setMode('words')} testID="add-words" style={styles.inline} />
              <Button kind="quiet" label={t.voice.sayWords} onPress={() => setMode('sayWords')} testID="say-words" style={styles.inline} />
            </>
          )}
          <Button kind="quiet" label={t.today.changeAnswer} onPress={() => setMode('choose')} testID="change-answer" style={styles.inline} />
        </View>
      )}
      {shown === 'choose' && (
        <View style={styles.gap}>
          <View style={styles.row}>
            <Button label={t.today.yes} onPress={() => send({ text: t.today.yes })} style={styles.half} testID="answer-yes" />
            <Button label={t.today.no} onPress={() => send({ text: t.today.no })} style={styles.half} testID="answer-no" />
          </View>
          <Button kind="quiet" label={t.today.writeAnswer} onPress={() => setMode('write')} testID="write-answer" style={styles.inline} />
          <Button kind="quiet" label={t.voice.speak} onPress={() => setMode('speak')} testID="speak-answer" style={styles.inline} />
        </View>
      )}
      {shown === 'write' && <Words label={t.today.writeAnswer} onSend={(text) => send({ text })} onCancel={() => setMode(null)} />}
      {shown === 'speak' && <Recorder sendLabel={t.voice.send} onDone={(audioUri) => send({ text: null, audioUri })} onCancel={() => setMode(null)} />}
      {shown === 'words' && tapped && (
        <Words
          label={t.today.wordsLabel}
          prefix={tapped}
          onSend={(words) => send({ text: fmt(t.today.answerWithWords, { answer: tapped, words }) })}
          onCancel={() => setMode(null)}
        />
      )}
      {shown === 'sayWords' && tapped && (
        <View style={styles.gap}>
          <Txt size={18} tone="ink2">{fmt(t.today.answered, { answer: tapped })}</Txt>
          <Recorder sendLabel={t.voice.send} onDone={(audioUri) => send({ text: tapped, audioUri })} onCancel={() => setMode(null)} />
        </View>
      )}
    </Section>
  )
}

/* A box for the patient's own words, sent only when there is something in it. */
function Words({ label, prefix, onSend, onCancel }: { label: string; prefix?: string; onSend: (text: string) => void; onCancel: () => void }) {
  const { t, lang, rtl } = useApp()
  const [text, setText] = useState('')
  return (
    <View style={styles.gap}>
      {prefix && <Txt size={18} tone="ink2">{fmt(t.today.answered, { answer: prefix })}</Txt>}
      <TextInput
        testID="answer-text"
        accessibilityLabel={label}
        value={text}
        onChangeText={setText}
        multiline
        style={[styles.input, { fontFamily: font[lang].regular, lineHeight: Math.round(18 * lineHeightFactor[lang]), textAlign: rtl ? 'right' : 'left' }]}
      />
      <Button kind="primary" label={t.today.send} disabled={!text.trim()} onPress={() => onSend(text.trim())} testID="send-answer" />
      <Button kind="quiet" label={t.glucose.cancel} onPress={onCancel} testID="cancel-words" style={styles.inline} />
    </View>
  )
}

const styles = StyleSheet.create({
  gap: { gap: space.sm },
  inline: { alignSelf: 'flex-start', paddingHorizontal: 0 },
  row: { flexDirection: 'row', gap: space.sm },
  half: { flex: 1 },
  input: {
    minHeight: 96,
    fontSize: 18,
    color: color.ink,
    backgroundColor: color.bg,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: color.lineStrong,
    padding: space.md,
    textAlignVertical: 'top',
  },
})
