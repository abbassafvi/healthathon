import { useEffect } from 'react'

import { en } from '../strings/en'

/*
 * Names the browser tab after the screen, most specific part first, so a
 * clinician with several tabs open can tell them apart. Parts not known
 * yet (a patient's name while it loads) are left out.
 */
export function useTitle(...parts: (string | null | undefined | false)[]): void {
  const title = [...parts.filter(Boolean), en.app.name].join(' · ')
  useEffect(() => {
    document.title = title
  }, [title])
}
