import { execFileSync } from 'node:child_process'

import { API_DIR, E2E_ENV } from './env'

const env = { ...process.env, ...E2E_ENV }

/* Truncate every table and write the stand-in seed again. */
export function reseed(): void {
  execFileSync('uv', ['run', 'python', '-m', 'dev_seed', '--reset'], { cwd: API_DIR, env, stdio: 'pipe' })
}

/*
 * Run one read-only query against the e2e database and return the rows.
 * Used to check what actually landed, rather than trusting the UI.
 */
export function query<T = Record<string, unknown>>(sql: string): T[] {
  const script = [
    'import json, os, sys, psycopg',
    'from psycopg.rows import dict_row',
    'with psycopg.connect(os.environ["HEALTHATHON_DATABASE_URL"], row_factory=dict_row) as c:',
    '    print(json.dumps(c.execute(sys.argv[1]).fetchall(), default=str))',
  ].join('\n')
  const out = execFileSync('uv', ['run', 'python', '-c', script, sql], { cwd: API_DIR, env, encoding: 'utf8' })
  return JSON.parse(out) as T[]
}
