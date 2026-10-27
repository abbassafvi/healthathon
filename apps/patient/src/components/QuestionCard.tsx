import { useState } from 'react'
import { StyleSheet, TextInput, View } from 'react-native'

import { useApp } from '../AppState'
import type { Question } from '../data/types'
import { fmt } from '../i18n'
import { color, font, lineHeightFactor, radius, space } from '../theme'
import { Button } from './Button'
import { Section } from './Section'
import { Txt } from './Txt'

/* The day's question. Answers are stored exactly as given, never scored. */
export function QuestionCard({ question, answer, onAnswer }: { question: Question; answer: string | null; onAnswer: (a: string) => void }) {
  const { t, lang, rtl } = useApp()
  const [writing, setWriting] = useState(false)
  const [text, setText] = useState('')

  return (
    <Section title={t.today.question}>
      <Txt size={20} weight="medium">{question.text[lang]}</Txt>
      {answer !== null ? (
        <Txt size={18} tone="ink2" testID="answer-given">{fmt(t.today.answered, { answer })}</Txt>
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
          <Button kind="primary" label={t.today.send} disabled={!text.trim()} onPress={() => onAnswer(text.trim())} />
        </View>
      ) : (
        <View style={styles.gap}>
          <View style={styles.row}>
            <Button label={t.today.yes} onPress={() => onAnswer(t.today.yes)} style={styles.half} />
            <Button label={t.today.no} onPress={() => onAnswer(t.today.no)} style={styles.half} />
          </View>
          <Button kind="quiet" label={t.today.writeAnswer} onPress={() => setWriting(true)} />
        </View>
      )}
    </Section>
  )
}

const styles = StyleSheet.create({
  gap: { gap: space.sm },
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
