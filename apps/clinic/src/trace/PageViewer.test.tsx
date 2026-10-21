import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { controlImages } from '../test/images'
import { PageViewer } from './PageViewer'

const URL_ = '/api/storage/dev/pages/p.png'
const box = { x: 0.5, y: 0.25, w: 0.1, h: 0.02 }

afterEach(() => vi.unstubAllGlobals())

function setup(props: Partial<Parameters<typeof PageViewer>[0]> = {}) {
  const images = controlImages()
  const user = userEvent.setup()
  render(<PageViewer url={URL_} width={1000} height={2000} box={box} alt="the page" {...props} />)
  return { images, user }
}

describe('PageViewer', () => {
  it('draws nothing until the page image has loaded', () => {
    const { images } = setup()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    act(() => images.load(URL_))
    expect(screen.getByRole('img', { name: 'the page' })).toBeInTheDocument()
  })

  it('outlines the region in page pixels', () => {
    const { images } = setup()
    act(() => images.load(URL_))
    expect(screen.getByTestId('trace-box')).toHaveAttribute('data-box', '500.0 500.0 100.0 40.0')
  })

  it('opens zoomed on the value and W toggles the whole page', async () => {
    const { images, user } = setup()
    act(() => images.load(URL_))
    const svg = screen.getByRole('img')
    expect(svg).toHaveAttribute('data-mode', 'zoom')
    expect(screen.getByRole('button', { name: 'Zoom to value' })).toHaveAttribute('aria-pressed', 'true')
    await user.keyboard('w')
    expect(svg).toHaveAttribute('data-mode', 'page')
    expect(screen.getByRole('button', { name: 'Whole page' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: 'Zoom to value' }))
    expect(svg).toHaveAttribute('data-mode', 'zoom')
  })

  it('shows the whole page, with no box and no zoom controls, when there is no region', () => {
    const { images } = setup({ box: null })
    act(() => images.load(URL_))
    expect(screen.getByRole('img')).toHaveAttribute('data-mode', 'page')
    expect(screen.getByRole('img')).toHaveAttribute('viewBox', '0.0 0.0 1000.0 2000.0')
    expect(screen.queryByTestId('trace-box')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Whole page' })).not.toBeInTheDocument()
  })

  it('offers a retry when the image fails, and recovers', async () => {
    const { images, user } = setup()
    act(() => images.fail(URL_))
    expect(screen.getByText('The page image did not load.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    act(() => images.load(URL_))
    expect(screen.getByRole('img')).toBeInTheDocument()
  })
})
