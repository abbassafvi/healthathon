import { describe, expect, it } from 'vitest'

import { thumbnail } from './photos'

describe('thumbnail', () => {
  it('asks the API for a smaller copy of a stored photo', () => {
    expect(thumbnail('/api/storage/meals/p/m.jpg')).toBe('/api/storage/meals/p/m.jpg?width=320')
    expect(thumbnail('/api/storage/meals/p/m.jpg', 160)).toBe('/api/storage/meals/p/m.jpg?width=160')
  })

  it('keeps a query the address already has', () => {
    expect(thumbnail('/api/storage/m.jpg?v=2')).toBe('/api/storage/m.jpg?v=2&width=320')
  })
})
