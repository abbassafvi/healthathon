import { useState } from 'react'
import { Image, Modal, ScrollView, StyleSheet, View } from 'react-native'

import { useApp } from '../AppState'
import type { DocType } from '../data/types'
import { color, radius, space } from '../theme'
import { Button } from './Button'
import { ChoiceTile } from './ChoiceTile'
import { Txt } from './Txt'

const KINDS: DocType[] = ['prescription', 'lab_report']

/*
 * Before a photographed page is sent, the patient says what it is. The
 * reader is told the same thing, because a prescription and a lab report
 * are read by different rules, and guessing from the image is the kind of
 * inference this project does not make.
 */
export function DocumentSheet({ photo, onSend, onClose }: {
  photo: { uri: string; takenAt: Date } | null
  onSend: (docType: DocType) => void
  onClose: () => void
}) {
  const { t, rtl } = useApp()
  const [kind, setKind] = useState<DocType | null>(null)
  const [tried, setTried] = useState(false)

  const close = () => {
    setKind(null)
    setTried(false)
    onClose()
  }
  const send = () => {
    setTried(true)
    if (!photo || !kind) return
    onSend(kind)
    close()
  }

  return (
    <Modal visible={photo !== null} animationType="slide" onRequestClose={close} transparent>
      <View style={styles.backdrop}>
        <ScrollView style={[styles.sheet, { direction: rtl ? 'rtl' : 'ltr' }]} contentContainerStyle={styles.content}>
          <Txt size={24} weight="bold" accessibilityRole="header">{t.docs.add}</Txt>
          {photo && (
            <Image
              source={{ uri: photo.uri }}
              style={styles.photo}
              accessibilityIgnoresInvertColors
              testID="doc-preview"
            />
          )}

          <Txt size={17} tone="ink2" style={styles.gapAbove}>{t.docs.which}</Txt>
          <View style={styles.kinds} role="radiogroup" aria-label={t.docs.which}>
            {KINDS.map((k) => (
              <ChoiceTile
                key={k}
                label={k === 'prescription' ? t.docs.prescription : t.docs.labReport}
                checked={kind === k}
                onPress={() => setKind(k)}
                testID={`doc-kind-${k}`}
              />
            ))}
          </View>
          {tried && !kind && (
            <Txt size={16} accessibilityLiveRegion="polite" testID="doc-kind-needed">{t.docs.which}</Txt>
          )}

          <Txt size={15} tone="ink3" style={styles.gapAbove}>{t.docs.notAdvice}</Txt>
          <Button kind="primary" label={t.docs.send} onPress={send} testID="doc-send" />
          <Button kind="quiet" label={t.docs.cancel} onPress={close} testID="doc-cancel" />
        </ScrollView>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: { maxHeight: '90%', backgroundColor: color.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg },
  content: { padding: space.xl, gap: space.md },
  photo: { width: '100%', height: 200, borderRadius: radius.md, resizeMode: 'contain', backgroundColor: color.sunken },
  gapAbove: { marginTop: space.sm },
  kinds: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
})
