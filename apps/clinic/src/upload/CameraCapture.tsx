import { useCallback, useEffect, useRef, useState } from 'react'

import { en } from '../strings/en'

/*
 * Photographing a page at the desk, for when the document is in the
 * clinician's hand and not on the disk.
 *
 * The still is held for a look before it joins the list. A page caught
 * blurred here costs nothing; the same page caught after it is read
 * costs a queue item and a reader's time.
 */
type Stage = 'idle' | 'starting' | 'live' | 'held'

/* The camera is only offered where the browser will actually open one. */
export function cameraAvailable(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia
}

export function CameraCapture({ onCapture, onClose }: { onCapture: (file: File) => void; onClose: () => void }) {
  const [stage, setStage] = useState<Stage>('idle')
  const [error, setError] = useState<string | null>(null)
  const [held, setHeld] = useState<{ url: string; file: File } | null>(null)
  const video = useRef<HTMLVideoElement>(null)
  const stream = useRef<MediaStream | null>(null)
  const shutter = useRef<HTMLButtonElement>(null)

  const stop = useCallback(() => {
    stream.current?.getTracks().forEach((t) => t.stop())
    stream.current = null
  }, [])

  useEffect(() => {
    let cancelled = false
    setStage('starting')
    // The rear camera on a phone or tablet; the only one on a desk terminal.
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1920 } } })
      .then((s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop())
          return
        }
        stream.current = s
        const el = video.current
        if (!el) return
        el.srcObject = s
        // A stream is not yet a picture. Until the video reports its
        // size there are no pixels to grab, and a shutter pressed then
        // would do nothing at all.
        const ready = () => setStage('live')
        if (el.videoWidth) ready()
        else el.addEventListener('loadedmetadata', ready, { once: true })
      })
      .catch((e: DOMException) => {
        if (cancelled) return
        setError(e.name === 'NotAllowedError' ? en.upload.cameraRefused : en.upload.cameraFailed)
        setStage('idle')
      })
    return () => {
      cancelled = true
      stop()
    }
  }, [stop])

  // The shutter takes the focus as soon as there is something to photograph.
  useEffect(() => {
    if (stage === 'live') shutter.current?.focus()
  }, [stage])

  useEffect(() => () => void (held && URL.revokeObjectURL(held.url)), [held])

  const take = () => {
    const el = video.current
    if (!el || !el.videoWidth) return
    const canvas = document.createElement('canvas')
    canvas.width = el.videoWidth
    canvas.height = el.videoHeight
    canvas.getContext('2d')?.drawImage(el, 0, 0)
    canvas.toBlob((blob) => {
      if (!blob) return
      const file = new File([blob], `photograph-${Date.now()}.png`, { type: 'image/png' })
      setHeld({ url: URL.createObjectURL(file), file })
      setStage('held')
    }, 'image/png')
  }

  const retake = () => {
    if (held) URL.revokeObjectURL(held.url)
    setHeld(null)
    setStage('live')
  }

  const keep = () => {
    if (!held) return
    onCapture(held.file)
    URL.revokeObjectURL(held.url)
    setHeld(null)
    setStage('live')
  }

  const close = () => {
    stop()
    onClose()
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-line-strong bg-surface p-4">
      <div className="flex items-baseline justify-between gap-4">
        <h3 className="text-sm font-medium">{en.upload.cameraTitle}</h3>
        <button type="button" onClick={close} className="rounded-lg px-2 py-1 text-sm text-ink-2 underline underline-offset-4 hover:text-ink">
          {en.upload.cameraClose}
        </button>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-ink">{error}</p>
      ) : (
        <>
          <div className="relative aspect-[4/3] w-full overflow-hidden rounded-lg border border-line bg-sunken">
            {/* The page being photographed is the subject; the frame stays out of its way. */}
            <video
              ref={video}
              autoPlay
              muted
              playsInline
              aria-label={en.upload.cameraPreview}
              className={`size-full object-cover ${stage === 'held' ? 'invisible' : ''}`}
            />
            {held && <img src={held.url} alt={en.upload.cameraHeld} className="absolute inset-0 size-full object-cover" />}
            {stage === 'starting' && (
              <p className="absolute inset-0 grid place-items-center text-sm text-ink-2">{en.upload.cameraStarting}</p>
            )}
          </div>

          <div aria-live="polite" className="flex flex-wrap gap-2">
            {stage === 'held' ? (
              <>
                <button type="button" onClick={keep} className="inline-flex h-9 items-center rounded-lg border border-accent bg-accent-soft px-3.5 text-sm font-medium hover:bg-accent-soft/70">
                  {en.upload.cameraKeep}
                </button>
                <button type="button" onClick={retake} className="inline-flex h-9 items-center rounded-lg border border-line-strong bg-bg px-3.5 text-sm font-medium hover:bg-sunken">
                  {en.upload.cameraRetake}
                </button>
              </>
            ) : (
              <button
                ref={shutter}
                type="button"
                onClick={take}
                disabled={stage !== 'live'}
                className="inline-flex h-9 items-center rounded-lg border border-line-strong bg-bg px-3.5 text-sm font-medium hover:bg-sunken disabled:opacity-50"
              >
                {en.upload.cameraTake}
              </button>
            )}
          </div>
          <p className="text-sm text-ink-2">{en.upload.cameraHint}</p>
        </>
      )}
    </div>
  )
}
