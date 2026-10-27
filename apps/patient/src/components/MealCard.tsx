import * as ImagePicker from 'expo-image-picker'
import { Image, StyleSheet, View } from 'react-native'

import { useApp } from '../AppState'
import type { Meal } from '../data/types'
import { fmt } from '../i18n'
import { radius, space } from '../theme'
import { Button } from './Button'
import { Section } from './Section'
import { Txt } from './Txt'

/*
 * A photograph of a meal, sent as it is. No portion, calorie or nutrient
 * estimate is made anywhere, and none is ever shown.
 */
export function MealCard({ meals, onAdd }: { meals: Meal[]; onAdd: (uri: string) => void }) {
  const { t } = useApp()

  const pick = async () => {
    const camera = await ImagePicker.requestCameraPermissionsAsync().catch(() => ({ granted: false }))
    const result = camera.granted
      ? await ImagePicker.launchCameraAsync({ quality: 0.6 })
      : await ImagePicker.launchImageLibraryAsync({ quality: 0.6, mediaTypes: ['images'] })
    if (!result.canceled && result.assets[0]) onAdd(result.assets[0].uri)
  }

  return (
    <Section title={t.today.meal} help={t.today.mealHelp}>
      {meals.length > 0 && (
        <>
          <View style={styles.row}>
            {meals.map((m) => (
              <Image key={m.id} source={{ uri: m.uri }} style={styles.thumb} accessibilityIgnoresInvertColors />
            ))}
          </View>
          <Txt size={16} tone="ink2">{meals.length === 1 ? t.today.mealsTodayOne : fmt(t.today.mealsToday, { n: meals.length })}</Txt>
        </>
      )}
      <Button label={t.today.addMeal} onPress={() => void pick()} testID="add-meal" />
    </Section>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  thumb: { width: 88, height: 88, borderRadius: radius.md },
})
