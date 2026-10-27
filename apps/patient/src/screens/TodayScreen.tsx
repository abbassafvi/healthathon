import { useCallback, useEffect, useState } from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'

import { useApp } from '../AppState'
import { Button } from '../components/Button'
import { GlucoseSheet } from '../components/GlucoseSheet'
import { MealCard } from '../components/MealCard'
import { QuestionCard } from '../components/QuestionCard'
import { Section } from '../components/Section'
import { TickRow } from '../components/TickRow'
import { Txt } from '../components/Txt'
import { captureId } from '../data/captureId'
import type { Today } from '../data/types'
import { fmt } from '../i18n'
import { color, radius, space } from '../theme'

/*
 * The app is this one screen: today's date set large, the medicines to
 * tick, the sugar readings, the day's question and a meal photo. It shows
 * only what the patient recorded today, as they recorded it. There is no
 * history, chart, average, score or colour that says good or bad.
 */
export function TodayScreen({ onOpenSurvey }: { onOpenSurvey: () => void }) {
  const { api, patientId, t, rtl, signOut } = useApp()
  const [today, setToday] = useState<Today | null>(null)
  const [sheet, setSheet] = useState(false)

  const load = useCallback(() => {
    if (patientId) void api.today(patientId).then(setToday)
  }, [api, patientId])
  useEffect(load, [load])

  if (!today || !patientId) return <View style={styles.page} />
  const d = new Date(`${today.date}T12:00:00`)
  const write = (p: Promise<unknown>) => void p.then(load)
  const firstName = today.patient.full_name.split(' ')[0]

  return (
    <ScrollView style={[styles.page, { direction: rtl ? 'rtl' : 'ltr' }]} contentContainerStyle={styles.content}>
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

      <Section title={t.today.medicines} help={today.items.length ? t.today.medicinesHelp : undefined}>
        {today.items.length === 0 ? (
          <Txt size={17} tone="ink2">{t.today.noChecklist}</Txt>
        ) : (
          today.items.map((item) => (
            <TickRow
              key={item.id}
              item={item}
              ticked={today.ticks[item.id] === true}
              onToggle={() => write(api.setTick(patientId, item.id, today.ticks[item.id] ? null : true, captureId()))}
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
          onAnswer={(a) => write(api.answer(patientId, today.question!.key, a, captureId()))}
        />
      )}

      <MealCard meals={today.meals} onAdd={(uri) => write(api.addMeal(patientId, uri, captureId()))} />

      {today.survey.open && (
        <Section title={t.today.survey}>
          {today.survey.done ? (
            <Txt size={17} tone="ink2">{t.today.surveyDone}</Txt>
          ) : (
            <Button label={t.today.surveyOpen} onPress={onOpenSurvey} testID="open-survey" />
          )}
        </Section>
      )}

      <Button kind="quiet" label={t.today.switchUser} onPress={signOut} />

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
  content: { padding: space.lg, paddingTop: 56, gap: space.lg, paddingBottom: space.xxxl, maxWidth: 640, width: '100%', alignSelf: 'center' },
  header: { paddingHorizontal: space.sm, marginBottom: space.sm },
  dayRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  dayNumber: { letterSpacing: -3 },
  todayDot: { width: 16, height: 16, borderRadius: radius.pill, backgroundColor: color.accentMark, marginTop: 24 },
  monthRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  reading: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm, flexWrap: 'wrap', paddingVertical: space.xs },
  readingWhen: { marginLeft: space.sm },
})
