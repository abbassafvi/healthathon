/* Hex SHA-256 of a file, computed on the device: the duplicate check key. */
export async function sha256Hex(file: Blob): Promise<string> {
  // Copy into this realm's Uint8Array: some environments hand back an
  // ArrayBuffer that WebCrypto in this realm will not accept.
  const bytes = Uint8Array.from(new Uint8Array(await file.arrayBuffer()))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
