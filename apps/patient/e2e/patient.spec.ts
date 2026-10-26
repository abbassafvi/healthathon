import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

async function start(page: Page, lang: 'English' | 'हिन्दी' | 'اردو', patient: string) {
  await page.goto('/')
  await page.getByRole('radio', { name: lang }).click()
  await page.getByRole('radio', { name: patient }).click()
  await page.getByRole('button', { name: /^(Start|शुरू करें|شروع کریں)$/ }).click()
}

async function expectNoViolations(page: Page) {
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze()
  expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(', ')}`)).toEqual([])
}

test('first launch picks a language and a demo patient, and remembers them', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('Demo: these are fictional patients.')).toBeVisible()
  await expectNoViolations(page)
  await start(page, 'English', 'Asha Verma')
  await expect(page.getByText('Hello, Asha')).toBeVisible()
  await page.reload()
  await expect(page.getByText('Hello, Asha')).toBeVisible()
})

test('a medicine is ticked with one tap and unticked with another', async ({ page }) => {
  await start(page, 'English', 'Asha Verma')
  const tick = page.getByRole('checkbox', { name: /Tab\. Metformin 500 mg/ })
  await expect(tick).toHaveAttribute('aria-checked', 'false')
  await tick.click()
  await expect(tick).toHaveAttribute('aria-checked', 'true')
  await expect(tick).toContainText('Taken')
  await tick.click()
  await expect(tick).toHaveAttribute('aria-checked', 'false')
  await expectNoViolations(page)
})

test('a sugar reading needs its time of day, then shows as typed', async ({ page }) => {
  await start(page, 'English', 'Meera Pillai')
  await page.getByRole('button', { name: 'Add a reading' }).click()
  await page.getByLabel('Reading from your meter (mg/dL)').fill('148')
  await page.getByRole('button', { name: 'Save reading' }).click()
  await expect(page.getByText('Choose when you took it.')).toBeVisible()
  await expectNoViolations(page)
  await page.getByRole('radio', { name: 'After a meal' }).click()
  await page.getByRole('button', { name: 'Save reading' }).click()
  const reading = page.getByTestId('reading')
  await expect(reading).toContainText('148')
  await expect(reading).toContainText('After a meal')
})

test('the day’s question and the weekly survey are answered as given', async ({ page }) => {
  await start(page, 'English', 'Meera Pillai')
  await page.getByRole('button', { name: 'No', exact: true }).click()
  await expect(page.getByText('Your answer: No')).toBeVisible()
  await page.getByRole('button', { name: 'Answer this week’s questions' }).click()
  await page.getByLabel('On how many days this week did you walk for 30 minutes?').fill('4')
  await page.getByLabel('Did you skip a meal this week?').fill('No')
  await expectNoViolations(page)
  await page.getByRole('button', { name: 'Send answers' }).click()
  await expect(page.getByText('Thank you. This week’s answers are sent.')).toBeVisible()
})

test('Urdu lays the whole app out right to left, in Nastaliq', async ({ page }) => {
  await start(page, 'اردو', 'Imran Qureshi')
  const heading = page.getByText('دوائیں', { exact: true })
  await expect(heading).toBeVisible()
  const dir = await heading.evaluate((el) => getComputedStyle(el).direction)
  expect(dir).toBe('rtl')
  const family = await heading.evaluate((el) => getComputedStyle(el).fontFamily)
  expect(family).toContain('NotoNastaliqUrdu')
  await expectNoViolations(page)
})

test('nothing interpretive is shown to the patient', async ({ page }) => {
  await start(page, 'English', 'Asha Verma')
  await page.getByRole('button', { name: 'Add a reading' }).click()
  await page.getByLabel('Reading from your meter (mg/dL)').fill('410')
  await page.getByRole('radio', { name: 'Before breakfast' }).click()
  await page.getByRole('button', { name: 'Save reading' }).click()
  await expect(page.getByTestId('reading')).toContainText('410')
  const text = await page.locator('body').innerText()
  expect(text).not.toMatch(/\b(high|low|normal|target|range|average|trend|score|risk|good|bad|poor)\b/i)
})
