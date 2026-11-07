import { expect, test, type Page } from '@playwright/test'

import { query, reseed } from './db'

/*
 * Seeded queue, in arrival order:
 *   1  DEV-0001  Fasting plasma glucose  162   region_illegible
 *   2  DEV-0002  HbA1c                   7.1   readers_disagree, alternative 7.7
 *   3  DEV-0003  Fasting plasma glucose  1410  outside_assay_range, alternative 141
 *   4  DEV-0003  Serum creatinine        1.31  region_illegible
 *   5  DEV-0004  LDL cholesterol         96    readers_disagree, alternative 86
 */
const UNDO_WINDOW_MS = 5000

test.beforeEach(async () => {
  reseed()
})

const reading = (page: Page) => page.locator('#queue-reading')
const confirmButton = (page: Page) => page.getByRole('button', { name: /confirm as read/i })

async function waitForUnlocked(page: Page) {
  await expect(confirmButton(page)).toBeEnabled()
}

function valueState(registrationNo: string, analyte: string) {
  return query<{ state: string; value_text: string }>(`
    SELECT ev.state::text, ev.value_text FROM core.extracted_value ev
    JOIN core.patient p ON p.id = ev.patient_id
    WHERE p.registration_no = '${registrationNo}' AND ev.analyte_code = '${analyte}'
    ORDER BY ev.created_at`)
}

test('shows the oldest item first, with the value exactly as read', async ({ page }) => {
  await page.goto('/queue')
  await expect(reading(page)).toContainText('162')
  await expect(page.getByText('Asha Verma')).toBeVisible()
  await expect(page.getByText('This part of the image is hard to read.')).toBeVisible()
  await expect(page.getByText('1 of 5')).toBeVisible()
  await expect(page.getByRole('link', { name: /confirm queue/i })).toContainText('5')
})

test('controls stay locked until the crop has actually rendered', async ({ page }) => {
  let release!: () => void
  const held = new Promise<void>((r) => (release = r))
  await page.route('**/api/storage/dev/crops/**', async (route) => {
    await held
    await route.continue()
  })
  await page.goto('/queue')
  await expect(page.getByText(/decisions unlock once it is on screen/i)).toBeVisible()
  for (const button of await page.getByRole('group', { name: 'Decision' }).getByRole('button').all()) {
    await expect(button).toBeDisabled()
  }
  await page.keyboard.press('Enter')
  await page.keyboard.press('x')
  release()
  await waitForUnlocked(page)
  // Nothing pressed while locked was acted on.
  await expect(reading(page)).toContainText('162')
  expect(valueState('DEV-0001', 'fpg')[0].state).toBe('needs_confirm')
})

test('a crop that fails to load blocks the decision until a retry succeeds', async ({ page }) => {
  let fail = true
  await page.route('**/api/storage/dev/crops/**', (route) => (fail ? route.abort() : route.continue()))
  await page.goto('/queue')
  await expect(page.getByText(/did not load/i)).toBeVisible()
  await expect(confirmButton(page)).toBeDisabled()
  fail = false
  await page.getByRole('button', { name: /try again/i }).click()
  await waitForUnlocked(page)
})

test('Enter confirms, and the decision lands after the undo window', async ({ page }) => {
  await page.goto('/queue')
  await waitForUnlocked(page)
  await page.keyboard.press('Enter')

  await expect(page.getByText('Confirmed 162 mg/dL')).toBeVisible()
  await expect(reading(page)).toContainText('7.1')
  await expect(page.getByText('2 of 5')).toBeVisible()
  expect(valueState('DEV-0001', 'fpg')[0].state).toBe('needs_confirm') // still held

  await expect
    .poll(() => valueState('DEV-0001', 'fpg')[0].state, { timeout: UNDO_WINDOW_MS + 3000 })
    .toBe('confirmed')
  const [event] = query<{ action: string; latency: number }>(`
    SELECT action, (new_value->>'decision_latency_ms')::int AS latency FROM audit.event`)
  expect(event.action).toBe('value.confirm')
  expect(event.latency).toBeGreaterThan(0)
})

test('Z undoes a held decision and nothing is written', async ({ page }) => {
  await page.goto('/queue')
  await waitForUnlocked(page)
  await page.keyboard.press('x')
  await expect(page.getByText('Marked not a value')).toBeVisible()
  await page.keyboard.press('z')
  await expect(reading(page)).toContainText('162')
  await expect(page.getByText('1 of 5')).toBeVisible()
  await page.waitForTimeout(UNDO_WINDOW_MS + 1000)
  expect(valueState('DEV-0001', 'fpg')[0].state).toBe('needs_confirm')
  expect(query('SELECT 1 FROM audit.event')).toHaveLength(0)
})

