/*
 * Fictional document pages for the mock layer, drawn as SVG in code so no
 * image file is ever committed. Every line's box is computed from the same
 * numbers that draw it, so the stored region is exact by construction.
 */
import caveat from '@fontsource/caveat/files/caveat-latin-500-normal.woff2?inline'

import type { Box } from '../api/client'

export const PAGE_W = 1240
export const PAGE_H = 1754

const HAND_SIZE = 56
const HAND_CHAR_W = 0.42 // average advance of Caveat, in em
const LINE_X = 190
const FIRST_LINE_Y = 640
const LINE_GAP = 118

export type RxLine = { drug: string; dose: string; schedule: string | null }

export type RxPage = {
  doctor: string
  clinic: string
  patientName: string
  dateText: string
  lines: RxLine[]
}

export function lineText(l: RxLine): string {
  return [l.drug, l.dose].join(' ') + (l.schedule ? `   ${l.schedule}` : '')
}

/* The region of line i, normalised to the page, as core.provenance stores it. */
export function lineBox(page: RxPage, i: number): Box {
  const text = lineText(page.lines[i])
  const baseline = FIRST_LINE_Y + i * LINE_GAP
  const w = text.length * HAND_SIZE * HAND_CHAR_W + 28
  const h = HAND_SIZE * 1.25
  return {
    x: (LINE_X - 14) / PAGE_W,
    y: (baseline - HAND_SIZE * 0.95) / PAGE_H,
    w: w / PAGE_W,
    h: h / PAGE_H,
  }
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export function prescriptionSvg(page: RxPage, crop?: { x: number; y: number; w: number; h: number }): string {
  const view = crop ? `${crop.x} ${crop.y} ${crop.w} ${crop.h}` : `0 0 ${PAGE_W} ${PAGE_H}`
  const size = crop ? `width="${Math.round(crop.w)}" height="${Math.round(crop.h)}"` : `width="${PAGE_W}" height="${PAGE_H}"`
  const lines = page.lines
    .map((l, i) => {
      const y = FIRST_LINE_Y + i * LINE_GAP
      return `<text x="${LINE_X}" y="${y}" class="hand">${esc(lineText(l))}</text>`
    })
    .join('')
  const sigY = FIRST_LINE_Y + page.lines.length * LINE_GAP + 120
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${view}" ${size}>
<style>
@font-face { font-family: Hand; src: url(${caveat}) format('woff2'); }
.print { font-family: 'DejaVu Sans', Arial, sans-serif; fill: #1d1d1d; }
.hand { font-family: Hand, cursive; font-size: ${HAND_SIZE}px; fill: #1b2a6b; }
</style>
<rect width="${PAGE_W}" height="${PAGE_H}" fill="#fbfbf9"/>
<text x="110" y="140" class="print" font-size="44" font-weight="600">${esc(page.doctor)}</text>
<text x="110" y="192" class="print" font-size="26" fill="#555">${esc(page.clinic)}</text>
<line x1="110" y1="236" x2="1130" y2="236" stroke="#888" stroke-width="3"/>
<text x="110" y="320" class="print" font-size="28">Name:</text>
<text x="210" y="322" class="hand">${esc(page.patientName)}</text>
<text x="820" y="320" class="print" font-size="28">Date:</text>
<text x="905" y="322" class="hand">${esc(page.dateText)}</text>
<text x="110" y="500" class="print" font-size="72" font-style="italic">Rx</text>
${lines}
<path d="M780 ${sigY} c40 -50 70 30 110 -10 s60 -40 90 10 s50 20 80 -20" fill="none" stroke="#1b2a6b" stroke-width="4"/>
<text x="110" y="1640" class="print" font-size="22" fill="#777">This is a fictional prescription generated for testing.</text>
</svg>`
}
