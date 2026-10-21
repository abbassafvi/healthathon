import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'

import { api, ApiError, type Decision, type QueueItem } from '../api/client'

export const UNDO_WINDOW_MS = 5000
const QUEUE_KEY = ['confirm-queue'] as const

export type Pending = { item: QueueItem; decision: Decision }

/* Runs fn after ms and returns a cancel. Injectable so tests decide when time passes. */
export type Scheduler = (fn: () => void, ms: number) => () => void
export const realTimer: Scheduler = (fn, ms) => {
  const id = window.setTimeout(fn, ms)
  return () => window.clearTimeout(id)
}
export type Notice = 'alreadySettled' | 'saveFailed'

/*
 * One reviewer's pass through the confirm queue.
 *
 * A decision is held on the client for undoWindowMs before it is sent,
 * because a stored decision cannot be edited (values are immutable on the
 * server). The next decision, leaving the page, or the window running out
 * all send it. Only one decision is ever held at a time.
 */
export function useReviewSession(undoWindowMs = UNDO_WINDOW_MS, schedule: Scheduler = realTimer) {
  const queryClient = useQueryClient()
  const query = useQuery({ queryKey: QUEUE_KEY, queryFn: api.queue })
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set())
  const [settled, setSettled] = useState(0)
  const [pending, setPending] = useState<Pending | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const pendingRef = useRef<Pending | null>(null)
  const cancelTimer = useRef<() => void>(() => {})

  const unhide = useCallback((id: string) => {
    setHidden((prev) => {
      const next = new Set(prev)
      next.delete(id)
      return next
    })
    setSettled((n) => Math.max(0, n - 1))
  }, [])

  const commit = useCallback(
    async (p: Pending, keepalive = false) => {
      try {
        await api.decide(p.item.id, p.decision, keepalive)
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) {
          setNotice('alreadySettled')
        } else {
          unhide(p.item.id)
          setNotice('saveFailed')
        }
      } finally {
        void queryClient.invalidateQueries({ queryKey: QUEUE_KEY })
      }
    },
    [queryClient, unhide],
  )

  const flush = useCallback(
    (keepalive = false) => {
      cancelTimer.current()
      const p = pendingRef.current
      pendingRef.current = null
      setPending(null)
      if (p) void commit(p, keepalive)
    },
    [commit],
  )

  const decide = useCallback(
    (item: QueueItem, decision: Decision) => {
      flush()
      const p = { item, decision }
      pendingRef.current = p
      setPending(p)
      setNotice(null)
      setHidden((prev) => new Set(prev).add(item.id))
      setSettled((n) => n + 1)
      cancelTimer.current = schedule(() => flush(), undoWindowMs)
    },
    [flush, undoWindowMs, schedule],
  )

  const undo = useCallback(() => {
    const p = pendingRef.current
    if (!p) return
    cancelTimer.current()
    pendingRef.current = null
    setPending(null)
    unhide(p.item.id)
  }, [unhide])

  useEffect(() => {
    const onLeave = () => flush(true)
    window.addEventListener('pagehide', onLeave)
    return () => {
      window.removeEventListener('pagehide', onLeave)
      flush(true)
    }
  }, [flush])

  const items = query.data?.items ?? []
  const current = items.find((i) => !hidden.has(i.id)) ?? null
  const hiddenInList = items.filter((i) => hidden.has(i.id)).length
  const remaining = Math.max(0, (query.data?.open_count ?? 0) - hiddenInList)

  return {
    status: query.status,
    refetch: query.refetch,
    current,
    position: settled + 1,
    total: settled + remaining,
    pending,
    notice,
    dismissNotice: () => setNotice(null),
    decide,
    undo,
  }
}
