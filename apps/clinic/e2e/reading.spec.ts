import { expect, test, type Page } from '@playwright/test'

import { expectNoViolations } from './axe'
import { query, reseed } from './db'
import { withoutMocks } from './mocks'

test.beforeEach(async ({ page }) => {
  reseed()
  await withoutMocks(page)
})

async function openAshaReport(page: Page) {
  const [{ id }] = query<{ id: string }>("SELECT id FROM core.patient WHERE registration_no = 'DEV-0001'")
  await page.goto(`/patients/${id}/documents`)
  await page.getByRole('link', { name: 'How this document was read' }).first().click()
  await expect(page.getByRole('heading', { name: 'How this document was read' })).toBeVisible()
}

const rows = (page: Page) => page.getByRole('main').locator('ol > li')

test('says how much of a report went straight to the record and how much to a person', async ({ page }) => {
  await openAshaReport(page)
  await expect(page.getByRole('main')).toContainText('4values read')
  await expect(page.getByRole('main')).toContainText('3passed every check and went straight to the record')
  await expect(page.getByRole('main')).toContainText('1went to a person')
  await expect(rows(page)).toHaveCount(4)
  await expect(page.getByRole('img', { name: /every region the reader found/ })).toBeVisible()
  await expectNoViolations(page)
})

test('a value waiting for a person is never shown, until a person settles it', async ({ page }) => {
  await openAshaReport(page)
  const fpg = rows(page).filter({ hasText: 'Fasting plasma glucose' })
  await expect(fpg).toContainText('Not shown until a person settles it')
  await expect(fpg).toContainText('Region hard to read')
  await expect(page.getByRole('main')).not.toContainText('162')

  await fpg.getByRole('link', { name: 'Waiting in the confirm queue' }).click()
  await expect(page.getByRole('button', { name: /confirm as read/i })).toBeEnabled()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('button', { name: /undo/i })).toBeVisible()
  // The decision is sent once the undo window closes.
  await expect.poll(() => query("SELECT 1 FROM core.extracted_value WHERE state = 'confirmed'").length, { timeout: 15_000 }).toBe(1)

  await page.goBack()
  const settled = rows(page).filter({ hasText: 'Fasting plasma glucose' })
  await expect(settled).toContainText('162')
  await expect(settled).toContainText(/Confirmed as read by Dr\. Demo Clinician, .+, after \d+\.\d s\./)
})

test('a prescription says every line went to a person, and who reviewed each', async ({ page }) => {
  const [{ id }] = query<{ id: string }>("SELECT id FROM core.patient WHERE registration_no = 'DEV-0001'")
  await page.goto(`/patients/${id}/checklist`)
  await page.getByRole('link', { name: 'How this prescription was read' }).click()
  await expect(page.getByText(/Every line of a handwritten prescription goes to a person/)).toBeVisible()
  await expect(rows(page).first()).toContainText(/Confirmed by Dr\. Demo Clinician/)
  await expectNoViolations(page)
})
