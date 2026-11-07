import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CameraCapture, cameraAvailable } from './CameraCapture'

/* A camera the browser never actually opens. */
function fakeStream() {
  const track = { stop: vi.fn() }
  return { stream: { getTracks: () => [track] } as unknown as MediaStream, track }
}

function useCamera(result: Promise<MediaStream>) {
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn(() => result) },
  })
}

beforeEach(() => {
  // jsdom draws nothing, so the canvas hands back a blob the test controls.
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({ drawImage: vi.fn() })) as never
  HTMLCanvasElement.prototype.toBlob = function (cb: BlobCallback) {
    cb(new Blob(['page'], { type: 'image/png' }))
  } as never
  Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', { configurable: true, value: 1920 })
  Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', { configurable: true, value: 1440 })
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:held', revokeObjectURL: () => {} }))
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('CameraCapture', () => {
  it('is not offered where the browser cannot open a camera', () => {
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined })
    expect(cameraAvailable()).toBe(false)
  })

  it('holds the photograph for a look before it is used', async () => {
    const { stream } = fakeStream()
    useCamera(Promise.resolve(stream))
    const onCapture = vi.fn()
    const user = userEvent.setup()
    render(<CameraCapture onCapture={onCapture} onClose={() => {}} />)

    await user.click(await screen.findByRole('button', { name: 'Take the photograph' }))
    // Nothing is added until a person says so.
    expect(onCapture).not.toHaveBeenCalled()
    expect(screen.getByAltText('The photograph just taken')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Use this photograph' }))
    expect(onCapture).toHaveBeenCalledOnce()
    expect(onCapture.mock.calls[0][0]).toBeInstanceOf(File)
  })

  it('a photograph taken again replaces the one held, and adds nothing', async () => {
    const { stream } = fakeStream()
    useCamera(Promise.resolve(stream))
    const onCapture = vi.fn()
    const user = userEvent.setup()
    render(<CameraCapture onCapture={onCapture} onClose={() => {}} />)

    await user.click(await screen.findByRole('button', { name: 'Take the photograph' }))
    await user.click(screen.getByRole('button', { name: 'Take it again' }))

    expect(onCapture).not.toHaveBeenCalled()
    expect(screen.queryByAltText('The photograph just taken')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Take the photograph' })).toBeInTheDocument()
  })

  it('says what to do when the camera is refused', async () => {
    useCamera(Promise.reject(Object.assign(new Error('no'), { name: 'NotAllowedError' })))
    render(<CameraCapture onCapture={() => {}} onClose={() => {}} />)
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('not allowed to use the camera')
    // The recovery is named, not just the problem.
    expect(alert).toHaveTextContent('choose a photograph from this computer')
  })

  it('releases the camera when it closes', async () => {
    const { stream, track } = fakeStream()
    useCamera(Promise.resolve(stream))
    const user = userEvent.setup()
    render(<CameraCapture onCapture={() => {}} onClose={() => {}} />)

    await screen.findByRole('button', { name: 'Take the photograph' })
    await user.click(screen.getByRole('button', { name: 'Close the camera' }))
    await waitFor(() => expect(track.stop).toHaveBeenCalled())
  })
})
