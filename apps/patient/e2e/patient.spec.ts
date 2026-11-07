import AxeBuilder from '@axe-core/playwright'
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

import { query, reseed } from './db'
import { API_URL } from './env'

/* The real API and a real database: every test starts from the stand-in seed. */
test.beforeEach(() => reseed())

type Entry = { kind: string; channel: string; entered_by: string; language: string; ticked?: boolean; value_text?: string; context?: string; answer_text?: string; set?: string; meal?: string | null; calories_text?: string | null }

/* Today's date at the clinic, which keeps India time whatever the test machine's clock says. */
const clinicDate = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date())

/* What the clinician sees for today, read from the clinician's own endpoint. */
async function clinicToday(request: APIRequestContext, registrationNo: string): Promise<Entry[]> {
  const patients = (await (await request.get(`${API_URL}/api/patients`)).json()) as { id: string; registration_no: string }[]
  const id = patients.find((p) => p.registration_no === registrationNo)!.id
  const today = clinicDate()
  const page = (await (await request.get(`${API_URL}/api/patients/${id}/entries?from=${today}&to=${today}`)).json()) as { entries: Entry[] }
  return page.entries
}

/* The seed's fictional numbers. */
const PHONES: Record<string, string> = {
  'Asha Verma': '55500 00001', 'Imran Qureshi': '55500 00002', 'Meera Pillai': '55500 00003', 'Rakesh Yadav': '55500 00004',
}

/* Signs in as the patient: their number, then the code. The API is in test mode, so the screen shows the code. */
async function start(page: Page, lang: 'English' | 'हिन्दी' | 'اردو', patient: string) {
  await page.goto('/')
  await page.getByRole('radio', { name: lang }).click()
  await page.getByTestId('phone').fill(PHONES[patient])
  await page.getByTestId('send-code').click()
  const code = (await page.getByTestId('demo-code').innerText()).match(/\d{6}/)![0]
  await page.getByTestId('code').fill(code)
  await page.getByTestId('sign-in').click()
}

