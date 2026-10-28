import { useEffect, useState } from 'react'
import { ScrollView, StyleSheet, TextInput, View } from 'react-native'

import { useApp } from '../AppState'
import { Button } from '../components/Button'
import { Playback, Recorder } from '../components/Recorder'
import { Txt } from '../components/Txt'
import { captureId } from '../data/captureId'
import type { SurveyQuestion } from '../data/types'
import { useBackButton } from '../useBackButton'
import { color, font, lineHeightFactor, radius, space } from '../theme'

/*
 * The short weekly survey. Each question is answered in words or spoken;
 * answers go as written and recordings as recorded. Nothing is added up,
 * and nothing transcribes a recording.
 */
export function SurveyScreen({ onDone }: { onDone: () => void }) {
  const { api, patientId, t, lang, rtl } = useApp()
  const [questions, setQuestions] = useState<SurveyQuestion[]>([])
  const [answers, setAnswers] = useState<Record<string, string>>({})
  // Question key -> a recording on this phone, kept for the question.
  const [spoken, setSpoken] = useState<Record<string, string>>({})
  const [speaking, setSpeaking] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [id] = useState(captureId)
  const [failed, setFailed] = useState(false)
  useBackButton(onDone)

  useEffect(() => {
    if (patientId) void api.surveyQuestions(patientId).then(setQuestions)
  }, [api, patientId])

  const complete = questions.length > 0 && questions.every((q) => answers[q.key]?.trim() || spoken[q.key])

  // Recordings go to the clinic first, each with a capture id of its own, then the answers that carry them.
  const submit = async () => {
    if (!patientId) return
    setFailed(false)
    setSending(true)
    try {
      const keys: Record<string, string> = {}
      for (const [i, q] of questions.entries()) {
        if (spoken[q.key]) keys[q.key] = (await api.uploadRecording(patientId, spoken[q.key], `${id}-${i}`)).key
      }
      const written = Object.fromEntries(Object.entries(answers).filter(([, v]) => v.trim()))
      // The same capture id on a retry, so the answers are stored once.
      await api.submitSurvey(patientId, written, id, keys)
      onDone()
    } catch {
      setFailed(true)
    } finally {
      setSending(false)
    }
  }

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
          {spoken[q.key] ? (
            <View style={styles.spoken} testID={`spoken-${q.key}`}>
              <Playback uri={spoken[q.key]} />
              <Button
                kind="quiet"
                label={t.voice.remove}
                onPress={() => setSpoken(({ [q.key]: _gone, ...rest }) => rest)}
                testID={`remove-${q.key}`}
                style={styles.inline}
              />
            </View>
          ) : speaking === q.key ? (
            <Recorder
              sendLabel={t.voice.keep}
              onDone={(uri) => {
                setSpoken((s) => ({ ...s, [q.key]: uri }))
                setSpeaking(null)
              }}
              onCancel={() => setSpeaking(null)}
            />
          ) : (
            <Button kind="quiet" label={t.voice.speak} onPress={() => setSpeaking(q.key)} testID={`speak-${q.key}`} style={styles.inline} />
          )}
        </View>
      ))}
      <Button
        kind="primary"
        label={t.survey.done}
        disabled={!complete || sending}
        onPress={() => void submit()}
      />
      {failed && (
        <View style={styles.failed} role="alert" testID="survey-failed">
          <Txt size={17}>{t.today.saveFailed}</Txt>
        </View>
      )}
      <Button kind="quiet" label={t.survey.back} onPress={onDone} />
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: color.bg },
  content: { padding: space.xl, paddingTop: 56, gap: space.lg, maxWidth: 640, width: '100%', alignSelf: 'center' },
  spoken: { gap: space.xs },
  inline: { alignSelf: 'flex-start', paddingHorizontal: 0 },
  failed: { padding: space.lg, borderRadius: radius.md, borderWidth: 1.5, borderColor: color.ink, backgroundColor: color.surface },
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
