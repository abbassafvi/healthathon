import { expect, test, type Page } from '@playwright/test'

import { query, reseed } from './db'

test.beforeEach(() => reseed())

const UNDO_WINDOW_MS = 5000
const panel = (page: Page) => page.getByRole('dialog', { name: 'Where this value came from' })
const valueRows = (page: Page) => page.locator('[data-value-id]')

async function openAsha(page: Page) {
  await page.goto('/')
  await page.getByRole('link', { name: 'Patients' }).click()
  await page.getByRole('link', { name: 'Asha Verma' }).click()
  await expect(page.getByRole('heading', { name: 'Asha Verma' })).toBeVisible()
}

function provenanceBox(registrationNo: string, analyte: string) {
  const [row] = query<{ x: number; y: number; w: number; h: number }>(`
    SELECT p.bbox_x * pg.width_px AS x, p.bbox_y * pg.height_px AS y,
           p.bbox_w * pg.width_px AS w, p.bbox_h * pg.height_px AS h
    FROM proj.renderable_value rv
    JOIN core.provenance p ON p.id = rv.provenance_id
    JOIN core.document_page pg ON pg.id = p.page_id
    JOIN core.patient pt ON pt.id = rv.patient_id
    WHERE pt.registration_no = '${registrationNo}' AND rv.analyte_code = '${analyte}'`)
  return [row.x, row.y, row.w, row.h].map((n) => Number(n).toFixed(1)).join(' ')
}

test('the record lists only values in the record, in page order', async ({ page }) => {
  await openAsha(page)
  await expect(valueRows(page)).toHaveText([/HbA1c\s*8\.4\s*%/, /Serum creatinine\s*0\.92/, /LDL cholesterol\s*118/])
  // Fasting glucose is waiting in the confirm queue, so it is not shown.
  await expect(page.getByText('Fasting plasma glucose')).toHaveCount(0)
})

test('tapping a value draws its stored region on the original page', async ({ page }) => {
  await openAsha(page)
  await valueRows(page).filter({ hasText: 'HbA1c' }).click()
  await expect(page).toHaveURL(/\/patients\/[\w-]+\/documents\/values\/[\w-]+$/)
  await expect(panel(page)).toBeVisible()
  const svg = panel(page).getByRole('img', { name: /Page 1 of Lab report/ })
  await expect(svg).toBeVisible()
  await expect(panel(page).getByTestId('trace-box')).toHaveAttribute('data-box', provenanceBox('DEV-0001', 'hba1c'))
  await expect(panel(page).getByTestId('trace-history')).toHaveText('Accepted by the checks. No person changed it.')
  await expect(panel(page).getByText('Sunrise Diagnostics (fictional)')).toBeVisible()
  await expect(panel(page).getByText('dev-seed 0')).toBeVisible()

  // The outline is on screen, inside the visible part of the page.
  const outline = await panel(page).getByTestId('trace-box').locator('rect').last().boundingBox()
  const frame = await svg.boundingBox()
  expect(outline && frame).toBeTruthy()
  expect(outline!.x).toBeGreaterThanOrEqual(frame!.x)
  expect(outline!.x + outline!.width).toBeLessThanOrEqual(frame!.x + frame!.width)
})

test('W switches between the value and the whole page', async ({ page }) => {
  await openAsha(page)
  await valueRows(page).filter({ hasText: 'LDL' }).click()
  const svg = panel(page).getByRole('img')
  await expect(svg).toHaveAttribute('data-mode', 'zoom')
  const zoomed = (await svg.getAttribute('viewBox'))!.split(' ').map(Number)
  // On a desk screen the zoom is a full-width band around the value's row.
  expect(zoomed[2]).toBe(1240)
  expect(zoomed[3]).toBeLessThan(1754 * 0.6)
  await page.keyboard.press('w')
  await expect(svg).toHaveAttribute('data-mode', 'page')
  await expect(svg).toHaveAttribute('viewBox', '0.0 0.0 1240.0 1754.0')
  await page.keyboard.press('w')
  await expect(svg).toHaveAttribute('viewBox', zoomed.map((n) => n.toFixed(1)).join(' '))
})

