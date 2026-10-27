import { useCallback, useEffect, useState } from 'react'

/*
 * Whether an element is short enough to stay pinned while the page
 * scrolls. Pinning something taller than the window would hide its end,
 * so a tall element scrolls with the page instead. A callback ref, so it
 * starts measuring whenever the element mounts, after loading as well.
 */
export function useFitsViewport<T extends HTMLElement>(margin = 48) {
  const [el, setEl] = useState<T | null>(null)
  const [fits, setFits] = useState(false)
  const attach = useCallback((node: T | null) => setEl(node), [])
  useEffect(() => {
    if (!el) return
    const check = () => setFits(el.offsetHeight + margin <= window.innerHeight)
    check()
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(check)
    ro?.observe(el)
    window.addEventListener('resize', check)
    return () => {
      ro?.disconnect()
      window.removeEventListener('resize', check)
    }
  }, [el, margin])
  return { attach, fits }
}