test('an alternative reading is picked with its number key', async ({ page }) => {
  await page.goto('/queue')
  await waitForUnlocked(page)
  await page.keyboard.press('Enter') // settle item 1, which also sends nothing yet
  await waitForUnlocked(page)
  await expect(page.getByRole('button', { name: 'Use 7.7' })).toBeVisible()
  await page.keyboard.press('1')
  await waitForUnlocked(page) // item 3 now showing; item 2 is held, item 1 was sent
  await page.keyboard.press('x') // sends item 2
  await expect
    .poll(() => valueState('DEV-0002', 'hba1c').map((v) => `${v.state}:${v.value_text}`))
    .toEqual(['superseded:7.1', 'confirmed:7.7'])
})

test('a typed correction supersedes the original and keeps it', async ({ page }) => {
  await page.goto('/queue')
  await waitForUnlocked(page)
  await page.keyboard.press('c')
  const field = page.getByLabel(/value as it appears/i)
  await expect(field).toBeFocused()
  await expect(field).toHaveValue('')
  await field.fill('168')
  await page.keyboard.press('Enter')
  await expect(page.getByText('Corrected to 168 mg/dL')).toBeVisible()
  await expect
    .poll(() => valueState('DEV-0001', 'fpg').map((v) => `${v.state}:${v.value_text}`), {
      timeout: UNDO_WINDOW_MS + 3000,
    })
    .toEqual(['superseded:162', 'confirmed:168'])
  const [corr] = query<{ has_crop: boolean; latency: number }>(`
    SELECT crop_sha256 IS NOT NULL AS has_crop, decision_latency_ms AS latency FROM core.value_correction`)
  expect(corr.has_crop).toBe(true)
  expect(corr.latency).toBeGreaterThan(0)
})

test('the whole queue can be settled from the keyboard alone', async ({ page }) => {
  await page.goto('/queue')
  for (const key of ['Enter', '1', 'c', 'x', 'Enter']) {
    await waitForUnlocked(page)
    await page.keyboard.press(key)
    if (key === 'c') {
      await page.keyboard.type('1.31')
      await page.keyboard.press('Enter')
    }
  }
  await expect(page.getByRole('heading', { name: 'Nothing is waiting' })).toBeVisible()
  await expect
    .poll(() => query('SELECT 1 FROM core.confirm_queue_item WHERE resolved_at IS NULL').length, {
      timeout: UNDO_WINDOW_MS + 3000,
    })
    .toBe(0)
  const actions = query<{ action: string }>('SELECT action FROM audit.event ORDER BY id').map((r) => r.action)
  expect(actions).toEqual(['value.confirm', 'value.correct', 'value.correct', 'value.discard', 'value.confirm'])
  // 10 values were accepted at seed time. Of the 5 settled: 2 confirmed as
  // read, 2 corrected (only the replacement renders), 1 discarded.
  const renderable = query<{ state: string; n: number }>(
    'SELECT state::text, count(*)::int AS n FROM proj.renderable_value GROUP BY state ORDER BY state',
  )
  expect(renderable).toEqual([
    { state: 'accepted', n: 10 },
    { state: 'confirmed', n: 4 },
  ])
})

test('an item settled elsewhere is reported, not overwritten', async ({ page, request }) => {
  await page.goto('/queue')
  await waitForUnlocked(page)
  // A second reviewer settles the same item through the API first.
  const { items } = await (await request.get('/api/confirm-queue')).json()
  const other = await request.post(`/api/confirm-queue/${items[0].id}/decision`, {
    data: { action: 'discard', decision_latency_ms: 1500 },
  })
  expect(other.ok()).toBe(true)

  await page.keyboard.press('Enter')
  await waitForUnlocked(page)
  await page.keyboard.press('x') // sends the held confirm, which must lose
  await expect(page.getByText(/someone else settled/i)).toBeVisible()
  expect(valueState('DEV-0001', 'fpg')[0].state).toBe('discarded')
})

test('a held decision is still sent when the page closes', async ({ page, context }) => {
  await page.goto('/queue')
  await waitForUnlocked(page)
  await page.keyboard.press('Enter')
  await expect(page.getByText('Confirmed 162 mg/dL')).toBeVisible()
  const next = await context.newPage()
  await page.close({ runBeforeUnload: true })
  await expect.poll(() => valueState('DEV-0001', 'fpg')[0].state).toBe('confirmed')
  await next.close()
})
