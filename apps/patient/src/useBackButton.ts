import { useEffect } from 'react'
import { BackHandler, Platform } from 'react-native'

/*
 * Android's back button, or the back gesture, goes back inside the app
 * instead of closing it. Older users and first-time smartphone users reach
 * for it before any button on the screen.
 */
export function useBackButton(onBack: () => void): void {
  useEffect(() => {
    // The web build has no back button, and React Native Web logs an error if asked for one.
    if (Platform.OS === 'web') return
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onBack()
      return true
    })
    return () => sub.remove()
  }, [onBack])
}
