import { execFileSync } from 'node:child_process'

import { API_DIR, E2E_ENV } from './env'

/* Truncate every table and write the stand-in seed again. */
export function reseed(): void {
  execFileSync('uv', ['run', 'python', '-m', 'dev_seed', '--reset'], {
    cwd: API_DIR,
    env: { ...process.env, ...E2E_ENV },
    stdio: 'pipe',
  })
}
