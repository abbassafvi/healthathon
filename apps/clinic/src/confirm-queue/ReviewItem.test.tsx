import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { queueItem } from '../test/fixtures'
import { ReviewItem } from './ReviewItem'

function setup(item = queueItem()) {
  const onDecide = vi.fn()
  const user = userEvent.setup()
  render(<ReviewItem item={item} onDecide={onDecide} />)
  const crop = () => screen.getByAltText(/region of the page/i)
  const confirm = () => screen.getByRole('button', { name: /confirm as read/i })
  const paint = async () => {
    fireEvent.load(crop())
    await waitFor(() => expect(confirm()).toBeEnabled())
  }
  return { onDecide, user, crop, confirm, paint }
}

describe('ReviewItem crop gate', () => {
  it('keeps every control disabled until the crop has rendered', async () => {
    const { confirm, paint } = setup()
    const buttons = screen.getAllByRole('button')
    expect(buttons.length).toBeGreaterThan(2)
    for (const b of buttons) expect(b).toBeDisabled()
    expect(confirm()).toBeDisabled()
    await paint()
    for (const b of screen.getAllByRole('button')) expect(b).toBeEnabled()
  })

  it('ignores the keyboard before the crop has rendered', async () => {
    const { onDecide, user } = setup()
    await user.keyboard('{Enter}x1c')
    expect(onDecide).not.toHaveBeenCalled()
    expect(screen.queryByLabelText(/value as it appears/i)).not.toBeInTheDocument()
  })

  it('stays locked when the crop fails to load', async () => {
    const { onDecide, user, crop } = setup()
    fireEvent.error(crop())
    expect(await screen.findByText(/did not load/i)).toBeInTheDocument()
    await user.keyboard('{Enter}')
    expect(onDecide).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /confirm as read/i })).toBeDisabled()
  })
})

describe('ReviewItem decisions', () => {
  it('confirms with Enter and reports latency from the render', async () => {
    const { onDecide, user, paint } = setup()
    await paint()
    await user.keyboard('{Enter}')
    expect(onDecide).toHaveBeenCalledTimes(1)
    const decision = onDecide.mock.calls[0][0]
    expect(decision.action).toBe('confirm')
    expect(decision.decision_latency_ms).toBeGreaterThanOrEqual(0)
  })

  it('numbers only the alternatives to the reading shown', async () => {
    const { onDecide, user, paint } = setup()
    await paint()
    expect(screen.getByRole('button', { name: /use 7\.7/i })).toHaveAttribute('aria-keyshortcuts', '1')
    expect(screen.queryByRole('button', { name: /use 7\.1/i })).not.toBeInTheDocument()
    await user.keyboard('1')
    expect(onDecide.mock.calls[0][0]).toMatchObject({
      action: 'correct',
      value_text: '7.7',
      unit_text: '%',
    })
  })

  it('discards with X', async () => {
    const { onDecide, user, paint } = setup()
    await paint()
    await user.keyboard('x')
    expect(onDecide.mock.calls[0][0].action).toBe('discard')
  })

  it('corrects through an empty field opened with C', async () => {
    const { onDecide, user, paint } = setup()
    await paint()
    await user.keyboard('c')
    const field = screen.getByLabelText(/value as it appears/i)
    expect(field).toHaveFocus()
    expect(field).toHaveValue('')
    await user.keyboard('{Enter}')
    expect(onDecide).not.toHaveBeenCalled()
    await user.type(field, '7.4{Enter}')
    expect(onDecide.mock.calls[0][0]).toMatchObject({ action: 'correct', value_text: '7.4', unit_text: '%' })
  })

  it('Escape leaves the correction field without deciding', async () => {
    const { onDecide, user, paint } = setup()
    await paint()
    await user.keyboard('c')
    await user.keyboard('{Escape}')
    expect(screen.queryByLabelText(/value as it appears/i)).not.toBeInTheDocument()
    expect(onDecide).not.toHaveBeenCalled()
  })

  it('sends at most one decision per item', async () => {
    const { onDecide, user, paint } = setup()
    await paint()
    await user.keyboard('{Enter}x{Enter}')
    expect(onDecide).toHaveBeenCalledTimes(1)
  })

  it('shows the reason in plain words and the value exactly as read', () => {
    setup(queueItem({ reason: 'outside_assay_range', value_text: '1410', unit_text: 'mg/dL' }))
    expect(screen.getByText('1410')).toBeInTheDocument()
    expect(screen.getByText(/outside what this test can report/i)).toBeInTheDocument()
  })
})
