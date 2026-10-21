import { useEffect, useRef, useState } from 'react'

import { en } from '../strings/en'

type Props = {
  src: string
  alt: string
  /** Called once, with performance.now(), after the crop has been painted. */
  onRendered: (at: number) => void
  onFailed: () => void
}

type Phase = 'loading' | 'ready' | 'failed'

/*
 * The crop a reviewer must see before deciding.
 *
 * "Loaded" is not enough: an image can fire load before it is decoded or
 * painted. So this waits for load, then decode(), then two animation
 * frames (the first runs before paint, the second after it), and only then
 * reports the crop as rendered. That moment unlocks the controls and starts
 * the decision latency clock. The parent keys this component by item, so
 * a new crop always starts from 'loading'.
 */
export function CropImage({ src, alt, onRendered, onFailed }: Props) {
  const [phase, setPhase] = useState<Phase>('loading')
  const [attempt, setAttempt] = useState(0)
  const imgRef = useRef<HTMLImageElement>(null)
  const callbacks = useRef({ onRendered, onFailed })
  useEffect(() => {
    callbacks.current = { onRendered, onFailed }
  })

  const retry = () => {
    setPhase('loading')
    setAttempt((n) => n + 1)
  }

  const handleLoad = async () => {
    const img = imgRef.current
    if (!img) return
    try {
      await img.decode?.()
    } catch {
      // decode() rejects for some valid images in some browsers; load already fired.
    }
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (imgRef.current !== img) return
        setPhase('ready')
        callbacks.current.onRendered(performance.now())
      }),
    )
  }

  const handleError = () => {
    setPhase('failed')
    callbacks.current.onFailed()
  }

  const url = attempt === 0 ? src : `${src}?retry=${attempt}`

  return (
    <figure className="relative overflow-hidden rounded-xl border border-line bg-surface">
      {phase !== 'failed' && (
        <img
          key={url}
          ref={imgRef}
          src={url}
          alt={alt}
          onLoad={() => void handleLoad()}
          onError={handleError}
          className={`block h-auto w-full select-none ${
            phase === 'ready' ? 'animate-crop-in' : 'invisible absolute inset-x-0 top-0'
          }`}
          draggable={false}
        />
      )}
      {phase === 'loading' && (
        // The visible status line next to the controls announces loading.
        <div className="absolute inset-0 grid place-items-center bg-sunken" aria-hidden>
          <div className="absolute inset-x-0 top-0 h-0.5 bg-line">
            <div className="animate-gate h-full bg-accent" />
          </div>
        </div>
      )}
      {phase === 'loading' && <div className="aspect-[6/1] w-full" aria-hidden />}
      {phase === 'failed' && (
        <div className="flex aspect-[6/1] w-full flex-col items-center justify-center gap-3 bg-sunken px-6 text-center">
          <p className="text-sm text-ink-2">{en.queue.cropFailed}</p>
          <button
            type="button"
            onClick={retry}
            className="rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm font-medium text-ink hover:bg-bg"
          >
            {en.queue.retry}
          </button>
        </div>
      )}
    </figure>
  )
}
