import { LinearGradient } from 'expo-linear-gradient'
import { useEffect, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'

import { useApp } from '../AppState'
import { Button } from '../components/Button'
import { Txt } from '../components/Txt'
import type { PatientRef } from '../data/types'
import { STRINGS } from '../i18n'
import { color, radius, space, touch, type Lang } from '../theme'

const LANGS: Lang[] = ['en', 'hi', 'ur']

/*
 * First launch: choose a language, then the demo patient. The soft gradient
 * is atmosphere only, at the top of this one screen; it carries no meaning.
 */
export function WelcomeScreen() {
  const app = useApp()
  const [lang, setLang] = useState<Lang>(app.lang)
  const [patients, setPatients] = useState<PatientRef[]>([])
  const [patientId, setPatientId] = useState<string | null>(null)
  const t = STRINGS[lang]

  useEffect(() => {
    void app.api.patients().then(setPatients)
  }, [app.api])

  return (
    <ScrollView contentContainerStyle={styles.page} style={{ direction: lang === 'ur' ? 'rtl' : 'ltr' }}>
      <LinearGradient colors={['#F7C9A8', '#E9DCEB', color.bg]} locations={[0, 0.55, 1]} style={styles.glow}>
        <Txt lang={lang} size={52} weight="bold" accessibilityRole="header">{t.welcome.title}</Txt>
        <Txt lang={lang} size={18} tone="ink2" style={styles.body}>{t.welcome.body}</Txt>
      </LinearGradient>

      <View style={styles.block}>
        <Txt lang={lang} size={20} weight="bold">{t.welcome.chooseLanguage}</Txt>
        <View style={styles.langs} role="radiogroup" aria-label={t.welcome.chooseLanguage}>
          {LANGS.map((l) => (
            <Pressable
              key={l}
              role="radio"
              aria-checked={lang === l}
              accessibilityLabel={STRINGS[l].langName}
              testID={`lang-${l}`}
              onPress={() => setLang(l)}
              style={[styles.choice, styles.langChoice, lang === l && styles.chosen]}
            >
              <Txt lang={l} size={20} weight="medium">{STRINGS[l].langName}</Txt>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={styles.block}>
        <Txt lang={lang} size={20} weight="bold">{t.welcome.choosePatient}</Txt>
        <Txt lang={lang} size={15} tone="ink3">{t.welcome.demo}</Txt>
        <View style={styles.list} role="radiogroup" aria-label={t.welcome.choosePatient}>
          {patients.map((p) => (
            <Pressable
              key={p.id}
              role="radio"
              aria-checked={patientId === p.id}
              accessibilityLabel={p.full_name}
              testID={`patient-${p.id}`}
              onPress={() => setPatientId(p.id)}
              style={[styles.choice, styles.patient, patientId === p.id && styles.chosen]}
            >
              <Txt latin size={20} weight="medium">{p.full_name}</Txt>
              <Txt latin size={14} tone="ink3">{p.registration_no}</Txt>
            </Pressable>
          ))}
        </View>
      </View>

      <Button
        kind="primary"
        label={t.welcome.start}
        disabled={!patientId}
        onPress={() => patientId && app.choose({ lang, patientId })}
        style={styles.start}
      />
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  page: { paddingBottom: space.xxxl, backgroundColor: color.bg, flexGrow: 1 },
  glow: { paddingHorizontal: space.xl, paddingTop: 72, paddingBottom: space.xxl, gap: space.md },
  body: { maxWidth: 520 },
  block: { paddingHorizontal: space.xl, marginTop: space.xl, gap: space.sm },
  langs: { flexDirection: 'row', gap: space.sm, marginTop: space.sm, flexWrap: 'wrap' },
  list: { gap: space.sm, marginTop: space.sm },
  choice: {
    minHeight: touch.large,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: color.line,
    backgroundColor: color.surface,
    justifyContent: 'center',
    paddingHorizontal: space.lg,
  },
  langChoice: { flexGrow: 1, alignItems: 'center' },
  patient: { paddingVertical: space.md },
  chosen: { borderColor: color.ink, borderWidth: 2.5 },
  start: { marginHorizontal: space.xl, marginTop: space.xxl },
})
