/*
 * Patient app tokens. A neutral base and one warm accent, which marks today
 * and the primary action and is never placed next to a reading, so it can
 * never read as a warning. No colour anywhere means good or bad.
 *
 * Values are hex because React Native has no OKLCH. Their OKLCH sources:
 * bg 0.955 0 0, surface 1 0 0, ink 0.2 0 0, accent 0.57 0.17 42.
 *
 * accent carries white text on buttons: 4.78:1, passes AA at 18 px.
 * accentMark is the today dot, a graphic: 3.49:1 on bg, passes 3:1.
 */
export const color = {
  bg: '#EDEDED',
  surface: '#FFFFFF',
  sunken: '#E2E2E2',
  line: '#D3D3D3',
  lineStrong: '#B4B4B4',
  ink: '#1A1A1A',
  ink2: '#4D4D4D',
  ink3: '#6B6B6B',
  accent: '#C24E14',
  accentMark: '#D4561A',
  accentInk: '#FFFFFF',
  accentSoft: '#FBE6D8',
} as const

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 } as const

/* Big targets: older eyes and first-time smartphone users. */
export const touch = { min: 56, large: 64 } as const

export const radius = { md: 14, lg: 20, pill: 999 } as const

export type Lang = 'en' | 'hi' | 'ur'

/* One family per script; Urdu is set in Nastaliq, its own script. */
export const font = {
  en: { regular: 'NotoSans_400Regular', medium: 'NotoSans_500Medium', bold: 'NotoSans_700Bold' },
  hi: { regular: 'NotoSansDevanagari_400Regular', medium: 'NotoSansDevanagari_500Medium', bold: 'NotoSansDevanagari_700Bold' },
  ur: { regular: 'NotoNastaliqUrdu_400Regular', medium: 'NotoNastaliqUrdu_500Medium', bold: 'NotoNastaliqUrdu_700Bold' },
} as const

/* Nastaliq needs far more line height than Latin or Devanagari. */
export const lineHeightFactor: Record<Lang, number> = { en: 1.35, hi: 1.45, ur: 2.0 }

export const isRtl = (lang: Lang) => lang === 'ur'
