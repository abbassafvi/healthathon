import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { appendDictated, type Recogniser } from '../lib/dictation'
import { DictateButton } from './DictateButton'

/* The browser's recogniser, played by the test. */
class FakeRecogniser implements Recogniser {
  static last: FakeRecogniser | null = null
  lang = ''
  continuous = true
  interimResults = true
  onresult: Recogniser['onresult'] = null
  onerror: Recogniser['onerror'] = null
  onend: Recogniser['onend'] = null
  started = false
  constructor() {
    FakeRecogniser.last = this
  }
  start() {
    this.started = true
  }
  stop() {
    this.onend?.()
  }
  abort() {}
  say(transcript: string, isFinal = true) {
    act(() => this.onresult?.({ resultIndex: 0, results: [{ isFinal, 0: { transcript } }] }))
  }
  fail(error: string) {
    act(() => {
      this.onerror?.({ error })
      this.onend?.()
    })
  }
}

function Field({ lang, initial = '' }: { lang?: string; initial?: string }) {
  const [v, setV] = useState(initial)
  return (
    <>
      <input aria-label="Answer" value={v} onChange={(e) => setV(e.target.value)} />
      <DictateButton field="the answer" lang={lang} value={v} onChange={setV} />
    </>
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
  FakeRecogniser.last = null
})

describe('DictateButton', () => {
  it('is not offered where the browser cannot recognise speech', () => {
    render(<Field />)
    expect(screen.queryByTestId('dictate')).toBeNull()
  })

  it('adds what was said to the field, where it can still be corrected', async () => {
    vi.stubGlobal('webkitSpeechRecognition', FakeRecogniser)
    const user = userEvent.setup()
    render(<Field initial="Walked" />)

    await user.click(screen.getByRole('button', { name: 'Dictate the answer' }))
    const r = FakeRecogniser.last!
    expect(r.started).toBe(true)
    expect(r.lang).toBe('en-IN')
    expect(screen.getByRole('button', { name: 'Stop dictating' })).toHaveAttribute('aria-pressed', 'true')

    r.say('not yet', false)
    expect(screen.getByLabelText('Answer')).toHaveValue('Walked')
    r.say('three days ')
    expect(screen.getByLabelText('Answer')).toHaveValue('Walked three days')

    await user.click(screen.getByRole('button', { name: 'Stop dictating' }))
    expect(screen.getByRole('button', { name: 'Dictate the answer' })).toHaveAttribute('aria-pressed', 'false')
    await user.type(screen.getByLabelText('Answer'), ' a week')
    expect(screen.getByLabelText('Answer')).toHaveValue('Walked three days a week')
  })

  it('listens in the language the answers are written in', async () => {
    vi.stubGlobal('SpeechRecognition', FakeRecogniser)
    const user = userEvent.setup()
    render(<Field lang="ur" />)
    await user.click(screen.getByTestId('dictate'))
    expect(FakeRecogniser.last!.lang).toBe('ur-IN')
  })

  it('says so when the microphone is refused, and stays quiet after a silence', async () => {
    vi.stubGlobal('webkitSpeechRecognition', FakeRecogniser)
    const user = userEvent.setup()
    render(<Field />)

    await user.click(screen.getByTestId('dictate'))
    FakeRecogniser.last!.fail('no-speech')
    expect(screen.queryByRole('alert')).toBeNull()

    await user.click(screen.getByTestId('dictate'))
    FakeRecogniser.last!.fail('not-allowed')
    expect(screen.getByRole('alert')).toHaveTextContent('The browser was not allowed to use the microphone.')
  })
})

describe('appendDictated', () => {
  it('puts one space between what was there and what was said', () => {
    expect(appendDictated('', 'yes')).toBe('yes')
    expect(appendDictated('Walked  ', 'twice')).toBe('Walked twice')
  })
})
