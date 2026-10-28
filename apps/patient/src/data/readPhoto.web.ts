/* A photo's bytes and their type, ready to send as a request body. */
export type Photo = { body: Blob; type: string }

/*
 * Reads the photo the browser's file picker gave, a blob: URL. A failed
 * read throws, so an error page is never uploaded as the photo.
 */
export async function readPhoto(uri: string): Promise<Photo> {
  const res = await fetch(uri)
  if (!res.ok) throw new Error('The photo could not be read')
  const body = await res.blob()
  return { body, type: body.type }
}
