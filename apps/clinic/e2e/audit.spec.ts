import { expect, test } from '@playwright/test'

import { expectNoViolations } from './axe'
import { query, reseed } from './db'
import { withoutMocks } from './mocks'

test.beforeEach(async ({ page }) => {
  reseed()
  await withoutMocks(page)
})

test('a decision made in the queue appears in the audit log, with the chain checked', async ({ page }) => {
  await page.goto('/queue')
  await expect(page.getByRole('button', { name: /confirm as read/i })).toBeEnabled()
  await page.keyboard.press('Enter')
  await expect.poll(() => query("SELECT 1 FROM audit.event WHERE action = 'value.confirm'").length, { timeout: 15_000 }).toBe(1)

  await page.getByRole('link', { name: 'Audit log' }).click()
  await expect(page.getByRole('status')).toContainText('Chain intact')
  await page.getByRole('button', { name: 'Decisions' }).click()
  const row = page.getByRole('row').filter({ hasText: 'Confirmed a value as read' })
  await expect(row).toContainText('Dr. Demo Clinician')
  await expect(row).toContainText('Asha Verma')
  await expect(row).toContainText('Reason: This part of the image is hard to read.')
  await expectNoViolations(page)
})

test('opening the log is itself in the log', async ({ page }) => {
  await page.goto('/audit')
  await page.getByRole('button', { name: 'Reads' }).click()
  await expect(page.getByRole('row').nth(1)).toContainText('Opened the audit log')
})

test('a changed row breaks the chain, and the log says where', async ({ page }) => {
  await page.goto('/today')
  await expect(page.getByRole('main').getByRole('listitem')).toHaveCount(4)
  const [{ id }] = query<{ id: number }>('SELECT min(id) AS id FROM audit.event')
  query(`UPDATE audit.event SET reason_code = 'edited' WHERE id = ${id} RETURNING id`)
  await page.goto('/audit')
  await expect(page.getByRole('status')).toContainText(`Chain broken at event ${id}`)
})
