import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { AnswerEntry, MealPhotoEntry } from '../api/client'
import { AnswerRow, MealRow } from './EntryRows'

const base = {
  id: 'e-1', channel: 'patient_app' as const, entered_by: 'patient' as const, caregiver_name: null,
  language: 'hi', occurred_at: '2026-10-27T20:05:00+05:30', recorded_at: '2026-10-27T20:06:00+05:30',
}
const answer = (over: Partial<AnswerEntry>): AnswerEntry => ({
  ...base, kind: 'survey_answer', set: 'daily', question_key: 'felt_unwell_today',
  question_text: 'Did you feel unwell today?', question_text_shown: 'क्या आज आपकी तबीयत ठीक नहीं थी?',
  answer_text: 'नहीं', audio_url: null, ...over,
})
const meal = (over: Partial<MealPhotoEntry>): MealPhotoEntry => ({
  ...base, kind: 'meal_photo', photo_url: '/api/storage/meals/p/m.jpg', meal: null, calories_text: null, ...over,
})

describe('AnswerRow', () => {
  it('plays a spoken answer as recorded, and says it is not transcribed', () => {
    render(<AnswerRow e={answer({ answer_text: null, audio_url: '/api/storage/voice/p/a.m4a' })} />)
    const audio = screen.getByLabelText('The patient’s recording')
    expect(audio.tagName).toBe('AUDIO')
    expect(audio).toHaveAttribute('src', '/api/storage/voice/p/a.m4a')
    expect(audio).toHaveAttribute('preload', 'none')
    expect(screen.getByText('Spoken, kept as recorded, not transcribed')).toBeInTheDocument()
  })

  it('shows a tap and its recording together', () => {
    render(<AnswerRow e={answer({ answer_text: 'नहीं', audio_url: '/api/storage/voice/p/a.m4a' })} />)
    expect(screen.getByText('नहीं')).toBeInTheDocument()
    expect(screen.getByLabelText('The patient’s recording')).toBeInTheDocument()
  })

  it('shows written words with no player', () => {
    render(<AnswerRow e={answer({})} />)
    expect(screen.getByText('नहीं')).toBeInTheDocument()
    expect(screen.queryByLabelText('The patient’s recording')).not.toBeInTheDocument()
  })
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
