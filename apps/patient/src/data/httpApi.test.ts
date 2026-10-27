import { ApiError, createHttpApi } from './httpApi'

type Call = { url: string; init?: RequestInit }

/* A fetch that records each request and answers from a list, in order. */
function fakeFetch(...answers: (Response | Error)[]) {
  const calls: Call[] = []
  const f = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    const next = answers.shift()
    if (!next) throw new Error(`unexpected request to ${url}`)
    if (next instanceof Error) throw next
    return next
  }) as unknown as typeof fetch
  return { f, calls }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const empty = () => new Response(null, { status: 204 })
const body = (c: Call) => JSON.parse(String(c.init?.body)) as Record<string, unknown>

function api(...answers: (Response | Error)[]) {
  const { f, calls } = fakeFetch(...answers)
  return { calls, client: createHttpApi({ baseUrl: 'http://clinic.test:8000/', language: () => 'hi', fetch: f }) }
}

describe('the HTTP patient API', () => {
  it('reads today and makes meal photo links absolute', async () => {
    const { client, calls } = api(
      json({ date: '2026-10-27', meals: [{ id: 'm1', uri: '/api/storage/meals/p/m1.jpg', occurred_at: 'x' }] }),
    )
    const t = await client.today('p 1')
    expect(calls[0].url).toBe('http://clinic.test:8000/api/app/patients/p%201/today')
    expect(t.meals[0].uri).toBe('http://clinic.test:8000/api/storage/meals/p/m1.jpg')
  })

  it('sends a tick, a cleared tick and not taken, each with its capture id', async () => {
    const { client, calls } = api(empty(), empty(), empty())
    await client.setTick('p1', 'i1', true, 'cap-1')
    await client.setTick('p1', 'i1', false, 'cap-2')
    await client.setTick('p1', 'i1', null, 'cap-3')
    expect(calls.map((c) => [c.init?.method, c.url])).toEqual([
      ['PUT', 'http://clinic.test:8000/api/app/patients/p1/ticks/i1'],
      ['PUT', 'http://clinic.test:8000/api/app/patients/p1/ticks/i1'],
      ['PUT', 'http://clinic.test:8000/api/app/patients/p1/ticks/i1'],
    ])
    expect(calls.map(body)).toEqual([
      { ticked: true, capture_id: 'cap-1' },
      { ticked: false, capture_id: 'cap-2' },
      { ticked: null, capture_id: 'cap-3' },
    ])
  })

  it('sends readings and answers with the language in use', async () => {
    const reading = { id: 'r1', value_text: '132', context: 'fasting', occurred_at: 'x' }
    const { client, calls } = api(json(reading), empty(), empty())
    expect(await client.addReading('p1', { value_text: '132', context: 'fasting' }, 'cap-r')).toEqual(reading)
    await client.answer('p1', 'felt_unwell_today', 'नहीं', 'cap-a')
    await client.submitSurvey('p1', { walk_days_week: '3' }, 'cap-s')
    expect(body(calls[0])).toEqual({ value_text: '132', context: 'fasting', capture_id: 'cap-r', language: 'hi' })
    expect(body(calls[1])).toEqual({ question_key: 'felt_unwell_today', answer_text: 'नहीं', capture_id: 'cap-a', language: 'hi' })
    expect(body(calls[2])).toEqual({ answers: { walk_days_week: '3' }, capture_id: 'cap-s', language: 'hi' })
  })

  it('uploads a meal photo as it is, with its capture id', async () => {
    const photo = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 1])], { type: 'image/jpeg' })
    const { client, calls } = api(
      new Response(photo),
      json({ id: 'm1', uri: '/api/storage/meals/p1/m1.jpg', occurred_at: 'x' }),
    )
    const meal = await client.addMeal('p1', 'file:///photo.jpg', 'cap-m')
    expect(calls[0].url).toBe('file:///photo.jpg')
    expect(calls[1].url).toBe('http://clinic.test:8000/api/app/patients/p1/meals?capture_id=cap-m')
    expect(calls[1].init?.method).toBe('POST')
    expect(meal.uri).toBe('http://clinic.test:8000/api/storage/meals/p1/m1.jpg')
  })

  it('turns a refusal into an ApiError with the server’s reason', async () => {
    const { client } = api(json({ detail: 'A reading must be a number' }, 422))
    const err = await client.addReading('p1', { value_text: 'high', context: 'fasting' }, 'cap').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).status).toBe(422)
    expect((err as ApiError).message).toBe('A reading must be a number')
  })

  it('reports a network failure as status 0', async () => {
    const { client } = api(new TypeError('Network request failed'))
    const err = await client.patients().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).status).toBe(0)
  })
})
