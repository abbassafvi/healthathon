import { useInfiniteQuery } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router'

import { api, type AuditEntry, type AuditKind, type AuditLog } from '../api/client'
import { LoadError } from '../app/LoadError'
import { PAGE } from '../app/page'
import { useTitle } from '../app/useTitle'
import { localIsoDate } from '../lib/localDate'
import { en, fmt } from '../strings/en'

const KINDS: (AuditKind | 'all')[] = ['all', 'decision', 'read', 'patient']

/*
 * The audit chain, newest first, with the whole chain rechecked on every
 * load. Every decision, every read of a record and every entry a patient
 * sends is here; opening this page is one of them.
 */
export function AuditLogPage() {
  const [params, setParams] = useSearchParams()
  const raw = params.get('kind')
  const kind = KINDS.includes(raw as AuditKind) && raw !== 'all' ? (raw as AuditKind) : undefined
  const query = useInfiniteQuery({
    queryKey: ['audit-log', kind ?? 'all'],
    queryFn: ({ pageParam }) => api.auditLog({ kind, before: pageParam }),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (last: AuditLog) => last.next_before ?? undefined,
  })
  const entries = query.data?.pages.flatMap((p) => p.entries) ?? []
  const chain = query.data?.pages[0].chain
  useTitle(en.audit.title)

  return (
    <main className={`${PAGE} pt-8 pb-16`}>
      <h1 className="text-2xl font-semibold tracking-tight">{en.audit.title}</h1>
      <p className="mt-2 max-w-[65ch] text-sm text-ink-2">{en.audit.intro}</p>

      {chain && (
        <div role="status" className="mt-6 flex items-start gap-3 rounded-lg border border-line-strong bg-surface px-4 py-3" data-chain={chain.intact ? 'intact' : 'broken'}>
          <span aria-hidden className="font-mono text-lg leading-6">{chain.intact ? '✓' : '✕'}</span>
          <p className="text-sm leading-6">
            <span className="font-semibold">{chain.intact ? en.audit.intact : fmt(en.audit.broken, { id: chain.first_broken_id ?? '' })}</span>
            <span className="numerals ml-2 text-ink-2">
              {chain.intact
                ? fmt(en.audit.intactDetail, { n: chain.checked })
                : fmt(en.audit.brokenDetail, { n: chain.checked, id: chain.first_broken_id ?? '' })}
            </span>
          </p>
        </div>
      )}

      <nav aria-label={en.audit.kinds} className="mt-6 flex gap-1 overflow-x-auto border-b border-line">
        {KINDS.map((k) => {
          const on = (kind ?? 'all') === k
          return (
            <button
              key={k}
              type="button"
              aria-pressed={on}
              onClick={() => setParams(k === 'all' ? {} : { kind: k })}
              className={`-mb-px border-b-2 px-3 py-2 text-sm whitespace-nowrap ${on ? 'border-accent text-ink' : 'border-transparent text-ink-2 hover:text-ink'}`}
            >
              {en.audit[k]}
            </button>
          )
        })}
      </nav>

      {query.status === 'pending' && <div className="mt-6 h-64 rounded-xl bg-sunken" aria-busy="true" />}
      {query.status === 'error' && (
        <LoadError className="mt-6" message={en.audit.loadFailed} onRetry={() => void query.refetch()} retrying={query.isFetching} />
      )}
      {query.status === 'success' && entries.length === 0 && <p className="mt-6 text-ink-2">{en.audit.empty}</p>}
      {entries.length > 0 && (
        // One body per day, headed by the day, so the time column can be a time.
        // Below tablet width each row stacks instead of scrolling sideways.
        <div className="mt-2 md:overflow-x-auto" tabIndex={0} role="region" aria-label={en.audit.title}>
          <table className="w-full border-collapse text-left text-sm max-md:block md:min-w-[44rem]">
            <thead className="max-md:hidden">
              <tr className="border-b border-line">
                {[en.audit.when, en.audit.who, en.audit.what, en.audit.patientColumn, en.audit.event].map((h) => (
                  <th key={h} scope="col" className="label py-2 pr-6 font-normal last:pr-0 last:text-right">{h}</th>
                ))}
              </tr>
            </thead>
            {byDay(entries).map(([day, rows]) => (
              <tbody key={day} className="max-md:block">
                <tr className="max-md:block">
                  <th colSpan={5} scope="colgroup" className="pt-6 pb-2 text-left text-sm font-semibold max-md:block">
                    {dayHeading(day)}
                  </th>
                </tr>
                {rows.map((e) => <Row key={e.id} e={e} />)}
              </tbody>
            ))}
          </table>
        </div>
      )}
      {query.hasNextPage && (
        <button
          type="button"
          onClick={() => void query.fetchNextPage()}
          disabled={query.isFetchingNextPage}
          className="mt-6 inline-flex h-9 items-center rounded-lg border border-line-strong bg-surface px-3.5 text-sm font-medium hover:bg-bg disabled:opacity-60"
        >
          {en.audit.more}
        </button>
      )}
    </main>
  )
}

