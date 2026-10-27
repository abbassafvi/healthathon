/*
 * A stored photo's address, asking the API for a copy no wider than
 * `width`. For thumbnails only: a link to the photo uses the address as it
 * is, so the clinician opens the photograph exactly as it was sent.
 */
export function thumbnail(url: string, width = 320): string {
  return `${url}${url.includes('?') ? '&' : '?'}width=${width}`
}
