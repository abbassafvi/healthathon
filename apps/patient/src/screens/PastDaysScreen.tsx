import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Image, ScrollView, StyleSheet, View } from 'react-native'

import { useApp } from '../AppState'
import { Button } from '../components/Button'
import { Txt } from '../components/Txt'
import type { PastDay } from '../data/types'
import { isLatin, shownAnswer } from '../i18n'
import { color, radius, space } from '../theme'

/*
 * Earlier days, newest first, each exactly as the patient recorded it:
 * which medicines they marked, the readings, their answers, their photos.
 * Nothing is added up, compared or coloured, and a day with nothing on it
 * says so in words rather than as a gap.
 */
export function PastDaysScreen({ onBack }: { onBack: () => void }) {
  const { api, patientId, t, rtl } = useApp()
  const [days, setDays] = useState<PastDay[] | null>(null)
  const [next, setNext] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [loading, setLoading] = useState(false)
  const latest = useRef(0)

  const load = useCallback(
    (before?: string) => {
      if (!patientId) return
      const n = ++latest.current
      setLoading(true)
      api
        .pastDays(patientId, before)
        .then((page) => {
          if (n !== latest.current) return
          setDays((d) => (before ? [...(d ?? []), ...page.days] : page.days))
          setNext(page.next_before)
          setFailed(false)
        })
        .catch(() => n === latest.current && setFailed(true))
        .finally(() => n === latest.current && setLoading(false))
    },
    [api, patientId],
  )
  useEffect(() => load(), [load])

  return (
    <ScrollView style={[styles.page, { direction: rtl ? 'rtl' : 'ltr' }]} contentContainerStyle={styles.content}>
      <Button kind="quiet" label={t.past.back} onPress={onBack} testID="back-to-today" style={styles.back} />
      <View style={styles.header}>
        <Txt size={34} weight="bold" accessibilityRole="header">{t.past.title}</Txt>
        <Txt size={18} tone="ink2">{t.past.intro}</Txt>
      </View>

      {failed && (
        <View style={styles.failed} role="alert">
          <Txt size={18}>{t.past.loadFailed}</Txt>
          <Button kind="primary" label={t.today.retry} onPress={() => load(days?.length ? next ?? undefined : undefined)} testID="retry" />
        </View>
      )}
      {days !== null && days.length === 0 && !failed && <Txt size={18} tone="ink2">{t.past.none}</Txt>}
      {days?.map((d) => <Day key={d.date} day={d} />)}
      {next && !failed && (
        <Button label={t.past.more} onPress={() => load(next)} disabled={loading} testID="more-days" />
      )}
    </ScrollView>
  )
}

function Day({ day }: { day: PastDay }) {
  const { t, lang } = useApp()
  const d = new Date(`${day.date}T12:00:00`)
  const empty = !day.ticks.length && !day.readings.length && !day.answers.length && !day.meals.length
  const time = (iso: string) => new Date(iso).toTimeString().slice(0, 5)
  return (
    <View style={styles.day} testID={`day-${day.date}`}>
      <View style={styles.dayHeader} accessible accessibilityRole="header" accessibilityLabel={`${t.days.short[d.getDay()]} ${d.getDate()} ${t.months[d.getMonth()]}`}>
        <Txt latin size={44} weight="bold" style={styles.dayNumber}>{String(d.getDate())}</Txt>
        <Txt size={20} weight="bold">{t.months[d.getMonth()]}</Txt>
        <Txt size={20} tone="ink3">{t.days.short[d.getDay()]}</Txt>
      </View>

      {empty && <Txt size={17} tone="ink2">{t.past.nothing}</Txt>}

      {day.ticks.length > 0 && (
        <Group title={t.today.medicines}>
          {day.ticks.map((tick) => (
            <View key={tick.item.id} style={styles.row} testID={`past-tick-${tick.item.id}`}>
              <View style={styles.drug}>
                <Txt latin size={18} weight="bold">{tick.item.drug_text}</Txt>
                <Txt latin size={16} tone="ink2">
                  {[tick.item.dose_text, tick.item.schedule_text].filter(Boolean).join('  ')}
                </Txt>
              </View>
              {tick.ticked === null ? (
                <Txt size={18} tone="ink2">{t.past.notMarked}</Txt>
              ) : (
                <Txt size={18} weight="medium">{tick.ticked ? t.today.ticked : t.today.notTaken}</Txt>
              )}
            </View>
          ))}
        </Group>
      )}

      {day.readings.length > 0 && (
        <Group title={t.today.sugar}>
          {day.readings.map((r) => (
            <View key={r.id} style={styles.reading} testID="past-reading">
              <Txt latin size={26} weight="bold">{r.value_text}</Txt>
              <Txt latin size={15} tone="ink3">mg/dL</Txt>
              <Txt size={17} tone="ink2">{t.glucose.contexts[r.context]}, {time(r.occurred_at)}</Txt>
            </View>
          ))}
        </Group>
      )}

      {day.answers.length > 0 && (
        <Group title={t.past.answers}>
          {day.answers.map((a, i) => {
            const answer = shownAnswer(a.answer_text, t)
            return (
              <View key={i} style={styles.answer}>
                <Txt size={16} tone="ink2">{a.question.text[lang] ?? a.question.text.en}</Txt>
                <Txt size={18} latin={lang !== 'en' && isLatin(answer)}>{answer}</Txt>
              </View>
            )
          })}
        </Group>
      )}

      {day.meals.length > 0 && (
        <Group title={t.past.meals}>
          <View style={styles.meals}>
            {day.meals.map((m) => (
              <Image key={m.id} source={{ uri: thumbnail(m.uri) }} style={styles.thumb} accessibilityIgnoresInvertColors />
            ))}
          </View>
        </Group>
      )}
    </View>
  )
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.group}>
      <Txt size={16} weight="bold" tone="ink2">{title}</Txt>
      {children}
    </View>
  )
}

/* A photo kept by the clinic is asked for small; one still on the phone is shown as it is. */
function thumbnail(uri: string): string {
  return /^https?:/.test(uri) ? `${uri}${uri.includes('?') ? '&' : '?'}width=320` : uri
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: color.bg },
  content: { padding: space.lg, paddingTop: 40, gap: space.xl, paddingBottom: space.xxxl, maxWidth: 640, width: '100%', alignSelf: 'center' },
  back: { alignSelf: 'flex-start' },
  header: { gap: space.sm, paddingHorizontal: space.xs },
  failed: { gap: space.lg, padding: space.lg, borderRadius: radius.md, borderWidth: 1.5, borderColor: color.ink, backgroundColor: color.surface },
  day: { gap: space.md, paddingTop: space.lg, borderTopWidth: 1, borderTopColor: color.line },
  dayHeader: { flexDirection: 'row', alignItems: 'baseline', gap: space.md, flexWrap: 'wrap' },
  dayNumber: { letterSpacing: -1.5 },
  group: { gap: space.sm, paddingHorizontal: space.xs },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md, paddingVertical: space.xs },
  drug: { flexShrink: 1 },
  reading: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm, flexWrap: 'wrap' },
  answer: { gap: 2 },
  meals: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  thumb: { width: 88, height: 88, borderRadius: radius.md, backgroundColor: color.sunken },
})