async function expectNoViolations(page: Page) {
  // A sheet slides in, and React Native Web gives it the dialog role only
  // once the slide has finished. Check the page as it settles, as the
  // clinic suite does, not halfway through an animation.
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'))
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze()
  expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(', ')}`)).toEqual([])
}

test('first launch signs in with the number on record and a code, and stays signed in', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('Your mobile number')).toBeVisible()
  await expect(page.getByText('Asha Verma')).toHaveCount(0) // no list of patients on a phone
  // The next step is within reach without scrolling, on a phone-sized screen.
  await expect(page.getByRole('button', { name: 'Send the code' })).toBeInViewport()
  await expectNoViolations(page)
  await page.getByTestId('phone').fill('55500 00001')
  await page.getByRole('button', { name: 'Send the code' }).click()
  await expect(page.getByTestId('demo-code')).toHaveText(/^Demo, no SMS is sent: the code is \d{6}\.$/)
  await expectNoViolations(page)
  await page.getByTestId('code').fill('000000')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('alert')).toContainText('That code is not right')
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

test('a meal photo goes as it is, with its meal and any calories typed, and nothing estimated', async ({ page, request }) => {
  await start(page, 'English', 'Meera Pillai')
  // A tiny PNG made here: no real photograph is ever committed.
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
  const chooser = page.waitForEvent('filechooser')
  await page.getByTestId('add-meal').click()
  await (await chooser).setFiles({ name: 'plate.png', mimeType: 'image/png', buffer: png })
  await expect(page.getByText('Which meal is it?')).toBeVisible()
  await expect(page.getByTestId('meal-taken')).toHaveText(/^Taken today at \d\d:\d\d$/)
  await expectNoViolations(page)
  await page.getByRole('radio', { name: 'Dinner' }).click()
  await page.getByLabel('Calories, if you know them').fill('520')
  await page.getByRole('button', { name: 'Send photo' }).click()
  await expect(page.getByText('1 photo today')).toBeVisible()
  await expect(page.getByText('520 kcal')).toBeVisible()
  const meals = (await clinicToday(request, 'DEV-0003')).filter((e) => e.kind === 'meal_photo')
  expect(meals).toHaveLength(1)
  expect(meals[0]).toMatchObject({ meal: 'dinner', calories_text: '520' })
  // Calories only as typed: nothing about the photo is estimated.
  expect(Object.keys(meals[0]).filter((k) => /portion|carb|protein|estimate|nutri/i.test(k))).toEqual([])
})

/*
 * A page the patient photographs goes through the clinic's reading
 * pipeline and lands on the clinician's record for that patient. The
 * stand-in reader runs here, so the medicines are the same every run.
 */
test('a prescription photographed on the phone is read and reaches the clinician', async ({ page, request }) => {
  await start(page, 'English', 'Meera Pillai')
  // Two bands of ink, made here: no real page is ever committed.
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAPAAAACMCAIAAADN17N/AAABrklEQVR4nO3dMQrDMBAAwVzw/7+stK5lgcMy0wuuWK4S0qy1PlDxfXsAOEnQpAiaFEGTImhSBE2KoEkRNCmCJkXQpAiaFEGTImhSBE2KoEkRNCmCJkXQpAiaFEGTImhSBE2KoEm5nhyemVNzwN32czE2NCmCJkXQpAiaFEGTImhSBE2KoEkRNCmCJkXQpAiaFEGTImhSBE2KoEkZH29SYkOTImhSBE2KoEkRNCmCJkXQpAiaFEGTImhSBE2KoEkRNCmCJkXQpAiaFEGTImhSBE2KoEkRNCmCJkXQpAiaFEGTImhSBE2KoEkRNCmCJkXQpAiaFEGTImhSBE2KoEkRNCmCJkXQpAiaFEGTImhSrieHZ+bUHHC3/WO3DU2KoEkRNCmCJkXQpAiaFEGTImhSBE2KoEkRNCmCJkXQpAiaFEGTImhSZvsmNfwhG5oUQZMiaFIETYqgSRE0KYImRdCkCJoUQZMiaFIETYqgSRE0KYImRdCkCJoUQZMiaFIETYqgSRE0KYImRdCkCJoUQZMiaFIETYqgSRE0KYImRdCkCJoUQZMiaFIETYqgSRE0KT+5jxARR1RPbgAAAABJRU5ErkJggg==', 'base64')
  await page.getByTestId('open-docs').click()
  // The seed already gives her pages the clinic scanned, and the screen
  // says so: both halves of the record are in one list.
  await expect(page.getByText('Your clinic added this').first()).toBeVisible()
  await expectNoViolations(page)

  const chooser = page.waitForEvent('filechooser')
  await page.getByTestId('docs-add').click()
  await (await chooser).setFiles({ name: 'rx.png', mimeType: 'image/png', buffer: png })
  await expect(page.getByText('What is this page?')).toBeVisible()
  await page.getByTestId('doc-kind-prescription').click()
  await page.getByTestId('doc-send').click()

  // The medicines the stand-in reader finds, shown as written.
  await expect(page.getByText('Tab. Metformin')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('Tab. Vildagliptin')).toBeVisible()
  // Nobody has checked them, and the app says so rather than presenting
  // a machine reading as the patient's prescription.
  await expect(page.getByText('Your doctor has not checked this yet').first()).toBeVisible()
  await expect(page.getByText('You sent this')).toBeVisible()
  await expectNoViolations(page)

  // The other half of the point: it is on the clinician's record.
  const patients = (await (await request.get(`${API_URL}/api/patients`)).json()) as { id: string; registration_no: string; documents: number }[]
  const her = patients.find((p) => p.registration_no === 'DEV-0003')!
  expect(her.documents).toBeGreaterThan(0)
  expect(await page.getByText('You sent this').count()).toBe(1)
  // A prescription reaches the clinician through the checklist, where it
  // waits for review, carrying which door it came in by.
  const checklist = (await (await request.get(`${API_URL}/api/patients/${her.id}/checklist`)).json()) as {
    awaiting_review: { document: { sent_from: string }; item_count: number }[]
  }
  const fromPhone = checklist.awaiting_review.filter((r) => r.document.sent_from === 'patient_app')
  expect(fromPhone).toHaveLength(1)
  expect(fromPhone[0].item_count).toBe(2)
})

test('a spoken answer reaches the clinic as recorded, and is not transcribed by default', async ({ page, request }) => {
  await start(page, 'English', 'Asha Verma')
  await page.getByRole('button', { name: 'Speak your answer' }).click()
  await page.getByRole('button', { name: 'Start recording' }).click()
  await expect(page.getByTestId('recording-time')).toBeVisible()
  await page.waitForTimeout(1500)
  await page.getByRole('button', { name: 'Stop recording' }).click()
  await expect(page.getByText('Your doctor listens to it as you recorded it.')).toBeVisible()
  await expectNoViolations(page)
  await page.getByRole('button', { name: 'Send this recording' }).click()
  await expect(page.getByTestId('playback')).toBeVisible()
  const answers = (await clinicToday(request, 'DEV-0001')).filter((e) => e.kind === 'survey_answer') as (Entry & { audio_url: string | null })[]
  expect(answers).toHaveLength(1)
  expect(answers[0].answer_text).toBeNull()
  const audio = await request.get(`${API_URL}${answers[0].audio_url}`)
  expect(audio.ok()).toBe(true)
  // WebM, as the browser recorded it: the file begins with its own signature.
  expect([...(await audio.body()).subarray(0, 4)]).toEqual([0x1a, 0x45, 0xdf, 0xa3])
  // Transcription is off unless the clinic switches it on: the voice stays at the clinic.
  expect((answers[0] as { audio_transcript?: string | null }).audio_transcript).toBeNull()
})

/* Yesterday as the clinician sees it, read from the clinician's own endpoint. */
async function clinicYesterday(request: APIRequestContext, registrationNo: string) {
  const patients = (await (await request.get(`${API_URL}/api/patients`)).json()) as { id: string; registration_no: string }[]
  const id = patients.find((p) => p.registration_no === registrationNo)!.id
  const today = clinicDate()
  const d = new Date(`${today}T12:00:00`)
  d.setDate(d.getDate() - 1)
  const yesterday = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const page = (await (await request.get(`${API_URL}/api/patients/${id}/entries?from=${yesterday}&to=${yesterday}`)).json()) as {
    entries: (Entry & { regimen_item?: { id: string } })[]
  }
  return { yesterday, entries: page.entries }
}

test('earlier days show what was recorded, as the clinic has it, and go back further', async ({ page, request }) => {
  const { yesterday, entries } = await clinicYesterday(request, 'DEV-0001')
  await start(page, 'English', 'Asha Verma')
  await page.getByRole('button', { name: 'Earlier days' }).click()
  await expect(page.getByRole('heading', { name: 'Earlier days' })).toBeVisible()

  const day = page.getByTestId(`day-${yesterday}`)
  await expect(day).toBeVisible()
  const ticks = entries.filter((e) => e.kind === 'medication_tick')
  for (const tick of ticks) {
    await expect(day.getByTestId(`past-tick-${tick.regimen_item!.id}`)).toContainText(tick.ticked ? 'Taken' : 'Not taken')
  }
  const readings = entries.filter((e) => e.kind === 'glucose_reading').map((e) => e.value_text)
  await expect(day.getByTestId('past-reading')).toHaveCount(readings.length)
  for (const value of readings) await expect(day.getByText(value!, { exact: true }).first()).toBeVisible()
  await expectNoViolations(page)

  const shown = await page.locator('[data-testid^="day-"]').count()
  await page.getByRole('button', { name: 'Show earlier days' }).click()
  await expect(page.locator('[data-testid^="day-"]')).toHaveCount(shown + 7)
  // The list ends with the same way back as it starts with.
  await page.getByRole('button', { name: 'Back to today' }).last().click()
  await expect(page.getByText('Hello, Asha')).toBeVisible()
})

test('earlier days read right to left in Urdu, with medicines as printed', async ({ page }) => {
  await start(page, 'اردو', 'Asha Verma')
  await page.getByRole('button', { name: 'پچھلے دن' }).click()
  await expect(page.getByRole('heading', { name: 'پچھلے دن' })).toBeVisible()
  const dir = await page.locator('[data-testid^="day-"]').first().evaluate((el) => getComputedStyle(el).direction)
  expect(dir).toBe('rtl')
  await expect(page.getByText('Tab. Metformin').first()).toBeVisible()
})

test('settings change the language at once, keep the patient, and say what the app is', async ({ page }) => {
  await start(page, 'English', 'Asha Verma')
  await page.getByRole('button', { name: 'Settings' }).click()
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
  await expect(page.getByText('Set up for Asha Verma, DEV-0001')).toBeVisible()
  await expect(page.getByText('This app does not give medical advice.', { exact: false })).toBeVisible()
  await expectNoViolations(page)
  await page.getByRole('radio', { name: 'हिन्दी' }).click()
  await expect(page.getByRole('heading', { name: 'सेटिंग्स' })).toBeVisible()
  await page.getByRole('button', { name: 'आज पर वापस जाएँ' }).click()
  await expect(page.getByText('दवाइयाँ')).toBeVisible()
  await page.reload()
  await expect(page.getByText('दवाइयाँ')).toBeVisible()
})

test('signing out from settings asks first, then goes back to sign-in', async ({ page }) => {
  await start(page, 'English', 'Asha Verma')
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page.getByText('The app will go back to its first screen')).toBeVisible()
  await page.getByRole('button', { name: 'Yes, sign out' }).click()
  await expect(page.getByText('Your mobile number')).toBeVisible()
})

test('an earlier day lists a medicine nothing was marked for as not marked', async ({ page }) => {
  query(`DELETE FROM pat.entry e USING pat.medication_tick t, core.patient p
         WHERE t.entry_id = e.id AND p.id = e.patient_id AND p.registration_no = 'DEV-0001'
           AND t.tick_date = (now() AT TIME ZONE 'Asia/Kolkata')::date - 1`)
  await start(page, 'English', 'Asha Verma')
  await page.getByRole('button', { name: 'Earlier days' }).click()
  const yesterday = page.locator('[data-testid^="day-"]').first()
  await expect(yesterday.getByText('Not marked')).toHaveCount(3)
  await expect(yesterday.getByText('Taken', { exact: true })).toHaveCount(0)
  await expectNoViolations(page)
})
