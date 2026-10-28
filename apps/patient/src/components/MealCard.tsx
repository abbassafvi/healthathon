import * as ImagePicker from 'expo-image-picker'
import { useState } from 'react'
import { Image, StyleSheet, View } from 'react-native'

import { useApp } from '../AppState'
import type { Meal, NewMeal } from '../data/types'
import { fmt } from '../i18n'
import { radius, space } from '../theme'
import { Button } from './Button'
import { MealSheet } from './MealSheet'
import { Section } from './Section'
import { Txt } from './Txt'

/*
 * A photograph of a meal, sent as it is, with which meal it is and when
 * it was taken. No portion, calorie or nutrient estimate is made anywhere;
 * calories appear only if the patient typed them.
 */
export function MealCard({ meals, onAdd }: { meals: Meal[]; onAdd: (m: NewMeal) => void }) {
  const { t } = useApp()
  const [photo, setPhoto] = useState<{ uri: string; takenAt: Date } | null>(null)

  const pick = async () => {
    const camera = await ImagePicker.requestCameraPermissionsAsync().catch(() => ({ granted: false }))
    const result = camera.granted
      ? await ImagePicker.launchCameraAsync({ quality: 0.6, exif: true })
      : await ImagePicker.launchImageLibraryAsync({ quality: 0.6, mediaTypes: ['images'], exif: true })
    const asset = !result.canceled ? result.assets[0] : undefined
    if (asset) setPhoto({ uri: asset.uri, takenAt: photoTime(asset.exif, new Date()) })
  }

  return (
    <Section title={t.today.meal} help={t.today.mealHelp}>
      {meals.length > 0 && (
        <>
          <View style={styles.row}>
            {meals.map((m) => <MealThumb key={m.id} meal={m} />)}
          </View>
          <Txt size={16} tone="ink2">{meals.length === 1 ? t.today.mealsTodayOne : fmt(t.today.mealsToday, { n: meals.length })}</Txt>
        </>
      )}
      <Button label={t.today.addMeal} onPress={() => void pick()} testID="add-meal" />
      <MealSheet
        photo={photo}
        onClose={() => setPhoto(null)}
        onSend={(m) => photo && onAdd({ uri: photo.uri, ...m })}
      />
    </Section>
  )
}

/* A sent meal photo, captioned with its meal, its time and any calories typed. */
export function MealThumb({ meal }: { meal: Meal }) {
  const { t } = useApp()
  const at = new Date(meal.occurred_at)
  const time = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
  return (
    <View style={styles.thumbBox} testID={`meal-thumb-${meal.id}`}>
      <Image source={{ uri: meal.uri }} style={styles.thumb} accessibilityIgnoresInvertColors />
      <Txt size={15} weight="medium">{meal.meal ? t.mealSheet.names[meal.meal] : t.today.meal}</Txt>
      <Txt latin size={14} tone="ink2">{time}</Txt>
      {meal.calories_text && <Txt latin size={14} tone="ink2">{fmt(t.mealSheet.kcal, { n: meal.calories_text })}</Txt>}
    </View>
  )
}

/*
 * When the photo was taken, from the camera's own record of it, or now when
 * there is none (the web build, some galleries). A time ahead of now is a
 * wrong camera clock, so now stands in for it.
 */
export function photoTime(exif: Record<string, unknown> | null | undefined, now: Date): Date {
  const raw = exif?.DateTimeOriginal ?? exif?.DateTime
  const m = typeof raw === 'string' ? raw.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/) : null
  if (!m) return now
  const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])
  return Number.isNaN(d.getTime()) || d > now ? now : d
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  thumbBox: { width: 96, gap: 2 },
  thumb: { width: 96, height: 96, borderRadius: radius.md, marginBottom: space.xs },
})
