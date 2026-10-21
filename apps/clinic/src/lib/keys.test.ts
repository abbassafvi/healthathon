import { describe, expect, it } from 'vitest'

import { hasModifier, isButtonTarget, isTypingTarget } from './keys'

describe('isTypingTarget', () => {
  it('is false for window, document and null', () => {
    expect(isTypingTarget(window)).toBe(false)
    expect(isTypingTarget(document)).toBe(false)
    expect(isTypingTarget(null)).toBe(false)
  })

  it('is true inside text fields and editable regions', () => {
    const wrap = document.createElement('div')
    wrap.innerHTML = '<input /><textarea></textarea><select></select><div contenteditable="true"><span></span></div>'
    for (const el of wrap.querySelectorAll('input, textarea, select, span')) {
      expect(isTypingTarget(el)).toBe(true)
    }
  })

  it('is false for a plain element or a button', () => {
    expect(isTypingTarget(document.createElement('div'))).toBe(false)
    expect(isTypingTarget(document.createElement('button'))).toBe(false)
  })
})

describe('isButtonTarget', () => {
  it('finds a button from inside it', () => {
    const b = document.createElement('button')
    const inner = document.createElement('span')
    b.append(inner)
    expect(isButtonTarget(inner)).toBe(true)
    expect(isButtonTarget(window)).toBe(false)
  })
})

describe('hasModifier', () => {
  it.each(['altKey', 'ctrlKey', 'metaKey'] as const)('is true with %s', (k) => {
    expect(hasModifier(new KeyboardEvent('keydown', { key: 'x', [k]: true }))).toBe(true)
  })

  it('is false with shift alone', () => {
    expect(hasModifier(new KeyboardEvent('keydown', { key: 'X', shiftKey: true }))).toBe(false)
  })
})
