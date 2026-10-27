import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

import { reseed } from './db'

/* Real API and the stand-in seed: document values and patient entries alike. */
test.beforeEach(() => reseed())

async function openTimeline(page: Page, name = 'Asha Verma') {
  await page.goto('/patients')
  await page.getByRole('link', { name }).click()
  await page.getByRole('link', { name: 'Timeline', exact: true }).click()
  await expect(page.locator('[data-day]').first()).toBeVisible()
}

test('four weeks, newest first, with both halves of each day', async ({ page }) => {
  await openTimeline(page)
  await expect(page.locator('[data-day]')).toHaveCount(28)
  const first = page.locator('[data-day]').first()
  await expect(first.getByRole('region', { name: /From the patient/ })).toBeVisible()
  await expect(page.getByText('Entries were made by the patient in the app unless marked otherwise.')).toBeVisible()
})

test('a lab report sits on its date and each value opens its trace', async ({ page }) => {
  await openTimeline(page)
  const link = page.getByRole('link', { name: /HbA1c 8\.4 %, see where it came from/ })
  await expect(link).toBeVisible()
  await link.click()
  await expect(page).toHaveURL(/\/documents\/values\//)
  await expect(page.getByRole('dialog', { name: 'Where this value came from' }).getByRole('img')).toBeVisible()
})

test('medicine gaps are shown as gaps', async ({ page }) => {
  await openTimeline(page)
  await expect(page.locator('[data-tick-state="ticked"]').first()).toBeVisible()
  expect(await page.locator('[data-tick-state="no_entry"]').count()).toBeGreaterThan(0)
  await expect(page.locator('[data-tick-state="no_entry"]').first()).toContainText('No entry')
})

test('Urdu answers render right to left', async ({ page }) => {
  await openTimeline(page, 'Imran Qureshi')
  const urdu = page.locator('[lang="ur"]').first()
  await expect(urdu).toHaveAttribute('dir', 'rtl')
  const box = await urdu.boundingBox()
  expect(box).toBeTruthy()
})

test('timeline has no accessibility violations', async ({ page }) => {
  await openTimeline(page)
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'))
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze()
  expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(', ')}`)).toEqual([])
})
