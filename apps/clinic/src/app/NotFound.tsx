import { Link } from 'react-router'

import { en } from '../strings/en'
import { PAGE } from './page'
import { useTitle } from './useTitle'

const PLACES = [
  ['/today', en.app.navToday],
  ['/queue', en.app.navQueue],
  ['/patients', en.app.navPatients],
  ['/upload', en.app.navUpload],
  ['/audit', en.app.navAudit],
] as const

/* An address that leads nowhere says so, and offers the places that exist. */
export function NotFound() {
  useTitle(en.app.notFoundTitle)
  return (
    <main className={`${PAGE} pt-12 pb-24`}>
      <h1 className="text-2xl font-semibold tracking-tight">{en.app.notFoundTitle}</h1>
      <p className="mt-2 max-w-[65ch] text-ink-2">{en.app.notFoundBody}</p>
      <ul className="mt-6 flex flex-wrap gap-2">
        {PLACES.map(([to, label]) => (
          <li key={to}>
            <Link to={to} className="inline-flex h-9 items-center rounded-lg border border-line-strong bg-surface px-3.5 text-sm font-medium hover:bg-bg">
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </main>
  )
}
