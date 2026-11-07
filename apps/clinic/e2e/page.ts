import { execFileSync } from 'node:child_process'

import { API_DIR, E2E_ENV } from './env'

/*
 * The pages the browser tests upload, generated now rather than
 * committed: no document image belongs in this repository.
 *
 * Every variant is built in one call at import time, never inside a
 * test. A synchronous spawn cannot be interrupted when a test times
 * out, and one left running inside a test body hangs the whole worker.
 */
export type PageName = 'lab' | 'rx' | 'single' | 'blank' | 'p1' | 'p2'

const built: Record<string, string> = JSON.parse(
  execFileSync('uv', ['run', 'python', '-m', 'dev_seed.stub_page', '--set'], {
    cwd: API_DIR,
    env: { ...process.env, ...E2E_ENV },
    encoding: 'utf8',
    maxBuffer: 1 << 24,
  }),
) as Record<string, string>

/*
 * `lab` holds four regions of writing with the last one smeared, so the
 * legibility check refuses it. `rx` holds two, `single` one, `blank`
 * none. `p1` and `p2` differ only in their bytes.
 */
export function doc(which: PageName, fileName = `${which}.png`): { name: string; mimeType: string; buffer: Buffer } {
  const data = built[which]
  if (!data) throw new Error(`no generated page named ${which}`)
  return { name: fileName, mimeType: 'image/png', buffer: Buffer.from(data, 'base64') }
}