function Row({ e }: { e: AuditEntry }) {
  const who = e.actor_name ?? (e.action === 'sms.refuse' ? en.audit.smsGateway : en.audit.thePatient)
  const reason = e.reason_code ? (en.reasons as Record<string, string>)[e.reason_code] ?? e.reason_code : null
  return (
    <tr className="border-t border-line align-baseline max-md:grid max-md:grid-cols-[auto_minmax(0,1fr)_auto] max-md:gap-x-3 max-md:py-2.5" data-kind={e.kind}>
      <td className="numerals py-2.5 pr-6 whitespace-nowrap text-ink-2 max-md:p-0">
        <time dateTime={e.occurred_at}>{clock(e.occurred_at)}</time>
      </td>
      <td className="py-2.5 pr-6 whitespace-nowrap max-md:col-start-2 max-md:row-start-2 max-md:p-0 max-md:text-xs max-md:text-ink-2">{who}</td>
      <td className="py-2.5 pr-6 max-md:col-start-2 max-md:row-start-1 max-md:p-0">
        <p>{en.audit.actions[e.action] ?? e.action}</p>
        {(reason || e.decision_latency_ms !== null) && (
          <p className="numerals text-xs text-ink-2">
            {[reason && fmt(en.audit.reason, { reason }), e.decision_latency_ms !== null && fmt(en.audit.latency, { seconds: (e.decision_latency_ms / 1000).toFixed(1) })]
              .filter(Boolean)
              .join(' ')}
          </p>
        )}
      </td>
      <td className="py-2.5 pr-6 whitespace-nowrap max-md:col-start-2 max-md:p-0 max-md:text-xs">
        {e.patient && (
          <Link to={`/patients/${e.patient.id}/visit`} className="underline-offset-4 hover:underline">{e.patient.full_name}</Link>
        )}
      </td>
      <td className="numerals py-2.5 text-right font-mono text-xs text-ink-3 max-md:col-start-3 max-md:row-start-1 max-md:p-0">{e.id}</td>
    </tr>
  )
}

/* Consecutive entries grouped by the local day they happened, newest first as listed. */
function byDay(entries: AuditEntry[]): [string, AuditEntry[]][] {
  const days: [string, AuditEntry[]][] = []
  for (const e of entries) {
    const day = localIsoDate(new Date(e.occurred_at))
    if (days.at(-1)?.[0] === day) days.at(-1)![1].push(e)
    else days.push([day, [e]])
  }
  return days
}

/* "Today", "Yesterday", or "Monday, 26 October 2026". */
function dayHeading(day: string, now: Date = new Date()): string {
  const offset = (n: number) => localIsoDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() + n))
  if (day === offset(0)) return en.audit.today
  if (day === offset(-1)) return en.audit.yesterday
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}

function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}
