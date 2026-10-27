import { defineConfig, devices } from '@playwright/test'

import { API_DIR, API_PORT, API_URL, E2E_ENV, WEB_PORT } from './e2e/env'

/*
 * The patient app's screens, driven on Expo's web target against the real
 * API and a real database. The export is rebuilt before the run, pointed
 * at that API, and served as static files.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${WEB_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...devices['Pixel 7'],
  },
  projects: [{ name: 'android-sized', use: { ...devices['Pixel 7'] } }],
  webServer: [
    {
      command: `uv run python -m dev_seed.create_db healthathon_patient_e2e && uv run uvicorn healthathon.main:app --port ${API_PORT}`,
      cwd: API_DIR,
      env: E2E_ENV,
      url: `${API_URL}/api/health`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `npx expo export --platform web --output-dir dist-web && python3 -m http.server ${WEB_PORT} --directory dist-web`,
      env: { EXPO_PUBLIC_API_URL: API_URL },
      url: `http://127.0.0.1:${WEB_PORT}`,
      reuseExistingServer: false,
      timeout: 300_000,
    },
  ],
})
