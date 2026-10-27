import { defineConfig, devices } from '@playwright/test'

/*
 * The patient app's screens, driven on Expo's web target. The export is
 * rebuilt before the run and served as static files.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:8091',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...devices['Pixel 7'],
  },
  projects: [{ name: 'android-sized', use: { ...devices['Pixel 7'] } }],
  webServer: {
    command: 'npx expo export --platform web --output-dir dist-web && python3 -m http.server 8091 --directory dist-web',
    url: 'http://127.0.0.1:8091',
    reuseExistingServer: false,
    timeout: 300_000,
  },
})
