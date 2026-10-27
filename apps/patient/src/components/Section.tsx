import { StyleSheet, View, type ViewProps } from 'react-native'

import { space } from '../theme'
import { Txt } from './Txt'

/*
 * A titled group on the Today screen. It has no surface of its own, so the
 * rows and inputs inside it are the only cards: never a card in a card.
 */
export function Section({ title, help, children, ...rest }: ViewProps & { title: string; help?: string }) {
  return (
    <View style={styles.wrap} {...rest}>
      <Txt size={22} weight="bold" accessibilityRole="header">{title}</Txt>
      {help && <Txt tone="ink2" size={16}>{help}</Txt>}
      <View style={styles.body}>{children}</View>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: space.xs, paddingTop: space.lg, gap: space.xs },
  body: { marginTop: space.md, gap: space.md },
})
