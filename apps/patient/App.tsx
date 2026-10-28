/*
 * One import per weight. Importing a family's index bundles every weight it
 * ships, which put 31 font files (15 MB) into the Android build for the 9 used.
 */
import { NotoNastaliqUrdu_400Regular } from '@expo-google-fonts/noto-nastaliq-urdu/400Regular'
import { NotoNastaliqUrdu_500Medium } from '@expo-google-fonts/noto-nastaliq-urdu/500Medium'
import { NotoNastaliqUrdu_700Bold } from '@expo-google-fonts/noto-nastaliq-urdu/700Bold'
import { NotoSans_400Regular } from '@expo-google-fonts/noto-sans/400Regular'
import { NotoSans_500Medium } from '@expo-google-fonts/noto-sans/500Medium'
import { NotoSans_700Bold } from '@expo-google-fonts/noto-sans/700Bold'
import { NotoSansDevanagari_400Regular } from '@expo-google-fonts/noto-sans-devanagari/400Regular'
import { NotoSansDevanagari_500Medium } from '@expo-google-fonts/noto-sans-devanagari/500Medium'
import { NotoSansDevanagari_700Bold } from '@expo-google-fonts/noto-sans-devanagari/700Bold'
import { useFonts } from 'expo-font'
import { StatusBar } from 'expo-status-bar'
import { useState } from 'react'
import { View } from 'react-native'

import { AppStateProvider, useApp } from './src/AppState'
import { PastDaysScreen } from './src/screens/PastDaysScreen'
import { SettingsScreen } from './src/screens/SettingsScreen'
import { SurveyScreen } from './src/screens/SurveyScreen'
import { TodayScreen } from './src/screens/TodayScreen'
import { WelcomeScreen } from './src/screens/WelcomeScreen'
import { color } from './src/theme'

function Screens() {
  const { ready, patientId } = useApp()
  const [screen, setScreen] = useState<'today' | 'survey' | 'past' | 'settings'>('today')
  if (!ready) return <View style={{ flex: 1, backgroundColor: color.bg }} />
  if (!patientId) return <WelcomeScreen />
  if (screen === 'survey') return <SurveyScreen onDone={() => setScreen('today')} />
  if (screen === 'past') return <PastDaysScreen onBack={() => setScreen('today')} />
  if (screen === 'settings') return <SettingsScreen onBack={() => setScreen('today')} />
  return (
    <TodayScreen
      onOpenSurvey={() => setScreen('survey')}
      onOpenPast={() => setScreen('past')}
      onOpenSettings={() => setScreen('settings')}
    />
  )
}

export default function App() {
  const [fontsLoaded] = useFonts({
    NotoSans_400Regular, NotoSans_500Medium, NotoSans_700Bold,
    NotoSansDevanagari_400Regular, NotoSansDevanagari_500Medium, NotoSansDevanagari_700Bold,
    NotoNastaliqUrdu_400Regular, NotoNastaliqUrdu_500Medium, NotoNastaliqUrdu_700Bold,
  })
  if (!fontsLoaded) return <View style={{ flex: 1, backgroundColor: color.bg }} />
  return (
    <AppStateProvider>
      <StatusBar style="dark" />
      <Screens />
    </AppStateProvider>
  )
}
