import { en } from '../strings/en'

/*
 * A patient's spoken answer, played as recorded. When transcription is on,
 * what the speech recogniser heard is shown under the player, labelled as a
 * machine's hearing: the recording is the answer, and the transcript is
 * only a way to read it faster. It loads only when played.
 */
export function Recording({ url, transcript, lang }: { url: string; transcript?: string | null; lang?: string }) {
  const rtl = lang === 'ur'
  return (
    <span className="mt-1 flex flex-col gap-1">
      <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <audio controls preload="none" src={url} aria-label={en.entries.recording} className="h-9 w-full max-w-72" />
        <span className="text-xs text-ink-3">{transcript ? en.entries.spokenTranscribed : en.entries.spoken}</span>
      </span>
      {transcript && (
        <span className="block rounded-md border border-dashed border-line px-2.5 py-1.5" data-testid="transcript">
          <span className="block text-xs text-ink-3">{en.entries.transcript}</span>
          <span lang={lang} dir={rtl ? 'rtl' : 'ltr'} className={`block text-sm text-ink ${rtl ? 'text-right' : ''}`}>{transcript}</span>
        </span>
      )}
    </span>
  )
}
