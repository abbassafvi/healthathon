import { useState } from 'react'
import { Image, Modal, ScrollView, StyleSheet, TextInput, View } from 'react-native'

import { useApp } from '../AppState'
import type { MealName } from '../data/types'
import { fmt } from '../i18n'
import { color, font, radius, space } from '../theme'
import { Button } from './Button'
import { ChoiceTile } from './ChoiceTile'
import { Txt } from './Txt'

const MEALS: MealName[] = ['breakfast', 'lunch', 'dinner', 'snack']

/* The API keeps photographs from the last three days; older ones belong to no day it shows. */
const MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000

/*
 * Before a meal photo is sent, the patient says which meal it is, as a
 * reading says when it was taken. The time is when the photo was taken,
 * so breakfast sent at noon is still breakfast at eight. Calories go only
 * if the patient knows them, as typed: nothing is estimated from the
 * photo, and nothing is added up.
 */
export function MealSheet({ photo, onSend, onClose, now = () => new Date() }: {
  photo: { uri: string; takenAt: Date } | null
  onSend: (m: { meal: MealName; takenAt: Date; calories: string | null }) => void
  onClose: () => void
  now?: () => Date
}) {
  const { t, rtl } = useApp()
  const [meal, setMeal] = useState<MealName | null>(null)
  const [calories, setCalories] = useState('')
  const [tried, setTried] = useState(false)
  const caloriesOk = calories.trim() === '' || /^\d{1,4}$/.test(calories.trim())
  const tooOld = photo ? now().getTime() - photo.takenAt.getTime() > MAX_AGE_MS : false

  const close = () => {
    setMeal(null)
    setCalories('')
    setTried(false)
    onClose()
  }
  const send = () => {
    setTried(true)
    if (!photo || !meal || !caloriesOk || tooOld) return
    onSend({ meal, takenAt: photo.takenAt, calories: calories.trim() || null })
    close()
  }

  return (
    <Modal visible={photo !== null} animationType="slide" onRequestClose={close} transparent>
      <View style={styles.backdrop}>
        <ScrollView style={[styles.sheet, { direction: rtl ? 'rtl' : 'ltr' }]} contentContainerStyle={styles.content}>
          <Txt size={24} weight="bold" accessibilityRole="header">{t.mealSheet.title}</Txt>
          {photo && (
            <>
              <Image source={{ uri: photo.uri }} style={styles.photo} accessibilityIgnoresInvertColors testID="meal-preview" />
              <Txt size={17} tone="ink2" testID="meal-taken">{takenLine(photo.takenAt, now(), t)}</Txt>
              {tooOld && <Txt size={16} accessibilityLiveRegion="polite">{t.mealSheet.tooOld}</Txt>}
            </>
          )}

          <Txt size={17} tone="ink2" style={styles.gapAbove}>{t.mealSheet.which}</Txt>
          <View style={styles.meals} role="radiogroup" aria-label={t.mealSheet.which}>
            {MEALS.map((m) => (
              <ChoiceTile
                key={m}
                label={t.mealSheet.names[m]}
                checked={meal === m}
                onPress={() => setMeal(m)}
                testID={`meal-${m}`}
                style={styles.mealChoice}
              />
            ))}
          </View>
          {tried && !meal && <Txt size={16} accessibilityLiveRegion="polite">{t.mealSheet.needMeal}</Txt>}

          <Txt size={17} tone="ink2" nativeID="meal-calories-label" style={styles.gapAbove}>{t.mealSheet.calories}</Txt>
          <Txt size={15} tone="ink3">{t.mealSheet.caloriesHelp}</Txt>
          <TextInput
            testID="meal-calories"
            accessibilityLabel={t.mealSheet.calories}
            accessibilityLabelledBy="meal-calories-label"
            value={calories}
            onChangeText={setCalories}
            keyboardType="number-pad"
            inputMode="numeric"
            maxLength={4}
            style={[styles.input, tried && !caloriesOk && styles.invalid]}
          />
          {tried && !caloriesOk && <Txt size={16} accessibilityLiveRegion="polite">{t.mealSheet.needNumber}</Txt>}

          <View style={styles.actions}>
            <Button kind="primary" label={t.mealSheet.send} onPress={send} disabled={tooOld} testID="send-meal" />
            <Button kind="quiet" label={t.mealSheet.cancel} onPress={close} testID="cancel-meal" />
          </View>
        </ScrollView>
      </View>
    </Modal>
  )
}

/* "Taken today at 13:10", "yesterday", or the date, the way the rest of the app writes them. */
export function takenLine(at: Date, now: Date, t: ReturnType<typeof useApp>['t']): string {
  const time = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const days = Math.round((day(now) - day(at)) / 86_400_000)
  if (days === 0) return fmt(t.mealSheet.takenToday, { time })
  if (days === 1) return fmt(t.mealSheet.takenYesterday, { time })
  return fmt(t.mealSheet.takenOn, { date: `${at.getDate()} ${t.months[at.getMonth()]}`, time })
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  sheet: { maxHeight: '94%', backgroundColor: color.bg, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg },
  content: { padding: space.xl, gap: space.sm, paddingBottom: space.xxxl },
  photo: { width: '100%', aspectRatio: 4 / 3, maxHeight: 240, borderRadius: radius.md, backgroundColor: color.sunken },
  gapAbove: { marginTop: space.md },
  meals: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  mealChoice: { flexBasis: '47%', flexGrow: 1 },
  input: {
    minHeight: 56,
    fontSize: 24,
    fontFamily: font.en.medium,
    color: color.ink,
    backgroundColor: color.surface,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: color.lineStrong,
    paddingHorizontal: space.lg,
    textAlign: 'left',
  },
  invalid: { borderColor: color.ink, borderWidth: 3 },
  actions: { marginTop: space.xl, gap: space.sm },
})
