import { File } from 'expo-file-system'

/* A photo's bytes and their type, ready to send as a request body. */
export type Photo = { body: Uint8Array<ArrayBuffer>; type: string }

/*
 * Reads the photo the camera or gallery saved on the phone. On Android,
 * fetch() cannot open a file:// URI: Expo's fetch answers "File not found",
 * and that text was once uploaded as the photo. Reading through
 * expo-file-system fails loudly instead. Bytes rather than the File itself,
 * so the Content-Type set by the caller is the one sent.
 */
export async function readPhoto(uri: string): Promise<Photo> {
  const file = new File(uri)
  if (!file.exists || file.size === 0) throw new Error('The photo could not be read')
  return { body: await file.bytes(), type: file.type }
}
