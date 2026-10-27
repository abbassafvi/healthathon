import { Pressable, StyleSheet, View } from 'react-native'

import { useApp } from '../AppState'
import type { ChecklistItem } from '../data/types'
import { color, radius, space, touch } from '../theme'
import { Txt } from './Txt'

/* true: taken. false: not taken. null: nothing recorded yet. */
export type TickValue = boolean | null

/*
 * One medicine, exactly as printed, and two answers the size of a thumb:
 * Taken and Not taken. Both look the same, chosen or not, so neither reads
 * as the right answer. Tapping the chosen one again clears it.
 */
export function TickRow({ item, value, onChange }: { item: ChecklistItem; value: TickValue; onChange: (v: TickValue) => void }) {
  const { t, rtl } = useApp()
  const what = [item.drug_text, item.dose_text, item.schedule_text].filter(Boolean).join(' ')
  const choice = (v: boolean, label: string) => {
    const on = value === v
    return (
      <Pressable
        role="button"
        aria-pressed={on}
        accessibilityLabel={`${label}, ${what}`}
        testID={`tick-${item.id}-${v ? 'taken' : 'not-taken'}`}
        onPress={() => onChange(on ? null : v)}
        style={({ pressed }) => [styles.choice, on ? styles.choiceOn : styles.choiceOff, pressed && styles.pressed]}
      >
        <View style={[styles.mark, on ? styles.markOn : styles.markOff]} />
        <Txt size={18} weight="medium" tone={on ? 'accentInk' : 'ink'}>{label}</Txt>
      </Pressable>
    )
  }
  return (
    <View role="group" aria-label={what} style={[styles.card, value !== null && styles.cardAnswered]} testID={`tick-${item.id}`}>
      <View style={styles.text}>
        <Txt latin size={20} weight="bold">{item.drug_text}</Txt>
        {/* Printed in Latin script, so dose then schedule, as on the page, even in Urdu. */}
        <View style={[styles.meta, { justifyContent: rtl ? 'flex-end' : 'flex-start' }]}>
          <Txt latin size={17}>{item.dose_text}</Txt>
          {item.schedule_text && <Txt latin size={17} tone="ink2">{item.schedule_text}</Txt>}
        </View>
      </View>
      <View style={styles.choices}>
        {choice(true, t.today.ticked)}
        {choice(false, t.today.notTaken)}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    gap: space.md,
    padding: space.lg,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: color.line,
    backgroundColor: color.surface,
  },
  cardAnswered: { borderColor: color.lineStrong },
  text: { gap: 2 },
  meta: { flexDirection: 'row', gap: space.md, direction: 'ltr' },
  choices: { flexDirection: 'row', gap: space.sm },
  choice: {
    flex: 1,
    minHeight: touch.min,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    borderWidth: 1.5,
  },
  choiceOff: { backgroundColor: color.surface, borderColor: color.lineStrong },
  choiceOn: { backgroundColor: color.ink, borderColor: color.ink },
  pressed: { opacity: 0.85 },
  mark: { width: 18, height: 18, borderRadius: radius.pill },
  markOn: { backgroundColor: color.accentInk },
  markOff: { borderWidth: 2, borderColor: color.lineStrong },
})
