import { vi } from 'vitest'

/*
 * jsdom never loads images. This replaces Image so a test decides when a
 * preload succeeds or fails, by URL.
 */
export function controlImages() {
  const pending = new Map<string, { onload: (() => void) | null; onerror: (() => void) | null }>()
  class FakeImage {
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    set src(url: string) {
      pending.set(url, this)
    }
  }
  vi.stubGlobal('Image', FakeImage)
  return {
    load: (url: string) => pending.get(url)?.onload?.(),
    fail: (url: string) => pending.get(url)?.onerror?.(),
    urls: () => [...pending.keys()],
  }
}
