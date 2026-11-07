import { useCallback, useEffect, useRef, useState } from 'react'

/*
 * Speech to text through the browser's own recogniser (the Web Speech
 * API). Chrome and Edge have it; Firefox does not, and there the button
 * is simply not shown. Chrome sends the audio to its vendor's speech
 * service to be recognised, which is acceptable while every patient is
 * fictional and is not once a real one is.
 */

type Alternative = { transcript: string }
type Result = { isFinal: boolean; 0: Alternative }
type ResultEvent = { resultIndex: number; results: ArrayLike<Result> }
type ErrorEvent = { error: string }

export type Recogniser = {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((e: ResultEvent) => void) | null
  onerror: ((e: ErrorEvent) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
  abort: () => void
}

type RecogniserClass = new () => Recogniser

function recogniserClass(): RecogniserClass | undefined {
  if (typeof window === 'undefined') return undefined
  const w = window as unknown as { SpeechRecognition?: RecogniserClass; webkitSpeechRecognition?: RecogniserClass }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition
}

export function dictationAvailable(): boolean {
  return recogniserClass() !== undefined
}

/* The interface languages, as the recogniser names them. */
const LOCALES: Record<string, string> = { en: 'en-IN', hi: 'hi-IN', ur: 'ur-IN' }

export type DictationError = 'denied' | 'failed'

/*
 * One field's dictation. Each finished phrase is handed to `onText`
 * exactly as recognised; the caller decides where it goes. Listening
 * stops by itself at a pause, or when `stop` is called.
 */
export function useDictation(lang: string, onText: (text: string) => void) {
  const [listening, setListening] = useState(false)
  const [error, setError] = useState<DictationError | null>(null)
  const current = useRef<Recogniser | null>(null)
  const deliver = useRef(onText)
  useEffect(() => {
    deliver.current = onText
  })

  useEffect(() => () => current.current?.abort(), [])

  const start = useCallback(() => {
    const Class = recogniserClass()
    if (!Class || current.current) return
    const r = new Class()
    r.lang = LOCALES[lang] ?? lang
    r.continuous = false
    r.interimResults = false
    r.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i]!
        const text = result[0].transcript.trim()
        if (result.isFinal && text) deliver.current(text)
      }
    }
    r.onerror = (e) => {
      // A pause with nothing said is not a failure worth reporting.
      if (e.error === 'no-speech' || e.error === 'aborted') return
      setError(e.error === 'not-allowed' || e.error === 'service-not-allowed' ? 'denied' : 'failed')
    }
    r.onend = () => {
      current.current = null
      setListening(false)
    }
    current.current = r
    setError(null)
    setListening(true)
    try {
      r.start()
    } catch {
      current.current = null
      setListening(false)
      setError('failed')
    }
  }, [lang])

  const stop = useCallback(() => current.current?.stop(), [])

  return { listening, error, start, stop }
}

/* Add a dictated phrase to what is already in a field, with one space between. */
export function appendDictated(existing: string, text: string): string {
  const before = existing.trimEnd()
  return before ? `${before} ${text}` : text
}
