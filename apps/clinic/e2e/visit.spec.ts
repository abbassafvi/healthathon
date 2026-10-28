import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

import { reseed } from './db'

test.beforeEach(() => reseed())

async function openVisit(page: Page, name = 'Asha Verma') {
  await page.goto('/patients')
  await page.getByRole('link', { name }).click()
  await expect(page).toHaveURL(/\/visit$/)
  await expect(page.getByRole('heading', { name: /^Visit, / })).toBeVisible()
}

async function expectNoViolations(page: Page) {
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'))
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze()
  expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(', ')}`)).toEqual([])
}

test('a patient opens on the visit page, with both halves', async ({ page }) => {
  await openVisit(page)
  await expect(page.getByRole('region', { name: /From documents since the last visit/ })).toBeVisible()
  await expect(page.getByRole('region', { name: /From the patient since the last visit/ })).toBeVisible()
  await expect(page.getByTestId('score-count')).toHaveText(/^\d+ of \d+ ticks$/)
  await expectNoViolations(page)
})

test('the score opens onto its day array, and the cells add up to it', async ({ page }) => {
  await openVisit(page)
  const [ticked, expected] = (await page.getByTestId('score-count').textContent())!.match(/\d+/g)!.map(Number)
  await page.getByRole('button', { name: 'Show the days' }).click()
  const grid = page.getByRole('grid', { name: 'Ticks by medicine and day' })
  await expect(grid).toBeVisible()
  await expect(grid.locator('[data-cell-state]')).toHaveCount(expected)
  await expect(grid.locator('[data-cell-state="ticked"]')).toHaveCount(ticked)
  await expectNoViolations(page)

  await grid.locator('[data-cell-state="no_entry"]').first().click()
  await expect(page.getByTestId('cell-detail')).toContainText('No entry.')
})

test('the day array works from the keyboard', async ({ page }) => {
  await openVisit(page)
  await page.getByRole('button', { name: 'Show the days' }).focus()
  await page.keyboard.press('Enter')
  await page.keyboard.press('Tab')
  const start = await page.evaluate(() => document.activeElement?.getAttribute('data-date'))
  expect(start).toBeTruthy()
  await page.keyboard.press('ArrowLeft')
  const moved = await page.evaluate(() => document.activeElement?.getAttribute('data-date'))
  expect(moved! < start!).toBe(true)
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('cell-detail')).toBeVisible()
})

test('a document value on the visit page opens its trace', async ({ page }) => {
  await openVisit(page)
  await page.getByRole('region', { name: 'Laboratory values' }).getByRole('link', { name: /HbA1c/ }).click()
  await expect(page.getByRole('dialog', { name: 'Where this value came from' }).getByRole('img')).toBeVisible()
})

test('a patient with no checklist sees no score', async ({ page }) => {
  await openVisit(page, 'Imran Qureshi')
  await expect(page.getByText('No checklist was active in this period, so there are no ticks to count.')).toBeVisible()
  await expect(page.getByTestId('score-count')).toHaveCount(0)
})

test('the documents half stays in view while the patient half scrolls', async ({ page }) => {
  await openVisit(page)
  const docs = page.getByRole('region', { name: /From documents since the last visit/ })
  await expect(docs).toHaveAttribute('data-pinned', 'true')
  await page.getByRole('heading', { name: 'Meal photographs' }).scrollIntoViewIfNeeded()
  await expect(docs.getByRole('heading', { name: 'Laboratory values' })).toBeInViewport()
})

test('a tick made in the patient app today appears in the day array', async ({ page, request }) => {
  // Asha's phone signs in as the app does: her number, then the code (shown, since the API is in test mode).
  const phone = '55500 00001'
  const { demo_code } = (await (await request.post('/api/app/sign-in/start', { data: { phone } })).json()) as { demo_code: string }
  const signed = (await (await request.post('/api/app/sign-in/check', { data: { phone, code: demo_code } })).json()) as {
    token: string
    patient: { id: string }
  }
  const headers = { Authorization: `Bearer ${signed.token}` }
  const asha = signed.patient
  const today = (await (await request.get(`/api/app/patients/${asha.id}/today`, { headers })).json()) as { date: string; items: { id: string; drug_text: string }[] }
  const item = today.items[0]
  const res = await request.put(`/api/app/patients/${asha.id}/ticks/${item.id}`, {
    headers,
    data: { ticked: true, capture_id: 'e2e-visit-tick-0001' },
  })
  expect(res.status()).toBe(204)
  await openVisit(page)
  await page.getByRole('button', { name: 'Show the days' }).click()
  const row = page.getByRole('row').filter({ has: page.getByRole('rowheader', { name: new RegExp(item.drug_text) }) }).last()
  await expect(row.locator(`[data-date="${today.date}"]`)).toHaveAttribute('data-cell-state', 'ticked')
})