test('Escape and Back both close the trace, and focus returns to the value', async ({ page }) => {
  await openAsha(page)
  const row = valueRows(page).filter({ hasText: 'Serum creatinine' })
  await row.click()
  await expect(panel(page)).toBeVisible()
  await expect(row).toHaveAttribute('aria-current', 'true')
  await page.keyboard.press('Escape')
  await expect(panel(page)).toHaveCount(0)
  await expect(row).toBeFocused()

  await row.press('Enter')
  await expect(panel(page)).toBeVisible()
  await page.goBack()
  await expect(panel(page)).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Asha Verma' })).toBeVisible()
})

test('a value confirmed in the queue joins the record and names who confirmed it', async ({ page }) => {
  await page.goto('/queue')
  await expect(page.getByRole('button', { name: /confirm as read/i })).toBeEnabled()
  await page.keyboard.press('Enter')
  await expect(page.getByText('Confirmed 162 mg/dL')).toBeVisible()
  await expect
    .poll(() => query(`SELECT 1 FROM core.extracted_value WHERE state = 'confirmed'`).length, {
      timeout: UNDO_WINDOW_MS + 3000,
    })
    .toBe(1)

  await openAsha(page)
  await expect(valueRows(page)).toHaveText([/HbA1c/, /Fasting plasma glucose\s*162/, /Serum creatinine/, /LDL/])
  await valueRows(page).filter({ hasText: 'Fasting plasma glucose' }).click()
  await expect(panel(page).getByTestId('trace-history')).toHaveText(
    /^Confirmed as read by Dr\. Demo Clinician, \d{1,2} \w{3} \d{4},? \d{2}:\d{2}\.$/,
  )
})

test('a corrected value shows what the reader had', async ({ page }) => {
  await page.goto('/queue')
  await expect(page.getByRole('button', { name: /confirm as read/i })).toBeEnabled()
  await page.keyboard.press('c')
  await page.getByLabel(/value as it appears/i).fill('168')
  await page.keyboard.press('Enter')
  await expect
    .poll(() => query(`SELECT 1 FROM core.value_correction`).length, { timeout: UNDO_WINDOW_MS + 3000 })
    .toBe(1)

  await openAsha(page)
  await valueRows(page).filter({ hasText: 'Fasting plasma glucose' }).click()
  await expect(panel(page).getByText('168', { exact: true })).toBeVisible()
  await expect(panel(page).getByTestId('trace-history')).toHaveText(/The reader had 162 mg\/dL\.$/)
  // Same region as the original reading.
  await expect(panel(page).getByTestId('trace-box')).toHaveAttribute('data-box', provenanceBox('DEV-0001', 'fpg'))
})

test('a value still in the queue cannot be traced, even by URL', async ({ page }) => {
  const [v] = query<{ id: string; patient_id: string }>(
    `SELECT id, patient_id FROM core.extracted_value WHERE state = 'needs_confirm' LIMIT 1`,
  )
  await page.goto(`/patients/${v.patient_id}/documents/values/${v.id}`)
  await expect(panel(page).getByText(/this value is not shown in the record/i)).toBeVisible()
  await expect(panel(page).getByRole('img')).toHaveCount(0)
})

test('reading a record and tracing a value are both audited', async ({ page }) => {
  await openAsha(page)
  await valueRows(page).filter({ hasText: 'HbA1c' }).click()
  await expect(panel(page).getByRole('img')).toBeVisible()
  await expect
    .poll(() => query<{ action: string }>('SELECT action FROM audit.event ORDER BY id').map((r) => r.action))
    .toEqual(expect.arrayContaining(['record.read', 'value.trace']))
})
