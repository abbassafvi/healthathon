import { en } from '../strings/en'

/*
 * A patient's spoken answer, played as recorded. Nothing transcribes it,
 * so the screen says so beside it. It loads only when played.
 */
export function Recording({ url }: { url: string }) {
  return (
    <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
      <audio controls preload="none" src={url} aria-label={en.entries.recording} className="h-9 w-full max-w-72" />
      <span className="text-xs text-ink-3">{en.entries.spoken}</span>
    </span>
  )
}
