import { fireEvent, screen } from '@testing-library/react-native'
import { useEffect } from 'react'
import { BackHandler, StyleSheet, Text } from 'react-native'

import { useApp } from '../AppState'
import { en } from '../i18n/en'
import { renderApp } from '../test/render'
import { font, type Lang } from '../theme'
import { SettingsScreen } from './SettingsScreen'

function As({ lang = 'en', onBack = () => {} }: { lang?: Lang; onBack?: () => void }) {
  const { choose, patientId, ready, lang: now } = useApp()
  useEffect(() => {
    if (ready) choose({ lang, patientId: 'DEV-0001' })
    // Only the first choice; the screen changes the language after that.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready])
  return patientId ? <><SettingsScreen onBack={onBack} /><Text testID="state">{`${patientId}|${now}`}</Text></> : <Text testID="state">signed out</Text>
}

describe('SettingsScreen', () => {
  it('says which patient this phone is set up for', async () => {
    renderApp(<As />)
    expect(await screen.findByText('Set up for Asha Verma, DEV-0001')).toBeTruthy()
  })

  it('changes the language at once, and keeps the patient', async () => {
    renderApp(<As />)
    await screen.findByText(en.settings.title)
    expect(screen.getByTestId('settings-lang-en').props.accessibilityState?.checked ?? screen.getByTestId('settings-lang-en').props['aria-checked']).toBe(true)
    fireEvent.press(screen.getByTestId('settings-lang-hi'))
    expect(await screen.findByText('सेटिंग्स')).toBeTruthy()
    expect(screen.getByTestId('state').props.children).toBe('DEV-0001|hi')
    fireEvent.press(screen.getByTestId('settings-lang-ur'))
    expect(await screen.findByText('سیٹنگز')).toBeTruthy()
  })

  it('changes the patient by going back to the first screen', async () => {
    renderApp(<As />)
    fireEvent.press(await screen.findByTestId('change-patient'))
    expect(screen.getByTestId('state').props.children).toBe('signed out')
  })

  it('says what the app is and that it gives no medical advice, with its version', async () => {
    renderApp(<As />)
    await screen.findByText(en.settings.title)
    expect(screen.getByText(en.settings.aboutBody)).toBeTruthy()
    expect(screen.getByText(en.settings.notAdvice)).toBeTruthy()
    expect(screen.getByTestId('version')).toHaveTextContent(/^cliniConnect, Version \d+\.\d+\.\d+$/)
  })

  it('writes its name in Latin letters, in Urdu as in English', async () => {
    renderApp(<As lang="ur" />)
    const name = await screen.findByText('cliniConnect')
    expect(StyleSheet.flatten(name.props.style).fontFamily).toBe(font.en.regular)
  })

  it("goes back to today with its button and with Android's back", async () => {
    const handlers: ((e: never) => boolean | null | undefined)[] = []
    const spy = jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_e, h) => {
      handlers.push(h)
      return { remove: () => {} }
    })
    const onBack = jest.fn()
    renderApp(<As onBack={onBack} />)
    fireEvent.press(await screen.findByTestId('settings-back'))
    expect(handlers.at(-1)?.(undefined as never)).toBe(true)
    expect(onBack).toHaveBeenCalledTimes(2)
    spy.mockRestore()
  })
})
