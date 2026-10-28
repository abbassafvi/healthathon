import { LinearGradient } from 'expo-linear-gradient'
import { useState } from 'react'
import { Platform, ScrollView, StyleSheet, TextInput, View } from 'react-native'

import { useApp } from '../AppState'
import { Button } from '../components/Button'
import { ChoiceTile } from '../components/ChoiceTile'
import { Txt } from '../components/Txt'
import { ApiError } from '../data/httpApi'
import { fmt, STRINGS, type Strings } from '../i18n'
import { color, font, radius, space, type Lang } from '../theme'

const LANGS: Lang[] = ['en', 'hi', 'ur']

type Problem = keyof Pick<Strings['welcome'], 'badNumber' | 'wrongCode' | 'tooMany' | 'unreachable'>

/*
 * First launch: choose a language, then sign in with the mobile number the
 * clinic has, and the code sent to it by SMS. Without Twilio the server is
 * in test mode and the screen shows the code, saying no SMS was sent. The
 * soft gradient is atmosphere only, at the top of this one screen.
 */
export function WelcomeScreen() {
  const app = useApp()
  const [lang, setLang] = useState<Lang>(app.lang)
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [step, setStep] = useState<'phone' | 'code'>('phone')
  const [demoCode, setDemoCode] = useState<string | null>(null)
  const [problem, setProblem] = useState<Problem | null>(null)
  const [busy, setBusy] = useState(false)
  const t = STRINGS[lang]
  const rtl = lang === 'ur'

  const sendCode = async () => {
    if (phone.replace(/\D/g, '').length < 10) return setProblem('badNumber')
    setBusy(true)
    setProblem(null)
    try {
      setDemoCode((await app.api.startSignIn(phone)).demo_code)
      setCode('')
      setStep('code')
    } catch (e) {
      const status = e instanceof ApiError ? e.status : -1
      setProblem(status === 429 ? 'tooMany' : status === 422 ? 'badNumber' : 'unreachable')
    } finally {
      setBusy(false)
    }
  }
  const signIn = async () => {
    setBusy(true)
    setProblem(null)
    try {
      const s = await app.api.checkSignIn(phone, code.trim())
      app.choose({ lang, patientId: s.patient.id, token: s.token, patient: s.patient })
    } catch (e) {
      setProblem(e instanceof ApiError && e.status === 0 ? 'unreachable' : 'wrongCode')
      setBusy(false)
    }
  }
  const field = [styles.input, { textAlign: rtl ? 'right' : 'left' } as const]

  return (
    <View style={[styles.screen, { direction: rtl ? 'rtl' : 'ltr' }]}>
      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
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

        {step === 'phone' ? (
          <View style={styles.block}>
            <Txt lang={lang} size={20} weight="bold" nativeID="phone-label">{t.welcome.phone}</Txt>
            <TextInput
              testID="phone"
              accessibilityLabel={t.welcome.phone}
              accessibilityLabelledBy="phone-label"
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
              inputMode="tel"
              autoComplete="tel"
              textContentType="telephoneNumber"
              maxLength={18}
              style={field}
            />
            <Txt lang={lang} size={16} tone="ink2">{t.welcome.phoneHelp}</Txt>
            <Txt lang={lang} size={15} tone="ink3">{t.welcome.demoNumbers}</Txt>
          </View>
        ) : (
          <View style={styles.block}>
            <Txt lang={lang} size={17} tone="ink2">{t.welcome.codeSent}</Txt>
            <Txt lang={lang} size={20} weight="bold" nativeID="code-label" style={styles.gapAbove}>{t.welcome.code}</Txt>
            <TextInput
              testID="code"
              accessibilityLabel={t.welcome.code}
              accessibilityLabelledBy="code-label"
              value={code}
              onChangeText={setCode}
              keyboardType="number-pad"
              inputMode="numeric"
              // The SMS code: Android's name for it, and the web's.
              autoComplete={Platform.OS === 'web' ? 'one-time-code' : 'sms-otp'}
              textContentType="oneTimeCode"
              maxLength={8}
              style={[field, styles.codeInput]}
            />
            {demoCode && (
              <View style={styles.note} testID="demo-code">
                <Txt lang={lang} size={16}>{fmt(t.welcome.demoCode, { code: demoCode })}</Txt>
              </View>
            )}
            <Button kind="quiet" label={t.welcome.newCode} onPress={() => void sendCode()} disabled={busy} testID="new-code" style={styles.inline} />
            <Button
              kind="quiet"
              label={t.welcome.otherNumber}
              onPress={() => {
                setStep('phone')
                setProblem(null)
              }}
              testID="other-number"
              style={styles.inline}
            />
          </View>
        )}
        {problem && (
          <View style={styles.block} role="alert" testID="sign-in-problem">
            <Txt lang={lang} size={17}>{t.welcome[problem]}</Txt>
          </View>
        )}
      </ScrollView>
      {/* The next step stays in reach of the thumb. */}
      <View style={styles.footer}>
        {step === 'phone' ? (
          <Button kind="primary" label={t.welcome.sendCode} disabled={busy || !phone.trim()} onPress={() => void sendCode()} testID="send-code" />
        ) : (
          <Button kind="primary" label={t.welcome.signIn} disabled={busy || code.trim().length < 4} onPress={() => void signIn()} testID="sign-in" />
        )}
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
  langChoice: { flexGrow: 1 },
  gapAbove: { marginTop: space.sm },
  // Numbers are typed and shown in the Latin face, left to right, in every language.
  input: {
    minHeight: 60,
    fontSize: 24,
    fontFamily: font.en.medium,
    writingDirection: 'ltr',
    color: color.ink,
    backgroundColor: color.surface,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: color.lineStrong,
    paddingHorizontal: space.lg,
  },
  codeInput: { letterSpacing: 4 },
  note: { padding: space.md, borderRadius: radius.md, borderWidth: 1.5, borderColor: color.lineStrong, backgroundColor: color.surface },
  inline: { alignSelf: 'flex-start', paddingHorizontal: 0 },
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
