/*
 * A capture id made on the device at the moment of the action. It is the
 * idempotency key end to end, so a retry or a double tap records once.
 */
export function captureId(): string {
  const rand = Math.random().toString(36).slice(2, 10)
  return `${Date.now().toString(36)}-${rand}`
}
