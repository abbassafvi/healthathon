import { Text, type TextProps, type TextStyle } from 'react-native'

import { useApp } from '../AppState'
import { color, font, lineHeightFactor, type Lang } from '../theme'

type Weight = 'regular' | 'medium' | 'bold'

type Props = TextProps & {
  size?: number
  weight?: Weight
  tone?: 'ink' | 'ink2' | 'ink3' | 'accent' | 'accentInk'
  /* Text that is data, not UI language (numbers, drug names as printed). */
  latin?: boolean
  lang?: Lang
}

/*
 * Every piece of text goes through here, so each script gets its own font,
 * line height and direction. Drug names and numbers are printed in Latin
 * script on the prescription, so they keep the Latin face in every language.
 */
export function Txt({ size = 17, weight = 'regular', tone = 'ink', latin, lang, style, ...rest }: Props) {
  const app = useApp()
  const l: Lang = latin ? 'en' : (lang ?? app.lang)
  const s: TextStyle = {
    fontFamily: font[l][weight],
    fontSize: size,
    lineHeight: Math.round(size * lineHeightFactor[l]),
    color: color[tone],
    writingDirection: l === 'ur' ? 'rtl' : 'ltr',
    // Latin data keeps its own direction but lines up with the layout's start edge.
    textAlign: app.rtl ? 'right' : 'left',
  }
  return <Text {...rest} style={[s, style]} />
}
