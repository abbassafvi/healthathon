import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native'

import { color, radius, space, touch, type Lang } from '../theme'
import { Txt } from './Txt'

/*
 * One choice among a few: a language, a patient. It is drawn the way Taken
 * and Not taken are, a ring that fills and a tile that turns ink once
 * chosen, so the app has one way of showing what is selected. A heavier
 * border alone is too faint a cue for older eyes.
 */
export function ChoiceTile({ label, sub, lang, latin, checked, onPress, testID, style }: {
  label: string
  sub?: string
  lang?: Lang
  latin?: boolean
  checked: boolean
  onPress: () => void
  testID?: string
  style?: ViewStyle
}) {
  const tone = checked ? 'accentInk' : 'ink'
  return (
    <Pressable
      role="radio"
      aria-checked={checked}
      accessibilityLabel={label}
      testID={testID}
      onPress={onPress}
      style={({ pressed }) => [styles.tile, checked ? styles.on : styles.off, pressed && styles.pressed, style]}
    >
      <View style={[styles.mark, checked ? styles.markOn : styles.markOff]} />
      <View style={styles.text}>
        <Txt lang={lang} latin={latin} size={20} weight="medium" tone={tone}>{label}</Txt>
        {sub && <Txt latin size={14} tone={checked ? 'accentInk' : 'ink3'}>{sub}</Txt>}
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  tile: {
    minHeight: touch.large,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderRadius: radius.md,
    borderWidth: 1.5,
  },
  off: { backgroundColor: color.surface, borderColor: color.lineStrong },
  on: { backgroundColor: color.ink, borderColor: color.ink },
  pressed: { opacity: 0.85 },
  mark: { width: 18, height: 18, borderRadius: radius.pill },
  markOn: { backgroundColor: color.accentInk },
  markOff: { borderWidth: 2, borderColor: color.lineStrong },
  text: { flexShrink: 1 },
})
