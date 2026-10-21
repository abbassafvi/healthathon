import { describe, expect, it } from 'vitest'

import { boxInPixels, easeOutQuart, lerpRect, toViewBox, zoomViewBox } from './viewBox'

const W = 1240
const H = 1754
const contains = (outer: ReturnType<typeof zoomViewBox>, inner: ReturnType<typeof boxInPixels>) =>
  inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w &&
  inner.y + inner.h <= outer.y + outer.h

describe('zoomViewBox', () => {
  const box = { x: 0.55, y: 0.3, w: 0.06, h: 0.025 }

  it.each([0.4, 0.75, 1, 1.6])('keeps the whole value in view at aspect %s', (aspect) => {
    const v = zoomViewBox(box, W, H, aspect)
    expect(contains(v, boxInPixels(box, W, H))).toBe(true)
    expect(v.h / v.w).toBeCloseTo(aspect, 5)
  })

  it('shows context around the value, not just the value', () => {
    const v = zoomViewBox(box, W, H, 0.75)
    const b = boxInPixels(box, W, H)
    expect(v.w).toBeGreaterThanOrEqual(b.w * 3)
    expect(v.h).toBeGreaterThanOrEqual(b.h * 3)
  })

  it('shows the full width of the page in a wide viewer, so the row stays readable', () => {
    const v = zoomViewBox(box, W, H, 0.75)
    expect(v.x).toBe(0)
    expect(v.w).toBe(W)
    expect(v.h).toBeLessThan(H * 0.6)
  })

  it('zooms in on the value in a narrow viewer', () => {
    const v = zoomViewBox(box, W, H, 1.4)
    expect(v.w).toBeLessThan(W)
    expect(v.h).toBeLessThan(H)
    expect(contains(v, boxInPixels(box, W, H))).toBe(true)
  })

  it('stays inside the page for a value at a corner', () => {
    for (const [corner, aspect] of [
      [{ x: 0, y: 0, w: 0.05, h: 0.02 }, 0.75],
      [{ x: 0.95, y: 0.98, w: 0.05, h: 0.02 }, 0.75],
      [{ x: 0, y: 0, w: 0.05, h: 0.02 }, 1.4],
      [{ x: 0.95, y: 0.98, w: 0.05, h: 0.02 }, 1.4],
    ] as const) {
      const v = zoomViewBox(corner, W, H, aspect)
      expect(v.x).toBeGreaterThanOrEqual(0)
      expect(v.y).toBeGreaterThanOrEqual(0)
      expect(v.x + v.w).toBeLessThanOrEqual(W + 1e-6)
      expect(v.y + v.h).toBeLessThanOrEqual(H + 1e-6)
      expect(contains(v, boxInPixels(corner, W, H))).toBe(true)
    }
  })

  it('centres instead of clamping when the view is larger than the page', () => {
    const v = zoomViewBox({ x: 0.1, y: 0.1, w: 0.8, h: 0.8 }, W, H, 0.75)
    expect(v.w).toBeGreaterThan(W - 1)
    expect(v.x + v.w / 2).toBeCloseTo(W / 2, 3)
  })
})

describe('motion helpers', () => {
  it('interpolates rectangles', () => {
    const a = { x: 0, y: 0, w: 10, h: 10 }
    const b = { x: 10, y: 20, w: 30, h: 40 }
    expect(lerpRect(a, b, 0)).toEqual(a)
    expect(lerpRect(a, b, 1)).toEqual(b)
    expect(lerpRect(a, b, 0.5)).toEqual({ x: 5, y: 10, w: 20, h: 25 })
  })

  it('eases out from 0 to 1', () => {
    expect(easeOutQuart(0)).toBe(0)
    expect(easeOutQuart(1)).toBe(1)
    expect(easeOutQuart(0.5)).toBeGreaterThan(0.5)
  })

  it('formats a viewBox attribute', () => {
    expect(toViewBox({ x: 1, y: 2.25, w: 3, h: 4 })).toBe('1.0 2.3 3.0 4.0')
  })
})
