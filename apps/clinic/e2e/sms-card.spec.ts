import { expect, test, type APIRequestContext } from '@playwright/test'

import { expectNoViolations } from './axe'
import { query, reseed } from './db'
import { API_PORT } from './env'
import { withoutMocks } from './mocks'

test.beforeEach(async ({ page }) => {
  reseed()
  await withoutMocks(page)
})

const idOf = (reg: string) => query<{ id: string }>(`SELECT id FROM core.patient WHERE registration_no = '${reg}'`)[0].id

/* What a phone would send, through the SMS gateway endpoint the card stands for. */
function sms(request: APIRequestContext, body: string, id: string) {
  return request.post(`http://127.0.0.1:${API_PORT}/api/sms/inbound`, {
    headers: { 'X-Gateway-Key': 'dev-only-gateway-key' },
    data: { message_id: id, from: '+91 55500 00001', body },
  })
}

test("the checklist opens the patient's SMS card, in the language they read", async ({ page }) => {
  await page.goto(`/patients/${idOf('DEV-0001')}/checklist`)
  await page.getByRole('region', { name: 'Diary by SMS' }).getByRole('link', { name: 'SMS card' }).click()
  await expect(page).toHaveTitle('SMS card · Asha Verma · Consultation Readiness')
  const card = page.getByTestId('sms-card')
  await expect(card).toHaveAttribute('lang', 'hi')
  await expect(page.getByRole('note')).toContainText('This Hindi card is a draft')
  await expectNoViolations(page)
})

test('what the card tells a patient to send is what the SMS reader stores, medicine by number', async ({ page, request }) => {
  const asha = idOf('DEV-0001')
  await page.goto(`/patients/${asha}/checklist`)
  const checklist = await page.getByRole('region', { name: 'Active checklist' }).locator('li p > span:first-child').allTextContents()

  await page.goto(`/patients/${asha}/sms-card`)
  await page.getByRole('radio', { name: 'English' }).check({ force: true })
  const card = page.getByTestId('sms-card')
  const numbered = await card.getByRole('list', { name: 'A medicine' }).getByRole('listitem').locator('span[dir] > span:first-child').allTextContents()
  expect(numbered).toEqual(checklist)

  const example = (await card.getByTestId('sms-example').innerText()).trim()
  const sent = await (await sms(request, example, 'card-example')).json()
  expect(sent.problems).toEqual([])
  expect(sent.stored.map((s: { kind: string }) => s.kind)).toEqual(['glucose_reading', 'medication_tick', 'medication_tick', 'survey_answer'])
  const ticked = query<{ drug_text: string }>(
    `SELECT ri.drug_text FROM pat.medication_tick t JOIN core.regimen_item ri ON ri.id = t.regimen_item_id
     JOIN pat.entry e ON e.id = t.entry_id WHERE e.channel = 'sms' ORDER BY e.occurred_at, ri.drug_text`,
  ).map((r) => r.drug_text).sort()
  expect(ticked).toEqual(numbered.slice(0, 2).sort())

  const letters = await card.locator('dt').allTextContents()
  const readings = await (await sms(request, letters.map((l) => `G 142 ${l}`).join('\n'), 'card-letters')).json()
  expect(readings.problems).toEqual([])
  expect(readings.stored).toHaveLength(6)
})

test('printed, the card is all there is on the page', async ({ page }) => {
  await page.goto(`/patients/${idOf('DEV-0001')}/sms-card`)
  await expect(page.getByTestId('sms-card')).toBeVisible()
  await page.emulateMedia({ media: 'print' })
  await expect(page.getByTestId('sms-card')).toBeVisible()
  await expect(page.getByRole('banner')).toBeHidden()
  await expect(page.getByRole('contentinfo')).toBeHidden()
  await expect(page.getByRole('button', { name: 'Print' })).toBeHidden()
  await expect(page.getByRole('heading', { name: 'SMS card', level: 1 })).toBeHidden()
})

test('a patient who has not agreed to SMS gets no card, and the page says why', async ({ page }) => {
  await page.goto(`/patients/${idOf('DEV-0004')}/sms-card`)
  await expect(page.getByRole('status')).toContainText('Rakesh Yadav has not agreed to SMS')
  await expect(page.getByTestId('sms-card')).toHaveCount(0)
  await expectNoViolations(page)
})
