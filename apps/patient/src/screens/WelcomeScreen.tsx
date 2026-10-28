import { LinearGradient } from 'expo-linear-gradient'
import { useCallback, useEffect, useState } from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'

import { useApp } from '../AppState'
import { Button } from '../components/Button'
import { ChoiceTile } from '../components/ChoiceTile'
import { Txt } from '../components/Txt'
import type { PatientRef } from '../data/types'
import { STRINGS } from '../i18n'
import { color, space, type Lang } from '../theme'

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
  const [failed, setFailed] = useState(false)
  const t = STRINGS[lang]

  const load = useCallback(() => {
    setFailed(false)
    app.api.patients().then(setPatients, () => setFailed(true))
  }, [app.api])
  useEffect(load, [load])

  return (
    <View style={[styles.screen, { direction: lang === 'ur' ? 'rtl' : 'ltr' }]}>
      <ScrollView contentContainerStyle={styles.page}>
        <LinearGradient colors={['#F7C9A8', '#E9DCEB', color.bg]} locations={[0, 0.55, 1]} style={styles.glow}>
          <Txt lang={lang} size={52} weight="bold" accessibilityRole="header">{t.welcome.title}</Txt>
          <Txt lang={lang} size={18} tone="ink2" style={styles.body}>{t.welcome.body}</Txt>
        </LinearGradient>

        <View style={styles.block}>
          <Txt lang={lang} size={20} weight="bold">{t.welcome.chooseLanguage}</Txt>
          <View style={styles.langs} role="radiogroup" aria-label={t.welcome.chooseLanguage}>
            {LANGS.map((l) => (
              <ChoiceTile
                key={l}
                label={STRINGS[l].langName}
                lang={l}
                checked={lang === l}
                onPress={() => setLang(l)}
                testID={`lang-${l}`}
                style={styles.langChoice}
              />
            ))}
          </View>
        </View>

        <View style={styles.block}>
          <Txt lang={lang} size={20} weight="bold">{t.welcome.choosePatient}</Txt>
          <Txt lang={lang} size={15} tone="ink3">{t.welcome.demo}</Txt>
          {failed && (
            <View style={styles.failed} role="alert">
              <Txt lang={lang} size={17}>{t.today.loadFailed}</Txt>
              <Button label={t.today.retry} onPress={load} testID="retry-patients" />
            </View>
          )}
          <View style={styles.list} role="radiogroup" aria-label={t.welcome.choosePatient}>
            {patients.map((p) => (
              <ChoiceTile
                key={p.id}
                label={p.full_name}
                sub={p.registration_no}
                latin
                checked={patientId === p.id}
                onPress={() => setPatientId(p.id)}
                testID={`patient-${p.id}`}
              />
            ))}
          </View>
        </View>

      </ScrollView>
      {/* Start stays in reach of the thumb, however long the list above. */}
      <View style={styles.footer}>
        <Button
          kind="primary"
          label={t.welcome.start}
          disabled={!patientId}
          onPress={() => patientId && app.choose({ lang, patientId })}
        />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  page: { paddingBottom: space.xxxl, backgroundColor: color.bg, flexGrow: 1 },
  glow: { paddingHorizontal: space.xl, paddingTop: 72, paddingBottom: space.xxl, gap: space.md },
  body: { maxWidth: 520 },
  block: { paddingHorizontal: space.xl, marginTop: space.xl, gap: space.sm },
  langs: { flexDirection: 'row', gap: space.sm, marginTop: space.sm, flexWrap: 'wrap' },
  list: { gap: space.sm, marginTop: space.sm },
  failed: { gap: space.md, marginTop: space.sm },
  langChoice: { flexGrow: 1 },
  screen: { flex: 1, backgroundColor: color.bg },
  footer: {
    paddingHorizontal: space.xl,
    paddingTop: space.md,
    paddingBottom: space.xl,
    borderTopWidth: 1,
    borderTopColor: color.line,
    backgroundColor: color.bg,
  },
})
