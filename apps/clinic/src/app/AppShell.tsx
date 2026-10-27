import { useQuery } from '@tanstack/react-query'
import { NavLink, Outlet } from 'react-router'

import { api } from '../api/client'
import { en, fmt } from '../strings/en'
import { PAGE } from './page'

export function AppShell() {
  const me = useQuery({ queryKey: ['me'], queryFn: api.me, staleTime: Infinity })
  const queue = useQuery({ queryKey: ['confirm-queue'], queryFn: api.queue })

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-(--z-sticky) border-b border-line bg-bg/95 backdrop-blur-sm">
        <div className={`${PAGE} flex h-14 items-center gap-6 sm:gap-8`}>
          <span className="hidden text-sm font-semibold tracking-tight whitespace-nowrap sm:inline">{en.app.name}</span>
          <nav className="flex h-full items-stretch gap-6 text-sm">
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
          </nav>
          {me.data && (
            <span className="ml-auto hidden text-sm text-ink-3 md:inline">{fmt(en.app.signedInAs, { name: me.data.full_name })}</span>
          )}
        </div>
      </header>
      <Outlet />
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
