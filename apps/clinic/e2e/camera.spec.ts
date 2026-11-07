import { expect, test, type Page } from '@playwright/test'

import { expectNoViolations } from './axe'
import { reseed } from './db'

/*
 * Photographing a page at the desk, driven with Chrome's fake capture
 * device: a real stream and a real canvas grab, no hardware. Without
 * this the live path is only ever exercised by its error state.
 *
 * launchOptions forces its own worker, so Playwright will not take it
 * inside a describe block. That is why the camera has its own file.
 */
test.use({
  permissions: ['camera'],
  launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] },
})

test.beforeEach(() => reseed())

async function openCamera(page: Page) {
  await page.goto('/')
  await page.getByRole('link', { name: 'Upload' }).click()
  await page.getByLabel('Patient').selectOption({ label: 'Asha Verma (DEV-0001)' })
  await page.getByText('Laboratory report', { exact: true }).click()
  await page.getByTestId('open-camera').click()
  await page.getByRole('button', { name: 'Take the photograph' }).waitFor({ timeout: 30000 })
}

test('a photograph is held for a look, then joins the photographs to upload', async ({ page }) => {
  await openCamera(page)
  await page.getByRole('button', { name: 'Take the photograph' }).click()

  // Nothing is added until a person says so.
  await expect(page.getByAltText('The photograph just taken')).toBeVisible()
  await expect(page.getByRole('button', { name: /^Upload and read/ })).toBeDisabled()

  await page.getByRole('button', { name: 'Use this photograph' }).click()
  await expect(page.getByRole('button', { name: /^Upload and read/ })).toBeEnabled()
  await expect(page.locator('img[alt^="photograph-"]')).toHaveCount(1)
})

test('a photograph taken again replaces the one held', async ({ page }) => {
  await openCamera(page)
  await page.getByRole('button', { name: 'Take the photograph' }).click()
  await page.getByRole('button', { name: 'Take it again' }).click()

  await expect(page.getByAltText('The photograph just taken')).toBeHidden()
  await expect(page.getByRole('button', { name: /^Upload and read/ })).toBeDisabled()
})

test('the camera panel has no accessibility violations', async ({ page }) => {
  await openCamera(page)
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'))
  await expectNoViolations(page)
})
