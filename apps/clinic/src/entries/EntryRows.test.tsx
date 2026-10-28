import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { MealPhotoEntry } from '../api/client'
import { MealRow } from './EntryRows'

const base = {
  id: 'e-1', channel: 'patient_app' as const, entered_by: 'patient' as const, caregiver_name: null,
  language: 'hi', occurred_at: '2026-10-27T20:05:00+05:30', recorded_at: '2026-10-27T20:06:00+05:30',
}
const meal = (over: Partial<MealPhotoEntry>): MealPhotoEntry => ({
  ...base, kind: 'meal_photo', photo_url: '/api/storage/meals/p/m.jpg', meal: null, calories_text: null, ...over,
})

describe('MealRow', () => {
  it('names the meal and gives calories only as the patient typed them', () => {
    render(<MealRow e={meal({ meal: 'dinner', calories_text: '520' })} />)
    expect(screen.getByText('Dinner')).toBeInTheDocument()
    expect(screen.getByText('520 kcal, as the patient typed it')).toBeInTheDocument()
  })

  it('says only "Meal photograph" when no meal was chosen, and no calories when none were typed', () => {
    render(<MealRow e={meal({})} />)
    expect(screen.getByText('Meal photograph')).toBeInTheDocument()
    expect(screen.queryByText(/kcal/)).not.toBeInTheDocument()
  })
})
