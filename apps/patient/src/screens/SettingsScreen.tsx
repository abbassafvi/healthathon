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
 */
export function SettingsScreen({ onBack }: { onBack: () => void }) {
  const { api, patientId, lang, t, rtl, choose, signOut } = useApp()
  const [patient, setPatient] = useState<PatientRef | null>(null)
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
        <Button label={t.settings.change} onPress={signOut} testID="change-patient" />
        <Txt size={15} tone="ink3">{t.settings.changeHelp}</Txt>
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
  back: { alignSelf: 'flex-start' },
  block: { gap: space.sm, paddingTop: space.lg, borderTopWidth: 1, borderTopColor: color.line },
  langs: { flexDirection: 'row', gap: space.sm, marginTop: space.xs, flexWrap: 'wrap' },
  choice: { flexGrow: 1 },
})
