import { renderHook } from '@testing-library/react-native'
import { BackHandler, Platform } from 'react-native'

import { useBackButton } from './useBackButton'

describe('useBackButton', () => {
  afterEach(() => jest.restoreAllMocks())

  it('takes the back button and calls back, so the app stays open', () => {
    const add = jest.spyOn(BackHandler, 'addEventListener')
    const onBack = jest.fn()
    renderHook(() => useBackButton(onBack))
    const handler = add.mock.calls[0][1]
    expect(handler(undefined as never)).toBe(true)
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('leaves the web build alone, where there is no back button', () => {
    jest.replaceProperty(Platform, 'OS', 'web')
    const add = jest.spyOn(BackHandler, 'addEventListener')
    renderHook(() => useBackButton(() => {}))
    expect(add).not.toHaveBeenCalled()
  })
})
