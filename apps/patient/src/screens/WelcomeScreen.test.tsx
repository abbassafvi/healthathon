import { fireEvent, screen, waitFor } from '@testing-library/react-native'
import { Text } from 'react-native'

import { useApp } from '../AppState'
import { renderApp } from '../test/render'
import { WelcomeScreen } from './WelcomeScreen'


describe('WelcomeScreen', () => {
  it('lists the four fictional patients and says they are fictional', async () => {
    renderApp(<WelcomeScreen />)
    expect(await screen.findByText('Asha Verma')).toBeTruthy()
    expect(screen.getByText('Rakesh Yadav')).toBeTruthy()
    expect(screen.getByText('Demo: these are fictional patients.')).toBeTruthy()
  })

  it('cannot start until a patient is chosen', async () => {
    renderApp(<WelcomeScreen />)
    await screen.findByText('Asha Verma')
    expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled()
    fireEvent.press(screen.getByTestId('patient-DEV-0001'))
    expect(screen.getByRole('button', { name: 'Start' })).toBeEnabled()
  })

  it('switches every string when a language is chosen', async () => {
    renderApp(<WelcomeScreen />)
    await screen.findByText('Asha Verma')
    fireEvent.press(screen.getByTestId('lang-hi'))
    expect(screen.getByText('नमस्ते')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'शुरू करें' })).toBeTruthy()
    fireEvent.press(screen.getByTestId('lang-ur'))
    expect(screen.getByText('السلام علیکم')).toBeTruthy()
  })

  it('remembers the choice', async () => {
    function Shown() {
      const { patientId, lang } = useApp()
      return patientId ? <Text>{`${patientId}|${lang}`}</Text> : <WelcomeScreen />
    }
    renderApp(<Shown />)
    await screen.findByText('Asha Verma')
    fireEvent.press(screen.getByTestId('lang-ur'))
    fireEvent.press(screen.getByTestId('patient-DEV-0002'))
    fireEvent.press(screen.getByRole('button', { name: 'شروع کریں' }))
    await waitFor(() => expect(screen.getByText('DEV-0002|ur')).toBeTruthy())
  })
})

