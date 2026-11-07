import { expect, test, type Page } from '@playwright/test'

import { expectNoViolations } from './axe'
import { query, reseed } from './db'

test.beforeEach(async () => {
  reseed()
})

const asha = () => query<{ id: string }>("SELECT id FROM core.patient WHERE registration_no = 'DEV-0001'")[0].id
const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)

test("the patient list carries each record's facts, and finds a patient", async ({ page }) => {
  await page.goto('/patients')
  await expect(page).toHaveTitle('Patients · Consultation Readiness')
  const row = page.getByRole('row').filter({ hasText: 'Asha Verma' })
  await expect(row).toContainText('Priya Verma')
  await expect(row).toContainText('3 medicines')
  await expect(row).toContainText(/Today, \d\d:\d\d/)
  await expectNoViolations(page)

  await page.keyboard.press('/')
  await expect(page.getByLabel('Find a patient')).toBeFocused()
  await page.keyboard.type('pillai')
  await expect(page.getByRole('link', { name: 'Meera Pillai' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Asha Verma' })).toHaveCount(0)
  await expect(page).toHaveURL(/\?q=pillai$/)
})

test('on a phone the patient list stacks instead of scrolling sideways', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/patients')
  await expect(page.getByRole('link', { name: 'Asha Verma' })).toBeVisible()
  expect(await overflow(page)).toBe(0)
  await expect(page.getByRole('row').filter({ hasText: 'Asha Verma' })).toBeInViewport()
  await expectNoViolations(page)
})

test("the patient header states the record's dates, and uploads for that patient", async ({ page }) => {
  await page.goto(`/patients/${asha()}/visit`)
  const facts = page.getByLabel('About this patient')
  await expect(facts).toContainText('Next visit')
  await expect(facts).toContainText('Checklist3 medicines')
  await expect(page.getByText('Caregiver Priya Verma, daughter')).toBeVisible()
  await expect(page).toHaveTitle('Visit · Asha Verma · Consultation Readiness')
  await page.getByRole('link', { name: 'Upload a document' }).click()
  await expect(page.getByLabel('Patient')).toHaveValue(asha())
  await expect(page).toHaveTitle('Upload documents · Consultation Readiness')
})

test('the documents tab lists prescriptions with where each stands', async ({ page }) => {
  await page.goto(`/patients/${asha()}/documents`)
  await expect(page.getByText(/lines waiting for review before they reach the checklist/)).toBeVisible()
  await expect(page.getByText(/^The checklist in force since/)).toBeVisible()
  await page.getByRole('link', { name: 'Review the lines' }).click()
  await expect(page).toHaveURL(/\/checklist\/review\//)
  await page.goBack()
  await expectNoViolations(page)
})

test('an address that leads nowhere has its own page', async ({ page }) => {
  await page.goto('/no/such/page')
  await expect(page.getByRole('heading', { name: 'There is no page at this address' })).toBeVisible()
  await page.getByRole('main').getByRole('link', { name: 'Patients' }).click()
  await expect(page).toHaveURL(/\/patients$/)
  await page.goto('/no/such/page')
  await expectNoViolations(page)
})

test('a screen that fails to load says so and tries again', async ({ page }) => {
  let fail = true
  await page.route('**/api/clinic-day**', (route) => (fail ? route.fulfill({ status: 503, body: '{}' }) : route.fallback()))
  await page.goto('/today')
  const alert = page.getByRole('alert')
  await expect(alert).toContainText('The day could not be loaded.')
  await expectNoViolations(page)
  fail = false
  await alert.getByRole('button', { name: 'Try again' }).click()
  await expect(page.getByRole('main').getByRole('listitem')).toHaveCount(4)
})

test('choosing a value zooms the page to it, so it can be read', async ({ page }) => {
  await page.goto(`/patients/${asha()}/documents`)
  await page.getByRole('link', { name: 'How this document was read' }).first().click()
  const viewer = page.getByRole('img', { name: /every region the reader found/ })
  await expect(viewer).toHaveAttribute('data-mode', 'page')
  await page.getByRole('main').locator('ol button').nth(1).click()
  await expect(viewer).toHaveAttribute('data-mode', 'zoom')
  await page.getByRole('button', { name: 'Whole page' }).click()
  await expect(viewer).toHaveAttribute('data-mode', 'page')
})

test('the audit log heads each day, and fits a phone', async ({ page }) => {
  await page.goto('/today')
  await page.goto('/audit')
  await expect(page.getByRole('columnheader', { name: 'Today' })).toBeVisible()
  await expect(page.locator('tr[data-kind] time').first()).toHaveText(/^\d\d:\d\d$/)
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await overflow(page)).toBe(0)
  await expectNoViolations(page)
})

test('every screen names the build in its footer and says the data is fictional', async ({ page }) => {
  await page.goto('/today')
  await expect(page.getByRole('contentinfo')).toContainText(/Consultation Readiness \d+\.\d+\.\d+, build \w+/)
  await expect(page.getByRole('banner')).toContainText('Demo: fictional patients')
  await expect(page.getByRole('banner')).toContainText('Dr. Demo Clinician')
})
