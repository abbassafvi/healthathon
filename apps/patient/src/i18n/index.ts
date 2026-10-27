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

export type { Strings }
