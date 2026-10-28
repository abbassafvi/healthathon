import { useEffect, useState } from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'

import { expo } from '../../app.json'
import { useApp } from '../AppState'
import { Button } from '../components/Button'
import { ChoiceTile } from '../components/ChoiceTile'
import { Txt } from '../components/Txt'
import type { PatientRef } from '../data/types'
import { fmt, STRINGS } from '../i18n'
import { color, radius, space, type Lang } from '../theme'
import { useBackButton } from '../useBackButton'

const LANGS: Lang[] = ['en', 'hi', 'ur']

/*
 * Settings: the language, which changes the app at once; the patient this
 * phone is set up for; and what the app is and is not. Each choice is a
 * large target, and the screen says in words that it gives no advice.
 * Changing the patient is a quiet button that asks first, because one tap
 * would otherwise drop a patient back on the first screen.
 */
export function SettingsScreen({ onBack }: { onBack: () => void }) {
  const { api, patientId, lang, t, rtl, choose, signOut } = useApp()
  const [patient, setPatient] = useState<PatientRef | null>(null)
  const [confirming, setConfirming] = useState(false)
  useBackButton(onBack)

  useEffect(() => {
    api.patients().then((all) => setPatient(all.find((p) => p.id === patientId) ?? null), () => {})
  }, [api, patientId])

  return (
    <ScrollView style={[styles.page, { direction: rtl ? 'rtl' : 'ltr' }]} contentContainerStyle={styles.content}>
      <Button kind="quiet" label={t.settings.back} onPress={onBack} testID="settings-back" style={styles.back} />
      <Txt size={34} weight="bold" accessibilityRole="header">{t.settings.title}</Txt>

      <View style={styles.block}>
        <Txt size={20} weight="bold">{t.settings.language}</Txt>
        <Txt size={16} tone="ink2">{t.settings.languageHelp}</Txt>
        <View style={styles.langs} role="radiogroup" aria-label={t.settings.language}>
          {LANGS.map((l) => (
            <ChoiceTile
              key={l}
              label={STRINGS[l].langName}
              lang={l}
              checked={lang === l}
              onPress={() => choose({ lang: l, patientId })}
              testID={`settings-lang-${l}`}
              style={styles.choice}
            />
          ))}
        </View>
      </View>

      <View style={styles.block}>
        <Txt size={20} weight="bold">{t.settings.phone}</Txt>
        {patient && (
          <Txt size={18} testID="set-up-for">
            {fmt(t.settings.setUpFor, { name: patient.full_name, reg: patient.registration_no })}
          </Txt>
        )}
        <Txt size={15} tone="ink3">{t.settings.changeHelp}</Txt>
        {confirming ? (
          <View style={styles.confirm}>
            <Txt size={17}>{t.settings.changeConfirm}</Txt>
            <Button label={t.settings.changeYes} onPress={signOut} testID="confirm-change" />
            <Button kind="quiet" label={t.settings.changeKeep} onPress={() => setConfirming(false)} testID="keep-patient" style={styles.inline} />
          </View>
        ) : (
          <Button kind="quiet" label={t.settings.change} onPress={() => setConfirming(true)} testID="change-patient" style={styles.inline} />
        )}
      </View>

      <View style={styles.block}>
        <Txt size={20} weight="bold">{t.settings.about}</Txt>
        <Txt size={17}>{t.settings.aboutBody}</Txt>
        <Txt size={17}>{t.settings.notAdvice}</Txt>
        <Txt size={15} tone="ink3" testID="version">
          <Txt latin size={15} tone="ink3">{t.appName}</Txt>
          {`, ${fmt(t.settings.version, { version: expo.version })}`}
        </Txt>
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: color.bg },
  content: { padding: space.lg, paddingTop: 40, gap: space.xl, paddingBottom: space.xxxl, maxWidth: 640, width: '100%', alignSelf: 'center' },
  // Quiet buttons line their words up with the text edge; the target stays 56 px tall.
  back: { alignSelf: 'flex-start', paddingHorizontal: 0 },
  inline: { alignSelf: 'flex-start', paddingHorizontal: 0 },
  confirm: {
    gap: space.sm,
    padding: space.lg,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: color.lineStrong,
    backgroundColor: color.surface,
  },
  block: { gap: space.sm, paddingTop: space.lg, borderTopWidth: 1, borderTopColor: color.line },
  langs: { flexDirection: 'row', gap: space.sm, marginTop: space.xs, flexWrap: 'wrap' },
  choice: { flexGrow: 1 },
})
