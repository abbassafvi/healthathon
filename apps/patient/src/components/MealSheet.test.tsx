import { fireEvent, screen } from '@testing-library/react-native'
import { useEffect } from 'react'

import { useApp } from '../AppState'
import { en } from '../i18n/en'
import { hi } from '../i18n/hi'
import { renderApp } from '../test/render'
import { photoTime } from './MealCard'
import { MealSheet, takenLine } from './MealSheet'

const NOW = new Date(2026, 9, 28, 13, 30)

function Sheet({ takenAt, onSend = () => {} }: { takenAt: Date; onSend?: (m: unknown) => void }) {
  const { choose, ready, patientId } = useApp()
  useEffect(() => {
    if (ready) choose({ lang: 'en', patientId: 'DEV-0001' })
    // Once, when storage is ready.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready])
  return patientId ? <MealSheet photo={{ uri: 'file:///meal.jpg', takenAt }} onSend={onSend} onClose={() => {}} now={() => NOW} /> : null
}

describe('MealSheet', () => {
  it('sends the chosen meal with the time the photo was taken', async () => {
    const onSend = jest.fn()
    const takenAt = new Date(2026, 9, 28, 8, 10)
    renderApp(<Sheet takenAt={takenAt} onSend={onSend} />)
    expect(await screen.findByText('Taken today at 08:10')).toBeTruthy()
    fireEvent.press(screen.getByTestId('meal-breakfast'))
    fireEvent.press(screen.getByTestId('send-meal'))
    expect(onSend).toHaveBeenCalledWith({ meal: 'breakfast', takenAt, calories: null })
  })

  it('will not send a photo taken more than three days ago, and says why', async () => {
    const onSend = jest.fn()
    renderApp(<Sheet takenAt={new Date(2026, 9, 24, 20, 0)} onSend={onSend} />)
    expect(await screen.findByText(en.mealSheet.tooOld)).toBeTruthy()
    fireEvent.press(screen.getByTestId('meal-dinner'))
    fireEvent.press(screen.getByTestId('send-meal'))
    expect(onSend).not.toHaveBeenCalled()
  })

  it('shows nothing about the photo it could estimate: no portion, no nutrients', async () => {
    renderApp(<Sheet takenAt={NOW} />)
    await screen.findByText(en.mealSheet.which)
    expect(screen.queryByText(/portion|carb|protein|fat|sugar|healthy/i)).toBeNull()
  })
})

describe('takenLine', () => {
  it('says today, yesterday, or the date, in the language in use', () => {
    expect(takenLine(new Date(2026, 9, 28, 8, 5), NOW, en)).toBe('Taken today at 08:05')
    expect(takenLine(new Date(2026, 9, 27, 21, 40), NOW, en)).toBe('Taken yesterday at 21:40')
    expect(takenLine(new Date(2026, 9, 26, 13, 0), NOW, en)).toBe('Taken on 26 October at 13:00')
    expect(takenLine(new Date(2026, 9, 27, 21, 40), NOW, hi)).toBe('कल 21:40 बजे ली गई')
  })
})

describe('photoTime', () => {
  it("reads the camera's own record of when the photo was taken", () => {
    expect(photoTime({ DateTimeOriginal: '2026:10:28 08:10:33' }, NOW)).toEqual(new Date(2026, 9, 28, 8, 10, 33))
    expect(photoTime({ DateTime: '2026:10:27 21:00:00' }, NOW)).toEqual(new Date(2026, 9, 27, 21, 0, 0))
  })

  it('uses now when there is no record, or it is ahead of now', () => {
    expect(photoTime(undefined, NOW)).toBe(NOW)
    expect(photoTime({ DateTimeOriginal: 'yesterday' }, NOW)).toBe(NOW)
    expect(photoTime({ DateTimeOriginal: '2026:10:29 08:00:00' }, NOW)).toBe(NOW)
  })
})
