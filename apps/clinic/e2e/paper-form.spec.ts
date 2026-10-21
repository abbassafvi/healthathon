import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

import { reseed } from './db'

test.beforeEach(() => reseed())

async function openForm(page: Page) {
  await page.goto('/patients')
  await page.getByRole('link', { name: 'Asha Verma' }).click()
  await page.getByRole('link', { name: 'Paper form', exact: true }).click()
  await expect(page.getByRole('grid', { name: 'Medicine ticks' })).toBeVisible()
}

async function expectNoViolations(page: Page) {
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'))
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze()
  expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(', ')}`)).toEqual([])
}

test('a paper form is copied from the keyboard and reaches the timeline', async ({ page }) => {
  await openForm(page)
  await expectNoViolations(page)
  const cell = page.locator('[data-cell]:not([data-locked])').first()
  const date = (await cell.getAttribute('data-cell'))!.split('|')[1]
  await cell.focus()
  await page.keyboard.press('n')
  await expect(cell).toHaveAttribute('data-value', 'not_ticked')

  await page.getByRole('button', { name: 'Add a reading' }).click()
  await page.getByLabel('Reading (mg/dL)').fill('151')
  await page.getByLabel('Context').selectOption('after_meal')
  await page.getByRole('button', { name: 'Check before saving' }).click()
  await expect(page.getByRole('heading', { name: 'You are about to save' })).toBeVisible()
  await expectNoViolations(page)
  await page.getByRole('button', { name: 'Save the form' }).click()
  await expect(page.getByText(/^Saved\. 2 entries are now in the record/)).toBeVisible()

  await page.getByRole('link', { name: 'See it on the timeline' }).click()
  const day = page.locator(`[data-day="${date}"]`)
  await expect(day.locator('[data-tick-state="not_ticked"]').first()).toBeVisible()
  await expect(day).toContainText('Paper form, entered by clinic staff')
})

test('the form will not continue with a reading that has no context', async ({ page }) => {
  await openForm(page)
  await page.getByRole('button', { name: 'Add a reading' }).click()
  await page.getByLabel('Reading (mg/dL)').fill('151')
  await page.getByRole('button', { name: 'Check before saving' }).click()
  await expect(page.getByRole('alert')).toContainText('Reading 1 needs its context.')
  await expectNoViolations(page)
})
