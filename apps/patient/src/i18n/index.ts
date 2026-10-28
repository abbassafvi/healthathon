import type { Lang } from '../theme'
import { en, type Strings } from './en'
import { hi, REVIEWED as HI_REVIEWED } from './hi'
import { ur, REVIEWED as UR_REVIEWED } from './ur'

export const STRINGS: Record<Lang, Strings> = { en, hi, ur }

/* Whether a speaker has reviewed each language. English is the source. */
export const REVIEWED: Record<Lang, boolean> = { en: true, hi: HI_REVIEWED, ur: UR_REVIEWED }

export function fmt(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => String(values[k] ?? `{${k}}`))
}

/*
 * A Yes or No tapped on a question card is stored in the language in use
 * when it was tapped. It is shown in the language in use now. Anything the
 * patient wrote themselves is shown as written.
 */
export function shownAnswer(text: string, t: Strings): string {
  const a = text.trim()
  const all = Object.values(STRINGS)
  if (all.some((s) => s.today.yes === a)) return t.today.yes
  if (all.some((s) => s.today.no === a)) return t.today.no
  return text
}

/* Text with no Devanagari or Arabic letters keeps the Latin face in every language. */
export function isLatin(text: string): boolean {
  return !/[\u0600-\u06FF\u0900-\u097F]/.test(text)
}

export type { Strings }
