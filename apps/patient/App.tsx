import { NotoNastaliqUrdu_400Regular, NotoNastaliqUrdu_500Medium, NotoNastaliqUrdu_700Bold } from '@expo-google-fonts/noto-nastaliq-urdu'
import { NotoSans_400Regular, NotoSans_500Medium, NotoSans_700Bold, useFonts } from '@expo-google-fonts/noto-sans'
import { NotoSansDevanagari_400Regular, NotoSansDevanagari_500Medium, NotoSansDevanagari_700Bold } from '@expo-google-fonts/noto-sans-devanagari'
import { StatusBar } from 'expo-status-bar'
import { useState } from 'react'
import { View } from 'react-native'

import { AppStateProvider, useApp } from './src/AppState'
import { PastDaysScreen } from './src/screens/PastDaysScreen'
import { SurveyScreen } from './src/screens/SurveyScreen'
import { TodayScreen } from './src/screens/TodayScreen'
import { WelcomeScreen } from './src/screens/WelcomeScreen'
import { color } from './src/theme'

function Screens() {
  const { ready, patientId } = useApp()
  const [screen, setScreen] = useState<'today' | 'survey' | 'past'>('today')
  if (!ready) return <View style={{ flex: 1, backgroundColor: color.bg }} />
  if (!patientId) return <WelcomeScreen />
  if (screen === 'survey') return <SurveyScreen onDone={() => setScreen('today')} />
  if (screen === 'past') return <PastDaysScreen onBack={() => setScreen('today')} />
  return <TodayScreen onOpenSurvey={() => setScreen('survey')} onOpenPast={() => setScreen('past')} />
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
