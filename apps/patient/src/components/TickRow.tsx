import { Pressable, StyleSheet, View } from 'react-native'

import { useApp } from '../AppState'
import type { ChecklistItem } from '../data/types'
import { fmt } from '../i18n'
import { color, radius, space, touch } from '../theme'
import { Txt } from './Txt'

/*
 * One medicine, exactly as printed, and a tick the size of a thumb. Tapping
 * again removes the tick. No colour means taken or missed: a filled circle
 * with a check, or an empty ring, plus the word.
 */
export function TickRow({ item, ticked, onToggle }: { item: ChecklistItem; ticked: boolean; onToggle: () => void }) {
  const { t } = useApp()
  const state = ticked ? t.today.ticked : t.today.notTicked
  return (
    <Pressable
      role="checkbox"
      aria-checked={ticked}
      accessibilityLabel={fmt(t.today.tickLabel, { drug: item.drug_text, dose: item.dose_text, schedule: item.schedule_text ?? '', state })}
      testID={`tick-${item.id}`}
      onPress={onToggle}
      style={({ pressed }) => [styles.row, ticked && styles.rowTicked, pressed && { opacity: 0.85 }]}
    >
      <View style={styles.text}>
        <Txt latin size={20} weight="bold">{item.drug_text}</Txt>
        <View style={styles.meta}>
          <Txt latin size={17}>{item.dose_text}</Txt>
          {item.schedule_text && <Txt latin size={17} tone="ink2">{item.schedule_text}</Txt>}
        </View>
        <Txt size={15} tone="ink3">{state}</Txt>
      </View>
      <View style={[styles.mark, ticked ? styles.markOn : styles.markOff]}>
        {ticked && <Txt latin size={24} weight="bold" tone="accentInk">✓</Txt>}
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  row: {
    minHeight: touch.large + 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.lg,
    padding: space.lg,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: color.line,
    backgroundColor: color.surface,
  },
  rowTicked: { borderColor: color.ink },
  text: { flex: 1, gap: 2 },
  meta: { flexDirection: 'row', gap: space.md },
  mark: { width: 48, height: 48, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  markOn: { backgroundColor: color.ink },
  markOff: { borderWidth: 3, borderColor: color.lineStrong },
})
