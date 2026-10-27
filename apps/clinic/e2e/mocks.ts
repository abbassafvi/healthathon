import type { Page } from '@playwright/test'

/*
 * The in-browser mock layer runs as a service worker, and Playwright's
 * page.route cannot see requests that pass through one. Specs that hold
 * back or fail real API requests switch the mock layer off first.
 */
export async function withoutMocks(page: Page): Promise<void> {
  await page.addInitScript(() => {
    ;(globalThis as { __NO_MOCKS?: boolean }).__NO_MOCKS = true
  })
}
