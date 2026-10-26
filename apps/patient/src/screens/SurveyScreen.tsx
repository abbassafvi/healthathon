import { useEffect, useState } from 'react'
import { ScrollView, StyleSheet, TextInput, View } from 'react-native'

import { useApp } from '../AppState'
import { Button } from '../components/Button'
import { Txt } from '../components/Txt'
import { captureId } from '../data/captureId'
import type { SurveyQuestion } from '../data/types'
import { color, font, lineHeightFactor, radius, space } from '../theme'

/* The short weekly survey. Answers go as written; nothing is added up. */
export function SurveyScreen({ onDone }: { onDone: () => void }) {
  const { api, patientId, t, lang, rtl } = useApp()
  const [questions, setQuestions] = useState<SurveyQuestion[]>([])
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [id] = useState(captureId)

  useEffect(() => {
    if (patientId) void api.surveyQuestions(patientId).then(setQuestions)
  }, [api, patientId])

  const complete = questions.length > 0 && questions.every((q) => answers[q.key]?.trim())

  return (
    <ScrollView style={[styles.page, { direction: rtl ? 'rtl' : 'ltr' }]} contentContainerStyle={styles.content}>
      <Txt size={32} weight="bold" accessibilityRole="header">{t.survey.title}</Txt>
      {questions.map((q, i) => (
        <View key={q.key} style={styles.q}>
          <Txt size={19} weight="medium" nativeID={`q-${i}`}>{q.text[lang]}</Txt>
          <TextInput
            testID={`survey-${q.key}`}
            accessibilityLabel={q.text[lang]}
            accessibilityLabelledBy={`q-${i}`}
            value={answers[q.key] ?? ''}
            onChangeText={(v) => setAnswers((a) => ({ ...a, [q.key]: v }))}
            style={[styles.input, { fontFamily: font[lang].regular, lineHeight: Math.round(18 * lineHeightFactor[lang]), textAlign: rtl ? 'right' : 'left' }]}
          />
        </View>
      ))}
      <Button
        kind="primary"
        label={t.survey.done}
        disabled={!complete}
        onPress={() => patientId && void api.submitSurvey(patientId, answers, id).then(onDone)}
      />
      <Button kind="quiet" label={t.survey.back} onPress={onDone} />
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: color.bg },
  content: { padding: space.xl, paddingTop: 56, gap: space.lg, maxWidth: 640, width: '100%', alignSelf: 'center' },
  q: { backgroundColor: color.surface, borderRadius: radius.lg, padding: space.xl, gap: space.md },
  input: {
    minHeight: 56,
    fontSize: 18,
    color: color.ink,
    backgroundColor: color.bg,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: color.lineStrong,
    paddingHorizontal: space.md,
  },
})
