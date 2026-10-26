import { useState } from 'react'
import { Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native'

import { useApp } from '../AppState'
import type { GlucoseContext } from '../data/types'
import { color, font, radius, space, touch } from '../theme'
import { Button } from './Button'
import { Txt } from './Txt'

const CONTEXTS: GlucoseContext[] = ['fasting', 'before_meal', 'after_meal', 'bedtime', 'overnight', 'random']

/*
 * A reading cannot be saved without saying when it was taken: a bare
 * number is not stored. Any number is accepted as typed; nothing judges it.
 */
export function GlucoseSheet({ visible, onSave, onClose }: {
  visible: boolean
  onSave: (r: { value_text: string; context: GlucoseContext }) => void
  onClose: () => void
}) {
  const { t, rtl } = useApp()
  const [value, setValue] = useState('')
  const [context, setContext] = useState<GlucoseContext | null>(null)
  const [tried, setTried] = useState(false)
  const valueOk = /^\d+(\.\d+)?$/.test(value.trim())

  const close = () => {
    setValue('')
    setContext(null)
    setTried(false)
    onClose()
  }
  const save = () => {
    setTried(true)
    if (!valueOk || !context) return
    onSave({ value_text: value.trim(), context })
    close()
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={close} transparent>
      <View style={styles.backdrop}>
        <ScrollView style={[styles.sheet, { direction: rtl ? 'rtl' : 'ltr' }]} contentContainerStyle={styles.content}>
          <Txt size={24} weight="bold" accessibilityRole="header">{t.glucose.title}</Txt>
          <Txt size={17} tone="ink2" nativeID="glucose-value-label">{t.glucose.value}</Txt>
          <TextInput
            testID="glucose-value"
            accessibilityLabel={t.glucose.value}
            accessibilityLabelledBy="glucose-value-label"
            value={value}
            onChangeText={setValue}
            keyboardType="decimal-pad"
            inputMode="decimal"
            maxLength={6}
            style={[styles.input, tried && !valueOk && styles.invalid]}
          />
          {tried && !valueOk && <Txt tone="ink" size={16} accessibilityLiveRegion="polite">{t.glucose.needValue}</Txt>}

          <Txt size={17} tone="ink2" style={{ marginTop: space.md }}>{t.glucose.when}</Txt>
          <View style={styles.chips} role="radiogroup" aria-label={t.glucose.when}>
            {CONTEXTS.map((c) => (
              <Pressable
                key={c}
                testID={`context-${c}`}
                role="radio"
                aria-checked={context === c}
                onPress={() => setContext(c)}
                style={[styles.chip, context === c && styles.chipOn]}
              >
                <Txt size={17} weight="medium">{t.glucose.contexts[c]}</Txt>
              </Pressable>
            ))}
          </View>
          {tried && !context && <Txt tone="ink" size={16} accessibilityLiveRegion="polite">{t.glucose.needContext}</Txt>}

          <View style={styles.actions}>
            <Button kind="primary" label={t.glucose.save} onPress={save} />
            <Button kind="quiet" label={t.glucose.cancel} onPress={close} />
          </View>
        </ScrollView>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  sheet: { maxHeight: '92%', backgroundColor: color.bg, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg },
  content: { padding: space.xl, gap: space.sm, paddingBottom: space.xxxl },
  input: {
    minHeight: 80,
    fontSize: 48,
    fontFamily: font.en.bold,
    color: color.ink,
    backgroundColor: color.surface,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: color.lineStrong,
    paddingHorizontal: space.lg,
    textAlign: 'left',
  },
  invalid: { borderColor: color.ink, borderWidth: 3 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: {
    minHeight: touch.min,
    paddingHorizontal: space.lg,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: color.line,
    backgroundColor: color.surface,
    justifyContent: 'center',
  },
  chipOn: { borderColor: color.ink, borderWidth: 2.5 },
  actions: { marginTop: space.xl, gap: space.sm },
})
