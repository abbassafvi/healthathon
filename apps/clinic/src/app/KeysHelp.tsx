import { en } from '../strings/en'

/*
 * Every key a screen answers to, in one place. A native disclosure, so it
 * needs no script to open and is reachable like any other control.
 */
export function KeysHelp({ keys }: { keys: [string, string][] }) {
  return (
    <details className="group relative text-sm">
      <summary className="cursor-pointer list-none rounded-lg border border-line-strong bg-surface px-3 py-1.5 font-medium text-ink-2 hover:text-ink [&::-webkit-details-marker]:hidden">
        {en.app.keys}
      </summary>
      <dl className="absolute right-0 z-(--z-panel) mt-2 grid w-72 grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 rounded-xl border border-line bg-surface p-4 shadow-lg">
        {keys.map(([k, what]) => (
          <div key={k} className="contents">
            <dt><kbd className="kbd">{k}</kbd></dt>
            <dd className="text-ink-2">{what}</dd>
          </div>
        ))}
      </dl>
    </details>
  )
}
