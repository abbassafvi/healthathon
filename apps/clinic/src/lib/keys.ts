/*
 * True when a key event belongs to a text field, so a global shortcut
 * must leave it alone. The target can be the window or document, which
 * have no closest(), so it is checked as an Element first.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest('input, textarea, select, [contenteditable="true"]') !== null
  )
}

export function isButtonTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('button') !== null
}

export function hasModifier(e: KeyboardEvent): boolean {
  return e.altKey || e.ctrlKey || e.metaKey
}
