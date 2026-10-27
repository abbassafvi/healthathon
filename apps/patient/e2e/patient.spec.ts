import AxeBuilder from '@axe-core/playwright'
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

import { reseed } from './db'
import { API_URL } from './env'

/* The real API and a real database: every test starts from the stand-in seed. */
test.beforeEach(() => reseed())

type Entry = { kind: string; channel: string; entered_by: string; language: string; ticked?: boolean; value_text?: string; context?: string; answer_text?: string; set?: string }

/* What the clinician sees for today, read from the clinician's own endpoint. */
async function clinicToday(request: APIRequestContext, registrationNo: string): Promise<Entry[]> {
  const patients = (await (await request.get(`${API_URL}/api/patients`)).json()) as { id: string; registration_no: string }[]
  const id = patients.find((p) => p.registration_no === registrationNo)!.id
  const today = ((await (await request.get(`${API_URL}/api/app/patients/${id}/today`)).json()) as { date: string }).date
  const page = (await (await request.get(`${API_URL}/api/patients/${id}/entries?from=${today}&to=${today}`)).json()) as { entries: Entry[] }
  return page.entries
}

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
  // Start is within reach without scrolling, on a phone-sized screen.
  await expect(page.getByRole('button', { name: 'Start' })).toBeInViewport()
  await expectNoViolations(page)
  await start(page, 'English', 'Asha Verma')
  await expect(page.getByText('Hello, Asha')).toBeVisible()
  await page.reload()
  await expect(page.getByText('Hello, Asha')).toBeVisible()
})

test('a medicine is marked taken or not taken, and a second tap clears it', async ({ page, request }) => {
  await start(page, 'English', 'Asha Verma')
  const taken = page.getByRole('button', { name: 'Taken, Tab. Metformin 500 mg 1-0-1', exact: true })
  const notTaken = page.getByRole('button', { name: 'Not taken, Tab. Metformin 500 mg 1-0-1', exact: true })
  await expect(taken).toHaveAttribute('aria-pressed', 'false')
  await taken.click()
  await expect(taken).toHaveAttribute('aria-pressed', 'true')
  await expectNoViolations(page)
  await notTaken.click()
  await expect(notTaken).toHaveAttribute('aria-pressed', 'true')
  await expect(taken).toHaveAttribute('aria-pressed', 'false')
  let ticks = (await clinicToday(request, 'DEV-0001')).filter((e) => e.kind === 'medication_tick')
  expect(ticks.map((t) => t.ticked)).toEqual([false])
  await notTaken.click()
  await expect(notTaken).toHaveAttribute('aria-pressed', 'false')
  ticks = (await clinicToday(request, 'DEV-0001')).filter((e) => e.kind === 'medication_tick')
  expect(ticks).toEqual([])
})

test('what the patient records reaches the clinician, marked as from the app', async ({ page, request }) => {
  await start(page, 'हिन्दी', 'Asha Verma')
  await page.getByRole('button', { name: /^ले ली, Tab\. Glimepiride/ }).click()
  await expect(page.getByRole('button', { name: /^ले ली, Tab\. Glimepiride/ })).toHaveAttribute('aria-pressed', 'true')
  await page.getByTestId('add-reading').click()
  await page.getByTestId('glucose-value').fill('156')
  await page.getByTestId('context-after_meal').click()
  await page.getByTestId('save-reading').click()
  await expect(page.getByTestId('reading')).toContainText('156')
  await page.getByTestId('answer-no').click()
  await expect(page.getByTestId('answer-given')).toBeVisible()

  const entries = await clinicToday(request, 'DEV-0001')
  expect(entries.map((e) => e.kind).sort()).toEqual(['glucose_reading', 'medication_tick', 'survey_answer'])
  for (const e of entries) {
    expect([e.channel, e.entered_by]).toEqual(['patient_app', 'patient'])
  }
  expect(entries.find((e) => e.kind === 'glucose_reading')).toMatchObject({ value_text: '156', context: 'after_meal' })
  expect(entries.find((e) => e.kind === 'survey_answer')).toMatchObject({ set: 'daily', language: 'hi' })
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

test('in Urdu, a medicine still reads as printed: dose, then schedule', async ({ page }) => {
  await start(page, 'اردو', 'Asha Verma')
  const card = page.getByRole('group', { name: 'Tab. Metformin 500 mg 1-0-1' })
  const dose = await card.getByText('500 mg', { exact: true }).boundingBox()
  const schedule = await card.getByText('1-0-1', { exact: true }).boundingBox()
  expect(dose!.x).toBeLessThan(schedule!.x)
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

test('a meal photo is sent as it is and shown back, with nothing estimated', async ({ page, request }) => {
  await start(page, 'English', 'Meera Pillai')
  // A tiny PNG made here: no real photograph is ever committed.
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
  const chooser = page.waitForEvent('filechooser')
  await page.getByTestId('add-meal').click()
  await (await chooser).setFiles({ name: 'plate.png', mimeType: 'image/png', buffer: png })
  await expect(page.getByText('1 photo today')).toBeVisible()
  const meals = (await clinicToday(request, 'DEV-0003')).filter((e) => e.kind === 'meal_photo')
  expect(meals).toHaveLength(1)
  expect(Object.keys(meals[0]).filter((k) => /calor|portion|carb|protein|estimate/i.test(k))).toEqual([])
})
