import { defineConfig, devices } from '@playwright/test'

import { API_PORT, E2E_ENV, WEB_PORT } from './e2e/env'

/*
 * End-to-end tests drive a real browser against the real API and a real
 * PostgreSQL 16 database (healthathon_e2e), rebuilt from db/schema.sql on
 * start and reseeded before every test. Nothing is mocked.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL: `http://127.0.0.1:${WEB_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    viewport: { width: 1366, height: 900 },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 900 } } }],
  webServer: [
    {
      command: `uv run python -m dev_seed.create_db healthathon_e2e && uv run uvicorn healthathon.main:app --port ${API_PORT}`,
      cwd: '../../api',
      env: E2E_ENV,
      url: `http://127.0.0.1:${API_PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `npx vite --port ${WEB_PORT} --strictPort`,
      env: { API_TARGET: `http://127.0.0.1:${API_PORT}` },
      url: `http://127.0.0.1:${WEB_PORT}`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
})
