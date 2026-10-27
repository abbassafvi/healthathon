import { Pressable, StyleSheet, type PressableProps, type ViewStyle } from 'react-native'

import { color, radius, space, touch } from '../theme'
import { Txt } from './Txt'

type Props = Omit<PressableProps, 'children' | 'style'> & {
  label: string
  kind?: 'primary' | 'secondary' | 'quiet'
  style?: ViewStyle
}

/* One button vocabulary for the whole app: 56 px tall at least, one accent for primary. */
export function Button({ label, kind = 'secondary', disabled, style, ...rest }: Props) {
  const primary = kind === 'primary'
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      style={({ pressed }) => [
        styles.base,
        primary ? styles.primary : kind === 'quiet' ? styles.quiet : styles.secondary,
        disabled && styles.disabled,
        pressed && !disabled && { opacity: 0.85 },
        style,
      ]}
      {...rest}
    >
      <Txt weight="medium" size={18} tone={primary && !disabled ? 'accentInk' : disabled ? 'ink2' : 'ink'} style={styles.label}>
        {label}
      </Txt>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  base: {
    minHeight: touch.min,
    paddingHorizontal: space.xl,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primary: { backgroundColor: color.accent },
  secondary: { backgroundColor: color.surface, borderWidth: 1.5, borderColor: color.lineStrong },
  quiet: { backgroundColor: 'transparent' },
  disabled: { backgroundColor: color.sunken, borderColor: color.sunken },
  label: { textAlign: 'center' },
})
