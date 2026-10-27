/*
 * Where the clinic's API is. Set EXPO_PUBLIC_API_URL when starting or
 * exporting the app (http://10.0.2.2:8000 from the Android emulator, the
 * computer's LAN address from a phone). Without it the app runs on its
 * in-memory mock, which is what the unit tests use.
 */
export const API_URL: string | null = process.env.EXPO_PUBLIC_API_URL || null
