import { execFileSync } from 'node:child_process'

import { API_DIR, E2E_ENV } from './env'

/* Truncate every table and write the stand-in seed again. */
export function reseed(): void {
  execFileSync('uv', ['run', 'python', '-m', 'dev_seed', '--reset', '--no-history'], {
    cwd: API_DIR,
    env: { ...process.env, ...E2E_ENV },
    stdio: 'pipe',
  })
}

/* Run one SQL statement against the e2e database and return the rows. */
export function query<T = Record<string, unknown>>(sql: string): T[] {
  const script = [
    'import json, os, sys, psycopg',
    'from psycopg.rows import dict_row',
    'with psycopg.connect(os.environ["HEALTHATHON_DATABASE_URL"], row_factory=dict_row) as c:',
    '    cur = c.execute(sys.argv[1])',
    '    print(json.dumps(cur.fetchall() if cur.description else [], default=str))',
  ].join('\n')
  const out = execFileSync('uv', ['run', 'python', '-c', script, sql], { cwd: API_DIR, env: { ...process.env, ...E2E_ENV }, encoding: 'utf8' })
  return JSON.parse(out) as T[]
}
