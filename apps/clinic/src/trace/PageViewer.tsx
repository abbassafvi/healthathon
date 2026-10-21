import { useEffect, useLayoutEffect, useRef, useState } from 'react'

import type { Box } from '../api/client'
import { isTypingTarget, hasModifier } from '../lib/keys'
import { en } from '../strings/en'
import { boxInPixels, easeOutQuart, lerpRect, toViewBox, zoomViewBox, type Rect } from './viewBox'

/* A region to outline on the page, with an optional label drawn beside it. */
export type Mark = { box: Box; label?: string }

type Props = {
  url: string
  width: number
  height: number
  marks: Mark[]
  /* The mark to zoom to and draw in the accent. Others are drawn quietly. */
  focus?: number
  alt: string
}

type Mode = 'zoom' | 'page'
const ZOOM_MS = 320

/*
 * The original page with regions outlined. One SVG holds the image and the
 * outlines, so they stay exactly on their regions at every zoom level. The
 * focused mark is zoomed to and drawn in the accent; moving focus pans to
 * it. Zooming animates the viewBox; with reduced motion it jumps. W
 * toggles between the focused region and the whole page.
 */
export function PageViewer({ url, width, height, marks, focus = 0, alt }: Props) {
  const box = marks[focus]?.box ?? null
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [attempt, setAttempt] = useState(0)
  const [mode, setMode] = useState<Mode>(box ? 'zoom' : 'page')
  const [aspect, setAspect] = useState(0.75)
  const frameRef = useRef<HTMLDivElement>(null)
  const whole: Rect = { x: 0, y: 0, w: width, h: height }
  const target = mode === 'zoom' && box ? zoomViewBox(box, width, height, aspect) : whole
  const [view, setView] = useState<Rect>(target)
  const viewRef = useRef(view)
  // Only a zoom the user asked for animates; fitting to the panel does not.
  const userZoomed = useRef(false)
  const toggle = (next?: Mode) => {
    userZoomed.current = true
    setMode((m) => next ?? (m === 'zoom' ? 'page' : 'zoom'))
  }

  // Preload, so loading and failure are known before the SVG draws.
  useEffect(() => {
    const img = new Image()
    img.onload = () => setStatus('ready')
    img.onerror = () => setStatus('failed')
    img.src = url
    return () => {
      img.onload = img.onerror = null
    }
  }, [url, attempt])

  useLayoutEffect(() => {
    const el = frameRef.current
    if (!el) return
    const measure = () => el.clientWidth > 0 && setAspect(el.clientHeight / el.clientWidth)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const key = toViewBox(target)
  const lastFocus = useRef(focus)
  if (lastFocus.current !== focus) {
    lastFocus.current = focus
    userZoomed.current = true
  }
  useEffect(() => {
    const from = viewRef.current
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (reduce || !userZoomed.current || toViewBox(from) === key) {
      viewRef.current = target
      setView(target)
      return
    }
    const start = performance.now()
    let raf = 0
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / ZOOM_MS)
      const next = lerpRect(from, target, easeOutQuart(t))
      viewRef.current = next
      setView(next)
      if (t < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
    // `key` stands for `target`, which is a new object each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  useEffect(() => {
    if (!box) return
    const onKey = (e: KeyboardEvent) => {
      if (hasModifier(e) || isTypingTarget(e.target) || e.key.toLowerCase() !== 'w') return
      toggle()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [box])

  const b = box ? boxInPixels(box, width, height) : null
  // The page, with a hole cut where the focused region is: the rest is dimmed.
  const dim = b ? `M0 0H${width}V${height}H0Z M${b.x} ${b.y}h${b.w}v${b.h}h${-b.w}Z` : null

  return (
    <div className="flex flex-col gap-3">
      <div ref={frameRef} className="relative h-[min(58vh,34rem)] overflow-hidden rounded-xl border border-line bg-sunken">
        {status === 'ready' && (
          <svg
            role="img"
            aria-label={alt}
            viewBox={toViewBox(view)}
            data-mode={mode}
            preserveAspectRatio="xMidYMid meet"
            className="absolute inset-0 h-full w-full"
          >
            <image href={url} x={0} y={0} width={width} height={height} />
            {dim && <path d={dim} fill="oklch(0.21 0 0 / 0.12)" fillRule="evenodd" />}
            {marks.map((m, i) => {
              const r = boxInPixels(m.box, width, height)
              const focused = i === focus
              return (
                <g
                  key={i}
                  data-testid={focused ? 'trace-box' : 'page-mark'}
                  data-box={`${r.x.toFixed(1)} ${r.y.toFixed(1)} ${r.w.toFixed(1)} ${r.h.toFixed(1)}`}
                >
                  <rect x={r.x} y={r.y} width={r.w} height={r.h} rx={4} fill="none"
                    stroke="white" strokeWidth={6} vectorEffect="non-scaling-stroke" />
                  <rect x={r.x} y={r.y} width={r.w} height={r.h} rx={4} fill="none"
                    stroke={focused ? 'var(--color-accent)' : 'var(--color-line-strong)'}
                    strokeWidth={focused ? 2.5 : 1.5} vectorEffect="non-scaling-stroke" />
                  {m.label && (
                    <g transform={`translate(${r.x - 46} ${r.y + r.h / 2})`}>
                      <circle r={18} fill={focused ? 'var(--color-accent)' : 'white'}
                        stroke={focused ? 'none' : 'var(--color-line-strong)'} />
                      <text textAnchor="middle" dy="0.35em" fontSize={20} fontFamily="var(--font-mono)"
                        fill={focused ? 'white' : 'var(--color-ink-2)'}>{m.label}</text>
                    </g>
                  )}
                </g>
              )
            })}
          </svg>
        )}
        {status === 'loading' && (
          <div className="absolute inset-x-0 top-0 h-0.5 bg-line" aria-hidden>
            <div className="animate-gate h-full bg-accent" />
          </div>
        )}
        {status === 'failed' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
            <p className="text-sm text-ink-2">{en.trace.imageFailed}</p>
            <button
              type="button"
              onClick={() => {
                setStatus('loading')
                setAttempt((n) => n + 1)
              }}
              className="rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm font-medium hover:bg-bg"
            >
              {en.trace.retry}
            </button>
          </div>
        )}
      </div>
      {box && status === 'ready' && (
        <div className="flex gap-2" role="group" aria-label="Zoom">
          {(['zoom', 'page'] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              aria-keyshortcuts="W"
              onClick={() => toggle(m)}
              className="inline-flex h-8 items-center gap-2 rounded-lg border px-3 text-sm font-medium transition-colors duration-150 aria-pressed:border-accent aria-pressed:bg-accent-soft aria-pressed:text-ink border-line-strong bg-surface text-ink-2 hover:text-ink"
            >
              {m === 'zoom' ? en.trace.zoomToValue : en.trace.wholePage}
            </button>
          ))}
          <span className="kbd ml-1 self-center">W</span>
        </div>
      )}
    </div>
  )
}
