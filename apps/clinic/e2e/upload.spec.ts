import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

import { reseed } from './db'

test.beforeEach(() => reseed())

// A 1x1 PNG, generated here: no document image is ever committed.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
const photo = (name: string, salt = name) => ({ name, mimeType: 'image/png', buffer: Buffer.concat([PNG, Buffer.from(salt)]) })

async function start(page: Page, patient: string, type: 'Prescription' | 'Laboratory report') {
  await page.goto('/')
  await page.getByRole('link', { name: 'Upload' }).click()
  await page.getByLabel('Patient').selectOption({ label: patient })
  await page.getByText(type, { exact: true }).click()
}

test('a lab report photograph is read and says where its values went', async ({ page }) => {
  await start(page, 'Asha Verma (DEV-0001)', 'Laboratory report')
  await page.getByTestId('file-input').setInputFiles([photo('lab.png')])
  await page.getByRole('button', { name: 'Upload and read' }).click()
  const row = page.locator('[data-upload-stage]').first()
  await expect(row).toHaveAttribute('data-upload-stage', 'done', { timeout: 8000 })
  await expect(row).toContainText('3 values are in the record.')
  await expect(row).toContainText('1 sent to the confirm queue: This part of the image is hard to read.')
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'))
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
  expect(violations.map((v) => v.id)).toEqual([])
})

test('an uploaded prescription goes straight to review', async ({ page }) => {
  await start(page, 'Rakesh Yadav (DEV-0004)', 'Prescription')
  await page.getByTestId('file-input').setInputFiles([photo('rx.png')])
  await page.getByRole('button', { name: 'Upload and read' }).click()
  await page.getByRole('link', { name: 'Review prescription' }).click({ timeout: 8000 })
  await expect(page.getByRole('heading', { name: 'Review prescription' })).toBeVisible()
  await expect(page.locator('li[data-item-id]')).toHaveCount(2)
  await expect(page.getByText('This will be the first checklist for Rakesh Yadav.')).toBeVisible()
})

test('several photographs upload together, and a repeat is recognised', async ({ page }) => {
  await start(page, 'Meera Pillai (DEV-0003)', 'Laboratory report')
  await page.getByTestId('file-input').setInputFiles([photo('p1.png'), photo('p2.png')])
  await page.getByRole('button', { name: 'Upload and read 2 photographs' }).click()
  await expect(page.locator('[data-upload-stage="done"]')).toHaveCount(2, { timeout: 8000 })
  await page.getByTestId('file-input').setInputFiles([photo('p1-again.png', 'p1.png')])
  await page.getByRole('button', { name: 'Upload and read' }).click()
  await expect(page.getByText('This photograph is already in this record. Nothing new was added.')).toBeVisible()
})
