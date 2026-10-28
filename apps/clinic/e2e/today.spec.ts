import { expect, test } from '@playwright/test'

import { expectNoViolations } from './axe'
import { query, reseed } from './db'
import { withoutMocks } from './mocks'

test.beforeEach(async ({ page }) => {
  reseed()
  await withoutMocks(page)
})

const visits = (page: import('@playwright/test').Page) => page.getByRole('main').getByRole('listitem')

test('the app opens on the day, with the booked visits in time order', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/today$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Today' })).toBeVisible()
  await expect(visits(page)).toHaveCount(4)
  await expect(visits(page).getByRole('heading')).toHaveText(['Asha Verma', 'Imran Qureshi', 'Meera Pillai', 'Rakesh Yadav'])
  await expect(visits(page).locator('time')).toHaveText(['10:00', '10:30', '11:00', '11:30'])
  await expectNoViolations(page)
})

test('each visit states what waits for a person, and leads there', async ({ page }) => {
  const [{ n }] = query<{ n: number }>(`
    SELECT count(*)::int AS n FROM core.confirm_queue_item q
    JOIN core.extracted_value v ON v.id = q.extracted_value_id
    JOIN core.patient p ON p.id = v.patient_id
    WHERE p.registration_no = 'DEV-0003' AND q.resolved_at IS NULL`)
  await page.goto('/today')
  const meera = visits(page).filter({ hasText: 'Meera Pillai' })
  await meera.getByRole('link', { name: `${n} values in the confirm queue` }).click()
  await expect(page).toHaveURL(/\/queue$/)

  await page.goto('/today')
  const imran = visits(page).filter({ hasText: 'Imran Qureshi' })
  await expect(imran.getByText('No checklist yet')).toBeVisible()
  await imran.getByRole('link', { name: /prescription lines? to review/ }).click()
  await expect(page.getByRole('heading', { name: 'Review prescription' })).toBeVisible()
})

test('a visit opens on its visit page, covering the same period', async ({ page }) => {
  await page.goto('/today')
  const asha = visits(page).filter({ hasText: 'Asha Verma' })
  const since = await asha.getByText(/^Since the visit on /).textContent()
  await asha.getByRole('link', { name: 'Open the visit' }).click()
  await expect(page.getByRole('heading', { name: /^Visit, / })).toBeVisible()
  await expect(page.getByText(new RegExp(`since the visit on ${since!.replace('Since the visit on ', '')}`))).toBeVisible()
})

test('another day has its own visits', async ({ page }) => {
  await page.goto('/today')
  await page.getByRole('button', { name: 'Next day' }).click()
  await expect(page.getByText('No visits are booked for this day.')).toBeVisible()
  await page.getByRole('button', { name: 'Back to today' }).click()
  await expect(visits(page)).toHaveCount(4)
})

test('the day fits a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/today')
  await expect(visits(page)).toHaveCount(4)
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0)
  await expectNoViolations(page)
})
