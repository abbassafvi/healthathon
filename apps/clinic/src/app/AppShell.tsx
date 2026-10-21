import { useQuery } from '@tanstack/react-query'
import { NavLink, Outlet } from 'react-router'

import { api } from '../api/client'
import { en, fmt } from '../strings/en'

export function AppShell() {
  const me = useQuery({ queryKey: ['me'], queryFn: api.me, staleTime: Infinity })
  const queue = useQuery({ queryKey: ['confirm-queue'], queryFn: api.queue })

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-(--z-sticky) border-b border-line bg-bg/95 backdrop-blur-sm">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center gap-6 px-4 sm:gap-8 sm:px-6">
          <span className="text-sm font-semibold tracking-tight whitespace-nowrap">{en.app.name}</span>
          <nav className="flex h-full items-stretch gap-6 text-sm">
            <NavLink
              to="/queue"
              className={({ isActive }) =>
                `flex items-center gap-2 border-b-2 whitespace-nowrap ${
                  isActive ? 'border-accent text-ink' : 'border-transparent text-ink-2 hover:text-ink'
                }`
              }
            >
              {en.app.navQueue}
              {queue.data && (
                <span className="numerals rounded-md bg-sunken px-1.5 font-mono text-xs text-ink-2">
                  {queue.data.open_count}
                </span>
              )}
            </NavLink>
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
