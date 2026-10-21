import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

import { query, reseed } from './db'

test.beforeEach(() => reseed())

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

async function expectNoViolations(page: Page) {
  // Contrast is measured on settled colours, not mid-transition.
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'))
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG).analyze()
  expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(', ')}`)).toEqual([])
}

const unlocked = (page: Page) => expect(page.getByRole('button', { name: /confirm as read/i })).toBeEnabled()

test('queue item, ready to decide', async ({ page }) => {
  await page.goto('/queue')
  await unlocked(page)
  await expectNoViolations(page)
})

test('queue item, crop still loading', async ({ page }) => {
  await page.route('**/api/storage/dev/crops/**', () => new Promise(() => {}))
  await page.goto('/queue')
  await expect(page.getByRole('status').filter({ hasText: /decisions unlock/i })).toBeVisible()
  await expectNoViolations(page)
})

test('correction form open', async ({ page }) => {
  await page.goto('/queue')
  await unlocked(page)
  await page.keyboard.press('c')
  await expect(page.getByLabel(/value as it appears/i)).toBeFocused()
  await expectNoViolations(page)
})

test('undo toast showing', async ({ page }) => {
  await page.goto('/queue')
  await unlocked(page)
  await page.keyboard.press('Enter')
  await expect(page.getByRole('button', { name: /undo/i })).toBeVisible()
  await expectNoViolations(page)
})

test('empty queue', async ({ page }) => {
  query('SELECT 1') // the reseed ran; now settle everything directly
  await page.request.get('/api/confirm-queue').then(async (res) => {
    for (const item of (await res.json()).items) {
      await page.request.post(`/api/confirm-queue/${item.id}/decision`, {
        data: { action: 'confirm', decision_latency_ms: 1000 },
      })
    }
  })
  await page.goto('/queue')
  await expect(page.getByRole('heading', { name: 'Nothing is waiting' })).toBeVisible()
  await expectNoViolations(page)
})

test('every control is reachable by Tab with a visible focus ring', async ({ page }) => {
  await page.goto('/queue')
  await unlocked(page)
  const reached: string[] = []
  // Tab through one full cycle; focus wraps to <body> after the last control.
  for (let i = 0; i < 20; i++) {
    await page.keyboard.press('Tab')
    const info = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement
      const style = getComputedStyle(el)
      return { tag: el.tagName, name: el.textContent?.trim() ?? '', outline: style.outlineStyle !== 'none' }
    })
    if (info.tag === 'BODY') break
    expect(info.outline, `focus ring on ${info.name}`).toBe(true)
    reached.push(info.name)
  }
  expect(reached[0]).toMatch(/^Confirm queue/)
  for (const label of ['Confirm as read', 'Type the value', 'Not a value']) {
    expect(reached.some((r) => r.startsWith(label))).toBe(true)
  }
})

test('patient list', async ({ page }) => {
  await page.goto('/patients')
  await expect(page.getByRole('link', { name: 'Asha Verma' })).toBeVisible()
  await expectNoViolations(page)
})

test('record with the trace open, zoomed and whole page', async ({ page }) => {
  await page.goto('/patients')
  await page.getByRole('link', { name: 'Asha Verma' }).click()
  await page.locator('[data-value-id]').first().click()
  const trace = page.getByRole('dialog', { name: 'Where this value came from' })
  await expect(trace.getByRole('img')).toBeVisible()
  await expectNoViolations(page)
  await page.keyboard.press('w')
  await expect(trace.getByRole('img')).toHaveAttribute('data-mode', 'page')
  await expectNoViolations(page)
})

test('the record and trace work from the keyboard alone', async ({ page }) => {
  await page.goto('/patients')
  await page.getByRole('link', { name: 'Asha Verma' }).focus()
  await page.keyboard.press('Enter')
  const first = page.locator('[data-value-id]').first()
  await first.focus()
  await page.keyboard.press('Enter')
  const trace = page.getByRole('dialog', { name: 'Where this value came from' })
  await expect(trace.getByRole('heading', { name: 'Where this value came from' })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(trace.getByRole('button', { name: /close/i })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(first).toBeFocused()
})
