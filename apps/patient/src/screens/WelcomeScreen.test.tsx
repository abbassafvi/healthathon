import { fireEvent, screen, waitFor } from '@testing-library/react-native'
import { Text } from 'react-native'

import { useApp } from '../AppState'
import { en } from '../i18n/en'
import { renderApp } from '../test/render'
import { WelcomeScreen } from './WelcomeScreen'

/* The first screen, until a phone signs in; then who it signed in as. */
function Shown() {
  const { patientId, lang, token, patient } = useApp()
  return patientId ? <Text>{`${patientId}|${lang}|${token}|${patient?.full_name}`}</Text> : <WelcomeScreen />
}

describe('WelcomeScreen', () => {
  it('asks for the mobile number the clinic has, and lists no patients', async () => {
    renderApp(<WelcomeScreen />)
    expect(await screen.findByText(en.welcome.phone)).toBeTruthy()
    expect(screen.getByText(en.welcome.demoNumbers)).toBeTruthy()
    expect(screen.queryByText('Asha Verma')).toBeNull()
    expect(screen.getByTestId('send-code')).toBeDisabled()
  })

  it('signs in with the code sent to the number, and remembers the language', async () => {
    renderApp(<Shown />)
    fireEvent.press(await screen.findByTestId('lang-ur'))
    fireEvent.changeText(screen.getByTestId('phone'), '55500 00002')
    fireEvent.press(screen.getByTestId('send-code'))
    expect(await screen.findByTestId('demo-code')).toHaveTextContent('ڈیمو، کوئی SMS نہیں بھیجا جاتا: کوڈ 123456 ہے۔')
    fireEvent.changeText(screen.getByTestId('code'), '123456')
    fireEvent.press(screen.getByTestId('sign-in'))
    await waitFor(() => expect(screen.getByText('DEV-0002|ur|mock-DEV-0002|Imran Qureshi')).toBeTruthy())
  })

  it('says a wrong code is wrong, and stays on the code', async () => {
    renderApp(<Shown />)
    fireEvent.changeText(await screen.findByTestId('phone'), '55500 00001')
    fireEvent.press(screen.getByTestId('send-code'))
    fireEvent.changeText(await screen.findByTestId('code'), '000000')
    fireEvent.press(screen.getByTestId('sign-in'))
    expect(await screen.findByText(en.welcome.wrongCode)).toBeTruthy()
    expect(screen.getByTestId('code')).toBeTruthy()
  })

  it('asks for a whole number before sending anything', async () => {
    const { api } = renderApp(<WelcomeScreen />)
    const start = jest.spyOn(api, 'startSignIn')
    fireEvent.changeText(await screen.findByTestId('phone'), '5550')
    fireEvent.press(screen.getByTestId('send-code'))
    expect(await screen.findByText(en.welcome.badNumber)).toBeTruthy()
    expect(start).not.toHaveBeenCalled()
  })

  it('goes back to the number to use a different one', async () => {
    renderApp(<WelcomeScreen />)
    fireEvent.changeText(await screen.findByTestId('phone'), '55500 00001')
    fireEvent.press(screen.getByTestId('send-code'))
    fireEvent.press(await screen.findByTestId('other-number'))
    expect(screen.getByTestId('phone')).toBeTruthy()
  })

  it('switches every string when a language is chosen', async () => {
    renderApp(<WelcomeScreen />)
    fireEvent.press(await screen.findByTestId('lang-hi'))
    expect(screen.getByText('नमस्ते')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'कोड भेजें' })).toBeTruthy()
    fireEvent.press(screen.getByTestId('lang-ur'))
    expect(screen.getByText('السلام علیکم')).toBeTruthy()
  })
})
