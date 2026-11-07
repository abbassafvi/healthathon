import { useCallback, useEffect, useRef, useState } from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'

import { useApp } from '../AppState'
import { Button } from '../components/Button'
import { GlucoseSheet } from '../components/GlucoseSheet'
import { MealCard } from '../components/MealCard'
import { QuestionCard, type GivenAnswer } from '../components/QuestionCard'
import { Section } from '../components/Section'
import { TickRow } from '../components/TickRow'
import { Txt } from '../components/Txt'
import { captureId } from '../data/captureId'
import { ApiError } from '../data/httpApi'
import type { Today } from '../data/types'
import { fmt } from '../i18n'
import { color, radius, space } from '../theme'

/*
 * The app's main screen: today's date set large, the medicines to tick,
 * the sugar readings, the day's question and a meal photo. It shows only
 * what the patient recorded today, as they recorded it; earlier days have
 * their own screen, shown the same way. There is no chart, average, score
 * or colour that says good or bad.
 */
export function TodayScreen({ onOpenSurvey, onOpenPast, onOpenSettings, onOpenDocs }: {
  onOpenSurvey: () => void
  onOpenPast: () => void
  onOpenSettings: () => void
  onOpenDocs: () => void
}) {
  const { api, patientId, t, rtl, signOut } = useApp()
  const [today, setToday] = useState<Today | null>(null)
  const [sheet, setSheet] = useState(false)
  const [failed, setFailed] = useState<'load' | 'save' | null>(null)

  // Loads can overlap (the first one, then one after each write). Only the
  // newest may land, or a slow first load would undo a reading just saved.
  const latest = useRef(0)
  const load = useCallback(() => {
    if (!patientId) return
    const n = ++latest.current
    api
      .today(patientId)
      .then((t) => {
        if (n !== latest.current) return
        setToday(t)
        setFailed((f) => (f === 'load' ? null : f))
      })
      .catch((e: unknown) => {
        if (n !== latest.current) return
        // The token ran out, or names a patient this server does not know: sign in again.
        if (e instanceof ApiError && [401, 403, 404, 422].includes(e.status)) signOut()
        else setFailed('load')
      })
  }, [api, patientId, signOut])
  useEffect(load, [load])

  if (!patientId) return <View style={styles.page} />
  if (!today) {
    return (
      <View style={[styles.page, styles.center]}>
        {failed === 'load' && (
          <View style={styles.failedLoad} role="alert">
            <Txt size={18}>{t.today.loadFailed}</Txt>
            <Button kind="primary" label={t.today.retry} onPress={load} testID="retry" />
          </View>
        )}
      </View>
    )
  }
  const d = new Date(`${today.date}T12:00:00`)
  // A write that fails says so and leaves the screen as the server has it.
  const write = (p: Promise<unknown>) =>
    void p.then(
      () => {
        setFailed(null)
        load()
      },
      () => {
        setFailed('save')
        load()
      },
    )
  // A spoken answer goes to the clinic first, then the answer that carries it.
  const sendAnswer = async (key: string, a: GivenAnswer) => {
    const rec = a.audioUri ? await api.uploadRecording(patientId, a.audioUri, captureId()) : null
    await api.answer(patientId, key, a.text, captureId(), rec?.key)
  }
  const firstName = today.patient.full_name.split(' ')[0]

  return (
    <ScrollView style={[styles.page, { direction: rtl ? 'rtl' : 'ltr' }]} contentContainerStyle={styles.content}>
      <View style={styles.appBar}>
        <View style={styles.brand}>
          {/* The app's icon in small: a calendar page with today's dot. */}
          <View style={styles.mark} aria-hidden>
            <View style={styles.markPage}>
              <View style={styles.markDot} />
            </View>
          </View>
          <Txt latin size={17} weight="bold">{t.appName}</Txt>
        </View>
        <Button kind="quiet" label={t.settings.open} onPress={onOpenSettings} testID="open-settings" />
      </View>
      <View style={styles.header} accessible accessibilityRole="header" accessibilityLabel={`${t.days.short[d.getDay()]} ${d.getDate()} ${t.months[d.getMonth()]}`}>
        <View style={styles.dayRow}>
          <Txt latin size={92} weight="bold" style={styles.dayNumber}>{String(d.getDate())}</Txt>
          <View style={styles.todayDot} />
        </View>
        <View style={styles.monthRow}>
          <Txt size={24} weight="bold">{t.months[d.getMonth()]}</Txt>
          <Txt size={24} tone="ink3">{t.days.short[d.getDay()]}</Txt>
        </View>
        <Txt size={18} tone="ink2">{fmt(t.today.greeting, { name: firstName })}</Txt>
      </View>

      {failed === 'save' && (
        <View style={styles.failedSave} role="alert" testID="save-failed">
          <Txt size={17}>{t.today.saveFailed}</Txt>
        </View>
      )}

      <Section title={t.today.medicines} help={today.items.length ? t.today.medicinesHelp : undefined}>
        {today.items.length === 0 ? (
          <Txt size={17} tone="ink2">{t.today.noChecklist}</Txt>
        ) : (
          today.items.map((item) => (
            <TickRow
              key={item.id}
              item={item}
              value={today.ticks[item.id] ?? null}
              onChange={(v) => write(api.setTick(patientId, item.id, v, captureId()))}
            />
          ))
        )}
      </Section>

      <Section title={t.today.sugar}>
        {today.readings.length === 0 ? (
          <Txt size={17} tone="ink2">{t.today.noReadings}</Txt>
        ) : (
          today.readings.map((r) => (
            <View key={r.id} style={styles.reading} testID="reading">
              <Txt latin size={30} weight="bold">{r.value_text}</Txt>
              <Txt latin size={15} tone="ink3">mg/dL</Txt>
              <Txt size={17} tone="ink2" style={styles.readingWhen}>
                {t.glucose.contexts[r.context]}, {new Date(r.occurred_at).toTimeString().slice(0, 5)}
              </Txt>
            </View>
          ))
        )}
        <Button kind="primary" label={t.today.addReading} onPress={() => setSheet(true)} testID="add-reading" />
      </Section>

      {today.question && (
        <QuestionCard
          question={today.question}
          answer={today.answer}
          answerAudio={today.answer_audio_uri}
          answerTranscript={today.answer_transcript}
          onAnswer={(a) => write(sendAnswer(today.question!.key, a))}
        />
      )}

      <MealCard meals={today.meals} onAdd={(m) => write(api.addMeal(patientId, m, captureId()))} />

      {today.survey.open && (
        <Section title={t.today.survey}>
          {today.survey.done ? (
            <Txt size={17} tone="ink2">{t.today.surveyDone}</Txt>
          ) : (
            <Button label={t.today.surveyOpen} onPress={onOpenSurvey} testID="open-survey" />
          )}
        </Section>
      )}

      <Button label={t.docs.open} onPress={onOpenDocs} testID="open-docs" />
      <Button label={t.past.open} onPress={onOpenPast} testID="open-past" />

      <GlucoseSheet
        visible={sheet}
        onClose={() => setSheet(false)}
        onSave={(r) => write(api.addReading(patientId, r, captureId()))}
      />
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: color.bg },
  center: { justifyContent: 'center', padding: space.xl },
  failedLoad: { gap: space.lg, maxWidth: 480, alignSelf: 'center', width: '100%' },
  failedSave: {
    padding: space.lg,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: color.ink,
    backgroundColor: color.surface,
  },
  content: { padding: space.lg, paddingTop: 32, gap: space.lg, paddingBottom: space.xxxl, maxWidth: 640, width: '100%', alignSelf: 'center' },
  appBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md, paddingLeft: space.sm },
  brand: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  mark: { width: 26, height: 26, borderRadius: 7, backgroundColor: color.accent, alignItems: 'center', justifyContent: 'center' },
  markPage: { width: 13, height: 14, borderRadius: 3, backgroundColor: color.surface, alignItems: 'center', justifyContent: 'center', paddingTop: 2 },
  markDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: color.accent },
  header: { paddingHorizontal: space.sm, marginBottom: space.sm, gap: space.sm },
  dayRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  dayNumber: { letterSpacing: -3 },
  todayDot: { width: 16, height: 16, borderRadius: radius.pill, backgroundColor: color.accentMark, marginTop: 24 },
  monthRow: { flexDirection: 'row', alignItems: 'baseline', gap: space.md, flexWrap: 'wrap' },
  reading: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm, flexWrap: 'wrap', paddingVertical: space.xs },
  readingWhen: { marginLeft: space.sm },
})
