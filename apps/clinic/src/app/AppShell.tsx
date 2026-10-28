import { useQuery } from '@tanstack/react-query'
import { Link, NavLink, Outlet } from 'react-router'

import { api } from '../api/client'
import { initials } from '../lib/names'
import { en, fmt } from '../strings/en'
import { Mark } from './Mark'
import { PAGE } from './page'

/*
 * The frame around every screen: the product, the five places, who is
 * signed in, and a footer that names the build and the boundary the
 * product keeps. The demonstration holds fictional patients only, and the
 * header says so on every screen.
 */
export function AppShell() {
  const me = useQuery({ queryKey: ['me'], queryFn: api.me, staleTime: Infinity })
  const queue = useQuery({ queryKey: ['confirm-queue'], queryFn: api.queue })

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-(--z-sticky) border-b border-line bg-bg/95 backdrop-blur-sm print:hidden">
        <div className={`${PAGE} flex h-14 items-center gap-6 sm:gap-8`}>
          <Link to="/today" className="hidden shrink-0 items-center gap-2.5 sm:flex" data-testid="brand">
            <Mark className="size-6" />
            <span className="text-sm font-semibold tracking-tight whitespace-nowrap">{en.app.name}</span>
          </Link>
          {/* On a phone the places scroll sideways; the fade at the edge says there is more. */}
          <nav aria-label={en.app.nav} className="-mx-1 flex h-full min-w-0 items-stretch gap-6 overflow-x-auto px-1 text-sm max-sm:pr-6 max-sm:[mask-image:linear-gradient(to_right,black_80%,transparent)]">
            <NavItem to="/today">{en.app.navToday}</NavItem>
            <NavItem to="/queue">
              {en.app.navQueue}
              {queue.data && (
                <span className="numerals rounded-md bg-sunken px-1.5 font-mono text-xs text-ink-2">
                  {queue.data.open_count}
                </span>
              )}
            </NavItem>
            <NavItem to="/patients">{en.app.navPatients}</NavItem>
            <NavItem to="/upload">{en.app.navUpload}</NavItem>
            <NavItem to="/audit">{en.app.navAudit}</NavItem>
          </nav>
          <div className="ml-auto hidden shrink-0 items-center gap-4 md:flex">
            <span className="hidden rounded-md border border-line-strong px-2 py-0.5 text-xs font-medium text-ink-2 xl:inline">
              {en.app.demo}
            </span>
            {me.data && (
              <p className="flex items-center gap-2.5" data-testid="signed-in">
                <span className="sr-only">{fmt(en.app.signedInAs, { name: me.data.full_name })}</span>
                <span aria-hidden className="grid size-8 place-items-center rounded-full bg-accent-soft text-xs font-semibold text-ink">
                  {initials(me.data.full_name)}
                </span>
                <span aria-hidden className="flex flex-col leading-tight">
                  <span className="text-sm font-medium whitespace-nowrap">{me.data.full_name}</span>
                  <span className="text-xs text-ink-3">{en.app.roles[me.data.role] ?? me.data.role}</span>
                </span>
              </p>
            )}
          </div>
        </div>
      </header>
      <Outlet />
      <footer className="mt-auto border-t border-line print:hidden">
        <div className={`${PAGE} flex flex-wrap items-baseline justify-between gap-x-8 gap-y-1 py-4 text-xs text-ink-3`}>
          <p className="numerals">{fmt(en.app.build, { name: en.app.name, version: __APP_VERSION__, commit: __APP_COMMIT__ })}</p>
          <p>{en.app.boundary}</p>
        </div>
      </footer>
    </div>
  )
}

function NavItem({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `flex items-center gap-2 border-b-2 whitespace-nowrap ${
          isActive ? 'border-accent text-ink' : 'border-transparent text-ink-2 hover:text-ink'
        }`
      }
    >
      {children}
    </NavLink>
  )
}
