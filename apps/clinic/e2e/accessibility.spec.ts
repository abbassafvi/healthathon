import { expect, test, type Page } from '@playwright/test'

import { expectNoViolations } from './axe'
import { query, reseed } from './db'
import { withoutMocks } from './mocks'

test.beforeEach(async ({ page }) => {
  reseed()
  await withoutMocks(page)
})

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
  expect(reached[0]).toBe('Today')
  expect(reached[1]).toMatch(/^Confirm queue/)
  for (const label of ['Confirm as read', 'Type the value', 'Not a value']) {
    expect(reached.some((r) => r.startsWith(label))).toBe(true)
  }
})

/* Tabs through every control on a page and returns those without a visible ring. */
async function unringed(page: Page, limit = 80) {
  const missing: string[] = []
  for (let i = 0; i < limit; i++) {
    await page.keyboard.press('Tab')
    const info = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement
      const style = getComputedStyle(el)
      const name = el.getAttribute('aria-label') || el.id || el.textContent?.trim().slice(0, 40) || el.tagName
      return { tag: el.tagName, name, ring: style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0 }
    })
    if (info.tag === 'BODY') break
    if (!info.ring) missing.push(`${info.tag} ${info.name}`)
  }
  return missing
}

test('every control on every screen shows a focus ring when reached by Tab', async ({ page }) => {
  const [{ id: patient }] = query<{ id: string }>("SELECT id FROM core.patient WHERE registration_no = 'DEV-0001'")
  for (const path of ['/today', '/patients', `/patients/${patient}/visit`, `/patients/${patient}/timeline`,
    `/patients/${patient}/checklist`, `/patients/${patient}/documents`, `/patients/${patient}/paper-form`, '/upload', '/audit']) {
    await page.goto(path)
    await expect(page.locator('main h1, main h2').first()).toBeVisible()
    expect(await unringed(page), path).toEqual([])
  }
})

test('the visit page fits a phone, and its readings table scrolls on its own', async ({ page }) => {
  const [{ id }] = query<{ id: string }>("SELECT id FROM core.patient WHERE registration_no = 'DEV-0001'")
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`/patients/${id}/visit`)
  const readings = page.getByRole('region', { name: 'Glucose readings table' })
  await expect(readings).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0)
  expect(await readings.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true)
  await expectNoViolations(page)
})

test('a patient opens from anywhere on their row', async ({ page }) => {
  const [{ id }] = query<{ id: string }>("SELECT id FROM core.patient WHERE registration_no = 'DEV-0001'")
  await page.goto('/patients')
  const born = page.getByRole('row', { name: /Asha Verma/ }).getByRole('cell').nth(2)
  const box = (await born.boundingBox())!
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await expect(page).toHaveURL(new RegExp(`/patients/${id}/visit$`))
})

test('patient list', async ({ page }) => {
  await page.goto('/patients')
  await expect(page.getByRole('link', { name: 'Asha Verma' })).toBeVisible()
  await expectNoViolations(page)
})

test('record with the trace open, zoomed and whole page', async ({ page }) => {
  await page.goto('/patients')
  await page.getByRole('link', { name: 'Asha Verma' }).click()
  await page.getByRole('link', { name: 'Documents', exact: true }).click()
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
  await page.getByRole('link', { name: 'Documents', exact: true }).focus()
  await page.keyboard.press('Enter')
  const first = page.locator('[data-value-id]').first()
  await first.focus()
  await page.keyboard.press('Enter')
  const trace = page.getByRole('dialog', { name: 'Where this value came from' })
  await expect(trace.getByRole('heading', { name: 'Where this value came from' })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(trace.getByText('Keyboard')).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(trace.getByRole('button', { name: /close/i })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(first).toBeFocused()
})

/*
 * Motion means movement: keyframe animations and transform transitions.
 * Short colour transitions on buttons are not motion and are allowed.
 */
const moving = (page: Page) =>
  page.evaluate(() =>
    document.getAnimations().filter((a) =>
      a instanceof CSSAnimation ||
      (a instanceof CSSTransition && /transform|translate|scale|rotate/.test(a.transitionProperty)),
    ).length,
  )

test('with reduced motion asked for, nothing moves', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/queue')
  await expect(page.getByRole('button', { name: /confirm as read/i })).toBeEnabled()
  expect(await moving(page)).toBe(0)
  await page.keyboard.press('Enter') // the toast and the next crop would animate
  await expect(page.getByRole('button', { name: /undo/i })).toBeVisible()
  expect(await moving(page)).toBe(0)
  await page.goto('/patients')
  await page.getByRole('link', { name: 'Asha Verma' }).click()
  await page.getByRole('link', { name: 'Documents', exact: true }).click()
  await page.locator('[data-value-id]').first().click()
  await expect(page.getByRole('dialog').getByRole('img')).toBeVisible()
  expect(await moving(page)).toBe(0)
})
