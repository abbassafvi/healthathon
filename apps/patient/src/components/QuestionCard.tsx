import { useState } from 'react'
import { StyleSheet, TextInput, View } from 'react-native'

import { useApp } from '../AppState'
import type { Question } from '../data/types'
import { fmt, shownAnswer } from '../i18n'
import { color, font, lineHeightFactor, radius, space } from '../theme'
import { Button } from './Button'
import { Section } from './Section'
import { Txt } from './Txt'

/* The day's question. Answers are stored exactly as given, never scored. */
export function QuestionCard({ question, answer, onAnswer }: { question: Question; answer: string | null; onAnswer: (a: string) => void }) {
  const { t, lang, rtl } = useApp()
  const [writing, setWriting] = useState(false)
  const [changing, setChanging] = useState(false)
  const [text, setText] = useState('')
  // A mistaken tap can be put right: the newest answer is the one kept.
  const send = (a: string) => {
    setChanging(false)
    setWriting(false)
    setText('')
    onAnswer(a)
  }

  return (
    <Section title={t.today.question}>
      <Txt size={20} weight="medium">{question.text[lang]}</Txt>
      {answer !== null && !changing ? (
        <View style={styles.gap}>
          <Txt size={18} tone="ink2" testID="answer-given">{fmt(t.today.answered, { answer: shownAnswer(answer, t) })}</Txt>
          <Button kind="quiet" label={t.today.changeAnswer} onPress={() => setChanging(true)} testID="change-answer" style={styles.change} />
        </View>
      ) : writing ? (
        <View style={styles.gap}>
          <TextInput
            testID="answer-text"
            accessibilityLabel={t.today.writeAnswer}
            value={text}
            onChangeText={setText}
            multiline
            style={[styles.input, { fontFamily: font[lang].regular, lineHeight: Math.round(18 * lineHeightFactor[lang]), textAlign: rtl ? 'right' : 'left' }]}
          />
          <Button kind="primary" label={t.today.send} disabled={!text.trim()} onPress={() => send(text.trim())} />
        </View>
      ) : (
        <View style={styles.gap}>
          <View style={styles.row}>
            <Button label={t.today.yes} onPress={() => send(t.today.yes)} style={styles.half} testID="answer-yes" />
            <Button label={t.today.no} onPress={() => send(t.today.no)} style={styles.half} testID="answer-no" />
          </View>
          <Button kind="quiet" label={t.today.writeAnswer} onPress={() => setWriting(true)} />
        </View>
      )}
    </Section>
  )
}

const styles = StyleSheet.create({
  gap: { gap: space.sm },
  change: { alignSelf: 'flex-start', paddingHorizontal: 0 },
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
