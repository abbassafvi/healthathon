import { readPhoto } from './readPhoto'
import { readPhoto as readPhotoWeb } from './readPhoto.web'

const files: Record<string, { bytes: number[]; type: string }> = {
  'file:///cache/photo.jpg': { bytes: [0xff, 0xd8, 0xff, 1], type: 'image/jpeg' },
  'file:///cache/empty.jpg': { bytes: [], type: '' },
}

jest.mock('expo-file-system', () => ({
  File: class {
    private readonly f?: { bytes: number[]; type: string }
    constructor(uri: string) {
      this.f = files[uri]
    }
    get exists() {
      return this.f !== undefined
    }
    get size() {
      return this.f?.bytes.length ?? 0
    }
    get type() {
      return this.f?.type ?? ''
    }
    async bytes() {
      return new Uint8Array(this.f?.bytes ?? [])
    }
  },
}))

describe('reading a meal photo on the phone', () => {
  it('reads the bytes and type of the file the camera saved', async () => {
    const photo = await readPhoto('file:///cache/photo.jpg')
    expect(Array.from(photo.body)).toEqual([0xff, 0xd8, 0xff, 1])
    expect(photo.type).toBe('image/jpeg')
  })

  it('refuses a missing or empty file instead of sending it', async () => {
    await expect(readPhoto('file:///cache/gone.jpg')).rejects.toThrow('could not be read')
    await expect(readPhoto('file:///cache/empty.jpg')).rejects.toThrow('could not be read')
  })
})

describe('reading a meal photo in the browser', () => {
  const realFetch = global.fetch
  afterEach(() => {
    global.fetch = realFetch
  })

  it('refuses a failed read, so an error page is never uploaded as the photo', async () => {
    // What Expo's fetch answered on Android for a file:// URI.
    global.fetch = (async () => new Response('File not found', { status: 404 })) as typeof fetch
    await expect(readPhotoWeb('blob:http://localhost/1')).rejects.toThrow('could not be read')
  })

  it('reads the picked photo as a blob', async () => {
    const blob = new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: 'image/jpeg' })
    global.fetch = (async () => new Response(blob)) as typeof fetch
    const photo = await readPhotoWeb('blob:http://localhost/2')
    expect(photo.type).toBe('image/jpeg')
    expect(photo.body.size).toBe(3)
  })
})
