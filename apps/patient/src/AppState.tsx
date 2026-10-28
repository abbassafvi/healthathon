import AsyncStorage from '@react-native-async-storage/async-storage'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import { API_URL } from './data/config'
import { createHttpApi } from './data/httpApi'
import { api as mockApi } from './data/mockApi'
import type { PatientApi, PatientRef } from './data/types'
import { STRINGS, type Strings } from './i18n'
import { isRtl, type Lang } from './theme'

const KEY = 'healthathon.patient.session'

/* The token is what the phone's requests carry once it has signed in with a code sent by SMS. */
type Session = { lang: Lang; patientId: string | null; token?: string | null; patient?: PatientRef | null }

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
 * The language and the signed-in patient, remembered on the device: a
 * phone signs in once with a code sent by SMS and stays signed in until it
 * signs out, or the clinic's server stops accepting its token.
 */
export function AppStateProvider({ children, api: given }: { children: ReactNode; api?: PatientApi }) {
  const [session, setSession] = useState<Session>({ lang: 'en', patientId: null })
  const [ready, setReady] = useState(false)
  // The API reads these as each request goes out. They are set with the
  // session, not after it renders: a screen's first request must already
  // carry the token restored from storage.
  const lang = useRef(session.lang)
  const token = useRef(session.token ?? null)
  const apply = (s: Session) => {
    lang.current = s.lang
    token.current = s.token ?? null
    return s
  }
  // The real API when the app is told where it is, the mock otherwise.
  const [api] = useState<PatientApi>(
    () => given ?? (API_URL ? createHttpApi({ baseUrl: API_URL, language: () => lang.current, token: () => token.current }) : mockApi),
  )

  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((raw) => raw && setSession(apply(JSON.parse(raw) as Session)))
      .catch(() => {})
      .finally(() => setReady(true))
  }, [])

  // A change of language keeps the sign-in: what is given is merged into the session.
  const choose = useCallback((s: Session) => {
    setSession((prev) => {
      const next = apply({ ...prev, ...s })
      void AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => {})
      return next
    })
  }, [])

  const signOut = useCallback(() => {
    setSession((s) => {
      const next = apply({ lang: s.lang, patientId: null, token: null, patient: null })
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
