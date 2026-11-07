import { StyleSheet, View } from 'react-native'

import { useApp } from '../AppState'
import { isLatin } from '../i18n'
import { color, radius, space } from '../theme'
import { Txt } from './Txt'

/*
 * What a speech recogniser heard in the patient's own recording, shown
 * under it. The recording is the answer; this is the same words written
 * down, labelled so nobody takes it for something the patient typed.
 */
export function Transcript({ text }: { text: string }) {
  const { t, lang } = useApp()
  return (
    <View style={styles.box} testID="transcript">
      <Txt size={15} tone="ink3">{t.voice.heard}</Txt>
      <Txt size={18} latin={lang !== 'en' && isLatin(text)}>{text}</Txt>
    </View>
  )
}

const styles = StyleSheet.create({
  box: {
    gap: space.xs,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: color.line,
    borderRadius: radius.md,
    padding: space.sm,
  },
})
