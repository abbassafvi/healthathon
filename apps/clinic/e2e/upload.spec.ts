import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

import { query, reseed } from './db'
import { doc } from './page'

// A real read takes seconds, and this file does several per test.
test.beforeEach(() => {
  test.setTimeout(120_000)
  reseed()
})

async function start(page: Page, patient: string, type: 'Prescription' | 'Laboratory report') {
  await page.goto('/')
  await page.getByRole('link', { name: 'Upload' }).click()
  await page.getByLabel('Patient').selectOption({ label: patient })
  await page.getByText(type, { exact: true }).click()
}

test('a lab report photograph is read and says where its values went', async ({ page }) => {
  await start(page, 'Asha Verma (DEV-0001)', 'Laboratory report')
  // Four regions of writing, the last one smeared.
  await page.getByTestId('file-input').setInputFiles([doc('lab')])
  await page.getByRole('button', { name: 'Upload and read' }).click()

  const row = page.locator('[data-upload-stage]').first()
  await expect(row).toHaveAttribute('data-upload-stage', 'done', { timeout: 30000 })
  await expect(row).toContainText('3 values are in the record.')
  await expect(row).toContainText('1 sent to the confirm queue: This part of the image is hard to read.')

  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'))
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
  expect(violations.map((v) => v.id)).toEqual([])
})

test('every value read is stored with the region it came from', async ({ page }) => {
  await start(page, 'Asha Verma (DEV-0001)', 'Laboratory report')
  await page.getByTestId('file-input').setInputFiles([doc('lab')])
  await page.getByRole('button', { name: 'Upload and read' }).click()
  await expect(page.locator('[data-upload-stage="done"]')).toHaveCount(1, { timeout: 30000 })

  // Only the pipeline writes under documents/; the seed writes under dev/.
  const rows = query<{ bbox_x: string | null; kind: string }>(
    `SELECT p.kind, p.bbox_x FROM core.extracted_value v
     JOIN core.provenance p ON p.id = v.provenance_id
     JOIN core.document d ON d.id = v.document_id
     WHERE d.storage_key LIKE 'documents/%'`,
  )
  expect(rows.length).toBe(4)
  expect(rows.every((r) => r.kind === 'source_document' && r.bbox_x !== null)).toBe(true)
})

test('an uploaded prescription goes to review, with a line per region read', async ({ page }) => {
  await start(page, 'Imran Qureshi (DEV-0002)', 'Prescription')
  await page.getByTestId('file-input').setInputFiles([doc('rx')])
  await page.getByRole('button', { name: 'Upload and read' }).click()

  await page.getByRole('link', { name: 'Review prescription' }).click({ timeout: 30000 })
  await expect(page.getByRole('heading', { name: 'Review prescription' })).toBeVisible()
  await expect(page.locator('li[data-item-id]')).toHaveCount(2)
})

test('a prescription nothing could be read from leads back to the record', async ({ page }) => {
  // One region is not enough for the stand-in reader to stand behind a line.
  await start(page, 'Rakesh Yadav (DEV-0004)', 'Prescription')
  await page.getByTestId('file-input').setInputFiles([doc('single')])
  await page.getByRole('button', { name: 'Upload and read' }).click()

  const row = page.locator('[data-upload-stage]').first()
  await expect(row).toHaveAttribute('data-upload-stage', 'done', { timeout: 30000 })
  await expect(row.getByRole('link', { name: 'Open the checklist' })).toBeVisible()
})

test('a page with no writing on it fails and keeps the photograph', async ({ page }) => {
  await start(page, 'Asha Verma (DEV-0001)', 'Laboratory report')
  await page.getByTestId('file-input').setInputFiles([doc('blank')])
  await page.getByRole('button', { name: 'Upload and read' }).click()

  const row = page.locator('[data-upload-stage]').first()
  await expect(row).toHaveAttribute('data-upload-stage', 'failed', { timeout: 30000 })
  await expect(row).toContainText('could not be found')
})

test('several photographs upload together, and a repeat is recognised', async ({ page }) => {
  await start(page, 'Meera Pillai (DEV-0003)', 'Laboratory report')
  await page.getByTestId('file-input').setInputFiles([doc('p1'), doc('p2')])
  await page.getByRole('button', { name: 'Upload and read 2 photographs' }).click()
  await expect(page.locator('[data-upload-stage="done"]')).toHaveCount(2, { timeout: 60000 })

  // The same bytes again, under a different name.
  await page.getByTestId('file-input').setInputFiles([doc('p1', 'p1-again.png')])
  await page.getByRole('button', { name: 'Upload and read' }).click()
  await expect(page.getByText('This photograph is already in this record. Nothing new was added.')).toBeVisible()
})
