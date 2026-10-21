import type { Box } from '../api/client'

export type Rect = { x: number; y: number; w: number; h: number }

/* The box in page pixels. */
export function boxInPixels(box: Box, pageW: number, pageH: number): Rect {
  return { x: box.x * pageW, y: box.y * pageH, w: box.w * pageW, h: box.h * pageH }
}

/*
 * A view of the page around the value, shaped to the viewer (aspect =
 * height / width). Where the viewer is wide enough, it is a full-width band
 * of the page, so the value's whole row (test name, unit) stays in view.
 * In a narrow viewer a full-width band would be most of the page, so it
 * zooms in on the value instead. Either way it stays inside the page.
 */
export function zoomViewBox(box: Box, pageW: number, pageH: number, aspect: number): Rect {
  const b = boxInPixels(box, pageW, pageH)
  const bandFits = pageW * aspect <= pageH * BAND_MAX_FRACTION
  let w = bandFits ? pageW : Math.min(pageW, Math.max(b.w * 3, pageW * 0.5))
  let h = w * aspect
  if (h < b.h * 3) {
    h = b.h * 3
    w = h / aspect
  }
  const cx = b.x + b.w / 2
  const cy = b.y + b.h / 2
  return { x: clampStart(cx - w / 2, w, pageW), y: clampStart(cy - h / 2, h, pageH), w, h }
}

// A band taller than this share of the page is not a zoom worth showing.
const BAND_MAX_FRACTION = 0.6

function clampStart(start: number, size: number, limit: number): number {
  if (size >= limit) return (limit - size) / 2
  return Math.min(Math.max(0, start), limit - size)
}

export function lerpRect(a: Rect, b: Rect, t: number): Rect {
  const l = (p: number, q: number) => p + (q - p) * t
  return { x: l(a.x, b.x), y: l(a.y, b.y), w: l(a.w, b.w), h: l(a.h, b.h) }
}

/* ease-out-quart, matching --ease-out-quart in index.css */
export function easeOutQuart(t: number): number {
  return 1 - (1 - t) ** 4
}

export function toViewBox(r: Rect): string {
  return [r.x, r.y, r.w, r.h].map((n) => n.toFixed(1)).join(' ')
}
