import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

import { reseed } from './db'

/*
 * The checklist endpoints are served by the in-browser mock layer
 * (src/mocks) until they are built in api/. Mock state lives in the page,
 * so every test starts from the same fixtures.
 */
test.beforeEach(() => reseed())

async function openChecklist(page: Page) {
  await page.goto('/patients')
  await page.getByRole('link', { name: 'Asha Verma' }).click()
  await page.getByRole('link', { name: 'Checklist', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Active checklist' })).toBeVisible()
}

async function openReview(page: Page) {
  await openChecklist(page)
  await page.getByRole('link', { name: 'Review' }).click()
  await expect(page.getByRole('heading', { name: 'Review prescription' })).toBeVisible()
}

const rows = (page: Page) => page.locator('li[data-item-id]')
const focusedConfirm = (page: Page) => rows(page).and(page.locator('[aria-current="true"]')).getByRole('button', { name: /^Confirm/ })

async function expectNoViolations(page: Page) {
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'))
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze()
  expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(', ')}`)).toEqual([])
}

test('the checklist shows the active list as printed and the prescription waiting', async ({ page }) => {
  await openChecklist(page)
  const active = page.getByRole('region', { name: 'Active checklist' })
  await expect(active.getByRole('listitem')).toHaveText([/Tab\. Metformin\s*500 mg\s*1-0-1/, /Tab\. Glimepiride/, /Tab\. Atorvastatin/])
  await expect(page.getByRole('region', { name: 'Waiting for review' })).toContainText('0 of 4 confirmed')
  await expectNoViolations(page)
})

test('each line unlocks only after its crop renders', async ({ page }) => {
  // Mock images are served in the page by MSW, which page.route cannot
  // intercept, so the mock layer holds them back on request.
  await page.addInitScript(() => {
    ;(globalThis as { __MOCK_IMAGE_DELAY_MS?: number }).__MOCK_IMAGE_DELAY_MS = 2500
  })
  await openReview(page)
  await expect(rows(page)).toHaveCount(4)
  for (const b of await page.getByRole('button', { name: /^Confirm$/ }).all()) await expect(b).toBeDisabled()
  await page.keyboard.press('Enter')
  await expect(focusedConfirm(page)).toBeEnabled({ timeout: 10_000 })
  await expect(page.getByText('0 of 4 confirmed')).toBeVisible()
})

test('a prescription is confirmed from the keyboard, activated, and replaces the old list', async ({ page }) => {
  await openReview(page)
  await expect(page.getByText(/replaces the checklist activated .* \(3 medicines\)/)).toBeVisible()
  await expectNoViolations(page)
  for (let n = 1; n <= 4; n++) {
    await expect(focusedConfirm(page)).toBeEnabled()
    await page.keyboard.press('Enter')
    await expect(page.getByText(`${n} of 4 confirmed`)).toBeVisible()
  }
  const activate = page.getByRole('button', { name: 'Activate checklist' })
  await expect(activate).toBeEnabled()
  await activate.click()
  await expect(page.getByText(/^Checklist active since/)).toBeVisible()

  await page.getByRole('link', { name: 'Back to the checklist' }).click()
  const active = page.getByRole('region', { name: 'Active checklist' })
  await expect(active.getByRole('listitem')).toHaveCount(4)
  await expect(active).toContainText('Tab. Metformin1000 mg')
  await expect(active).toContainText('Tab. Telmisartan')
  await expect(page.getByRole('region', { name: 'Waiting for review' })).toHaveCount(0)
})

test('a line can be corrected or removed before activation', async ({ page }) => {
  await openReview(page)
  await expect(focusedConfirm(page)).toBeEnabled()
  await page.keyboard.press('c')
  await expect(page.getByLabel('Medicine as written')).toBeFocused()
  await expectNoViolations(page)
  await page.getByLabel('Medicine as written').fill('Tab. Metformin SR')
  await page.getByLabel('Dose as written').fill('1000 mg')
  await page.getByLabel('Schedule as written').fill('1-0-1')
  await page.keyboard.press('Enter')
  await expect(rows(page).first()).toContainText('Tab. Metformin SR')
  await expect(rows(page).first()).toContainText('Confirmed by Dr. Demo Clinician')

  // Focus moved to line 2; mark it not a medicine.
  await expect(focusedConfirm(page)).toBeEnabled()
  await page.keyboard.press('x')
  await expect(rows(page)).toHaveCount(3)
  await expect(page.getByText('1 of 3 confirmed')).toBeVisible()
})

test('the page outline follows the focused line', async ({ page }) => {
  await openReview(page)
  const focusedBox = page.getByTestId('trace-box')
  const first = await focusedBox.getAttribute('data-box')
  await page.keyboard.press('j')
  await expect(focusedBox).not.toHaveAttribute('data-box', first!)
  await expect(page.getByTestId('page-mark')).toHaveCount(3)
})
