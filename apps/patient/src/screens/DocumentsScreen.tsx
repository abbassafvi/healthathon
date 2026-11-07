import * as ImagePicker from 'expo-image-picker'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'

import { useApp } from '../AppState'
import { Button } from '../components/Button'
import { DocumentCard } from '../components/DocumentCard'
import { DocumentSheet } from '../components/DocumentSheet'
import { Txt } from '../components/Txt'
import { captureId } from '../data/captureId'
import type { DocType, PatientDoc } from '../data/types'
import { color, space } from '../theme'
import { useBackButton } from '../useBackButton'

/* How often the phone asks whether the clinic has finished reading a page. */
const POLL_MS = 1500

/*
 * The patient's own documents: a prescription or report photographed here
 * and sent to the clinic, and every page already on the record.
 *
 * Reading takes seconds, so the send returns at once and the phone polls.
 * What comes back is shown as written, each reading saying whether a
 * clinician has checked it. Nothing here is added up, compared, ranged or
 * coloured.
 */
export function DocumentsScreen({ onBack }: { onBack: () => void }) {
  const { api, patientId, t, rtl } = useApp()
  const [docs, setDocs] = useState<PatientDoc[] | null>(null)
  const [photo, setPhoto] = useState<{ uri: string; takenAt: Date } | null>(null)
  const [stage, setStage] = useState<'idle' | 'sending' | 'reading' | 'failed'>('idle')
  const [failed, setFailed] = useState(false)
  const latest = useRef(0)
  useBackButton(onBack)

  const load = useCallback(() => {
    if (!patientId) return
    const n = ++latest.current
    api
      .documents(patientId)
      .then((d) => {
        if (n !== latest.current) return
        setDocs(d)
        setFailed(false)
      })
      .catch(() => n === latest.current && setFailed(true))
  }, [api, patientId])
  useEffect(() => load(), [load])

  const pick = async () => {
    const camera = await ImagePicker.requestCameraPermissionsAsync().catch(() => ({ granted: false }))
    const result = camera.granted
      ? await ImagePicker.launchCameraAsync({ quality: 0.8 })
      : await ImagePicker.launchImageLibraryAsync({ quality: 0.8, mediaTypes: ['images'] })
    const asset = !result.canceled ? result.assets[0] : undefined
    if (asset) setPhoto({ uri: asset.uri, takenAt: new Date() })
  }

  /*
   * Send the page, then ask until the clinic has read it. A failure
   * leaves the photograph on the phone, so the patient can send it again.
   */
  const send = async (docType: DocType) => {
    if (!patientId || !photo) return
    setStage('sending')
    try {
      let status = await api.sendDocument(patientId, { uri: photo.uri, docType, takenAt: photo.takenAt }, captureId())
      setStage('reading')
      while (status.stage === 'uploading' || status.stage === 'reading') {
        await new Promise((r) => setTimeout(r, POLL_MS))
        status = await api.uploadStatus(patientId, status.id)
      }
      setStage(status.stage === 'failed' ? 'failed' : 'idle')
      load()
    } catch {
      setStage('failed')
    }
  }

  return (
    <ScrollView style={[styles.page, { direction: rtl ? 'rtl' : 'ltr' }]} contentContainerStyle={styles.content}>
      <Button kind="quiet" label={t.docs.back} onPress={onBack} testID="docs-back" style={styles.back} />
      <View style={styles.header}>
        <Txt size={34} weight="bold" accessibilityRole="header">{t.docs.title}</Txt>
        <Txt size={18} tone="ink2">{t.docs.help}</Txt>
      </View>

      <Button kind="primary" label={t.docs.add} onPress={() => void pick()} disabled={stage === 'sending' || stage === 'reading'} testID="docs-add" />

      {stage === 'sending' && <Txt size={17} accessibilityLiveRegion="polite" testID="docs-sending">{t.docs.sending}</Txt>}
      {stage === 'reading' && <Txt size={17} accessibilityLiveRegion="polite" testID="docs-reading">{t.docs.reading}</Txt>}
      {stage === 'failed' && (
        <View style={styles.failed} role="alert">
          <Txt size={18} testID="docs-failed">{t.docs.failed}</Txt>
        </View>
      )}

      {failed && (
        <View style={styles.failed} role="alert">
          <Txt size={18}>{t.docs.failed}</Txt>
          <Button kind="primary" label={t.today.retry} onPress={load} testID="docs-retry" />
        </View>
      )}

      {docs !== null && docs.length === 0 && !failed && (
        <Txt size={18} tone="ink2" testID="docs-empty">{t.docs.empty}</Txt>
      )}
      {docs?.map((d) => <DocumentCard key={d.id} doc={d} />)}

      {!!docs?.length && (
        <Txt size={15} tone="ink3" style={styles.footnote}>{t.docs.notAdvice}</Txt>
      )}

      <DocumentSheet photo={photo} onClose={() => setPhoto(null)} onSend={(k) => void send(k)} />
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: color.bg },
  content: { padding: space.lg, gap: space.lg, paddingBottom: space.xxxl },
  back: { alignSelf: 'flex-start' },
  header: { gap: space.sm },
  failed: { gap: space.md },
  footnote: { marginTop: space.sm },
})
