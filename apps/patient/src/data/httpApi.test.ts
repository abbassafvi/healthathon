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

const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 1])

function api(...answers: (Response | Error)[]) {
  const { f, calls } = fakeFetch(...answers)
  const photos: string[] = []
  const readPhoto = async (uri: string) => {
    photos.push(uri)
    if (uri.includes('missing')) throw new Error('The photo could not be read')
    return { body: jpeg, type: 'image/jpeg' }
  }
  const client = createHttpApi({ baseUrl: 'http://clinic.test:8000/', language: () => 'hi', fetch: f, readPhoto })
  return { calls, photos, client }
}

describe('the HTTP patient API', () => {
  it('fetches a document page with the token, so the page route lets it through', async () => {
    const { f, calls } = fakeFetch(new Response(new Blob([jpeg], { type: 'image/jpeg' }), { status: 200 }))
    const client = createHttpApi({ baseUrl: 'http://clinic.test:8000/', language: () => 'en', token: () => 'tok-1', fetch: f })
    const uri = await client.pageImage('http://clinic.test:8000/api/app/patients/p1/documents/d1/page')
    expect(new Headers(calls[0]!.init?.headers).get('Authorization')).toBe('Bearer tok-1')
    expect(uri.startsWith('data:image/jpeg;base64,')).toBe(true)
  })

  it('never sends the token for a page on another host', async () => {
    const { f, calls } = fakeFetch(new Response(new Blob([jpeg], { type: 'image/jpeg' }), { status: 200 }))
    const client = createHttpApi({ baseUrl: 'http://clinic.test:8000/', language: () => 'en', token: () => 'tok-1', fetch: f })
    await client.pageImage('http://elsewhere.test/api/app/patients/p1/documents/d1/page')
    expect(calls[0]!.init?.headers).toBeUndefined()
  })

  it('reports a page the server refuses', async () => {
    const { f } = fakeFetch(new Response(null, { status: 401, statusText: 'Unauthorized' }))
    const client = createHttpApi({ baseUrl: 'http://clinic.test:8000/', language: () => 'en', token: () => null, fetch: f })
    await expect(client.pageImage('http://clinic.test:8000/api/app/patients/p1/documents/d1/page')).rejects.toMatchObject({ status: 401 })
  })

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
    expect(body(calls[2])).toEqual({ answers: { walk_days_week: '3' }, recordings: {}, capture_id: 'cap-s', language: 'hi' })
  })

  it('uploads a meal photo as it is, with its meal, when it was taken, and its capture id', async () => {
    const { client, calls, photos } = api(json({ id: 'm1', uri: '/api/storage/meals/p1/m1.jpg', occurred_at: 'x', meal: 'lunch', calories_text: null }))
    const takenAt = new Date('2026-10-28T07:40:00Z')
    const meal = await client.addMeal('p1', { uri: 'file:///photo.jpg', meal: 'lunch', takenAt, calories: null }, 'cap-m')
    expect(photos).toEqual(['file:///photo.jpg'])
    expect(calls[0].url).toBe('http://clinic.test:8000/api/app/patients/p1/meals?capture_id=cap-m&meal=lunch&taken_at=2026-10-28T07%3A40%3A00.000Z')
    expect(calls[0].init?.method).toBe('POST')
    expect(calls[0].init?.headers).toEqual({ 'Content-Type': 'image/jpeg' })
    expect(calls[0].init?.body).toBe(jpeg)
    expect(meal.uri).toBe('http://clinic.test:8000/api/storage/meals/p1/m1.jpg')
  })

  it('sends a recording as recorded, then the answer that carries its key', async () => {
    const { client, calls, photos } = api(json({ key: 'voice/p1/cap-v.m4a', uri: '/api/storage/voice/p1/cap-v.m4a' }), empty())
    const rec = await client.uploadRecording('p1', 'file:///answer.m4a', 'cap-v')
    await client.answer('p1', 'felt_unwell_today', 'No', 'cap-a', rec.key)
    expect(photos).toEqual(['file:///answer.m4a'])
    expect(calls[0].url).toBe('http://clinic.test:8000/api/app/patients/p1/recordings?capture_id=cap-v')
    expect(calls[0].init?.body).toBe(jpeg)
    expect(rec.uri).toBe('http://clinic.test:8000/api/storage/voice/p1/cap-v.m4a')
    expect(body(calls[1])).toEqual({ question_key: 'felt_unwell_today', answer_text: 'No', audio_key: 'voice/p1/cap-v.m4a', capture_id: 'cap-a', language: 'hi' })
  })

  it('sends survey recordings by question, beside the written answers', async () => {
    const { client, calls } = api(empty())
    await client.submitSurvey('p1', { walk_days_week: '3' }, 'cap-s', { skipped_meal_week: 'voice/p1/cap-s-1.m4a' })
    expect(body(calls[0])).toEqual({ answers: { walk_days_week: '3' }, recordings: { skipped_meal_week: 'voice/p1/cap-s-1.m4a' }, capture_id: 'cap-s', language: 'hi' })
  })

  it('sends calories only when the patient typed them', async () => {
    const { client, calls } = api(json({ id: 'm1', uri: '/m.jpg', occurred_at: 'x', meal: 'snack', calories_text: '350' }))
    await client.addMeal('p1', { uri: 'file:///photo.jpg', meal: 'snack', takenAt: new Date('2026-10-28T10:00:00Z'), calories: '350' }, 'cap-m')
    expect(new URL(calls[0].url).searchParams.get('calories')).toBe('350')
  })

  it('sends nothing when the photo cannot be read', async () => {
    const { client, calls } = api()
    const err = await client.addMeal('p1', { uri: 'file:///missing.jpg', meal: 'dinner', takenAt: new Date(), calories: null }, 'cap-m').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).status).toBe(0)
    expect(calls).toEqual([])
  })

  it('reads earlier days, asking for those before a date, with photo links made absolute', async () => {
    const page = {
      days: [{ date: '2026-10-25', ticks: [], readings: [], answers: [], meals: [{ id: 'm1', uri: '/api/storage/meals/p1/m1.jpg', occurred_at: 'x' }] }],
      next_before: '2026-10-19',
    }
    const { client, calls } = api(json(page), json({ days: [], next_before: null }))
    const first = await client.pastDays('p1')
    await client.pastDays('p1', '2026-10-19')
    expect(calls.map((c) => c.url)).toEqual([
      'http://clinic.test:8000/api/app/patients/p1/days',
      'http://clinic.test:8000/api/app/patients/p1/days?before=2026-10-19',
    ])
    expect(first.days[0].meals[0].uri).toBe('http://clinic.test:8000/api/storage/meals/p1/m1.jpg')
    expect(first.next_before).toBe('2026-10-19')
  })

  it('turns a refusal into an ApiError with the server’s reason', async () => {
    const { client } = api(json({ detail: 'A reading must be a number' }, 422))
    const err = await client.addReading('p1', { value_text: 'high', context: 'fasting' }, 'cap').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).status).toBe(422)
    expect((err as ApiError).message).toBe('A reading must be a number')
  })

  it('signs in with the code, and then sends the token on patient routes only', async () => {
    let token: string | null = null
    const calls: { url: string; init?: RequestInit }[] = []
    const replies = [json({ demo_code: null }), json({ token: 'tok-1', patient: { id: 'p1' } }), json({})]
    const client = createHttpApi({
      baseUrl: 'http://clinic.test:8000',
      language: () => 'en',
      token: () => token,
      fetch: (async (url: string, init?: RequestInit) => {
        calls.push({ url, init })
        return replies.shift()!
      }) as typeof fetch,
    })
    await client.startSignIn('55500 00001')
    const signed = await client.checkSignIn('55500 00001', '123456')
    token = signed.token
    await client.today('p1').catch(() => {})
    expect(body(calls[0])).toEqual({ phone: '55500 00001' })
    expect(calls[0].url).toBe('http://clinic.test:8000/api/app/sign-in/start')
    expect(body(calls[1])).toEqual({ phone: '55500 00001', code: '123456' })
    expect((calls[0].init?.headers as Record<string, string>).Authorization).toBeUndefined()
    expect(calls[2].init?.headers).toEqual({ Authorization: 'Bearer tok-1' })
  })

  it('reports a network failure as status 0', async () => {
    const { client } = api(new TypeError('Network request failed'))
    const err = await client.startSignIn('55500 00001').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).status).toBe(0)
  })
})
