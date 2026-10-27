import AsyncStorage from '@react-native-async-storage/async-storage'
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

import { api as defaultApi } from './data/mockApi'
import type { PatientApi } from './data/types'
import { STRINGS, type Strings } from './i18n'
import { isRtl, type Lang } from './theme'

const KEY = 'healthathon.patient.session'

type Session = { lang: Lang; patientId: string | null }

type AppState = Session & {
  ready: boolean
  t: Strings
  rtl: boolean
  api: PatientApi
  choose: (s: Session) => void
  signOut: () => void
}

const Ctx = createContext<AppState | null>(null)

/*
 * Language and the chosen demo patient, remembered on the device. The scope
 * has no login; a patient is picked once and stays picked until changed.
 */
export function AppStateProvider({ children, api = defaultApi }: { children: ReactNode; api?: PatientApi }) {
  const [session, setSession] = useState<Session>({ lang: 'en', patientId: null })
  const [ready, setReady] = useState(false)

  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((raw) => raw && setSession(JSON.parse(raw) as Session))
      .catch(() => {})
      .finally(() => setReady(true))
  }, [])

  const choose = useCallback((s: Session) => {
    setSession(s)
    void AsyncStorage.setItem(KEY, JSON.stringify(s)).catch(() => {})
  }, [])

  const signOut = useCallback(() => {
    setSession((s) => {
      const next = { ...s, patientId: null }
      void AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => {})
      return next
    })
  }, [])

  const value = useMemo<AppState>(
    () => ({ ...session, ready, t: STRINGS[session.lang], rtl: isRtl(session.lang), api, choose, signOut }),
    [session, ready, api, choose, signOut],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useApp(): AppState {
  const v = useContext(Ctx)
  if (!v) throw new Error('useApp outside AppStateProvider')
  return v
}
