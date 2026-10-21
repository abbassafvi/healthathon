import { describe, expect, it } from 'vitest'

import { sha256Hex } from './sha256'

describe('sha256Hex', () => {
  it('matches the known digest of "abc"', async () => {
    expect(await sha256Hex(new Blob(['abc']))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })

  it('gives the same digest for the same bytes under a different name', async () => {
    const a = await sha256Hex(new File(['same'], 'a.jpg'))
    const b = await sha256Hex(new File(['same'], 'b.jpg'))
    expect(a).toBe(b)
  })
})
