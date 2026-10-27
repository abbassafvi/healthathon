import '@testing-library/jest-dom/vitest'
import { cleanup, configure } from '@testing-library/react'
import { afterEach } from 'vitest'

afterEach(() => cleanup())

// The full suite runs many jsdom workers at once; one second is too tight
// for a fetch, a re-render and a query under that load.
configure({ asyncUtilTimeout: 3000 })

// jsdom has no layout, so ResizeObserver is absent. Components only need it to exist.
if (!('ResizeObserver' in globalThis)) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
}
