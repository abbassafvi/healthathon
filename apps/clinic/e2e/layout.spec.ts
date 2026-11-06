import { expect, test } from '@playwright/test'

import { query, reseed } from './db'

test.beforeEach(async () => {
  reseed()
})

test('the header and every page share one left edge', async ({ page }) => {
  const [{ id }] = query<{ id: string }>("SELECT id FROM core.patient WHERE registration_no = 'DEV-0001'")
  const [{ id: regimen }] = query<{ id: string }>(
    "SELECT r.id FROM core.regimen r JOIN core.patient p ON p.id = r.patient_id" +
      " WHERE p.registration_no = 'DEV-0002' AND r.activated_at IS NULL LIMIT 1",
  )
  const [{ id: imran }] = query<{ id: string }>("SELECT id FROM core.patient WHERE registration_no = 'DEV-0002'")
  for (const path of ['/today', '/queue', '/patients', '/upload', '/audit', `/patients/${id}/visit`, `/patients/${id}/timeline`,
    `/patients/${id}/checklist`, `/patients/${id}/documents`, `/patients/${id}/paper-form`,
    `/patients/${imran}/checklist/review/${regimen}`]) {
    await page.goto(path)
    const heading = page.locator('h1').first()
    await expect(heading).toBeVisible()
    const brand = (await page.getByTestId('brand').boundingBox())!
    const h1 = (await heading.boundingBox())!
    expect(Math.round(h1.x), path).toBe(Math.round(brand.x))
  }
})
