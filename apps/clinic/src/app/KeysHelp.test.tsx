import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { en } from '../strings/en'
import { KeysHelp } from './KeysHelp'

describe('KeysHelp', () => {
  it('lists every key of the screen behind one disclosure', async () => {
    const user = userEvent.setup()
    render(<KeysHelp keys={en.keys.queue} />)
    const summary = screen.getByText('Keyboard')
    expect(summary.closest('details')).not.toHaveAttribute('open')
    await user.click(summary)
    expect(summary.closest('details')).toHaveAttribute('open')
    for (const [k, what] of en.keys.queue) {
      expect(screen.getByText(k)).toBeInTheDocument()
      expect(screen.getByText(what)).toBeInTheDocument()
    }
  })
})
