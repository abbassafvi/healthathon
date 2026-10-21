import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

export const REPO = path.resolve(here, '../../..')
export const API_DIR = path.join(REPO, 'api')
export const API_PORT = 8001
export const WEB_PORT = 5174

export const E2E_ENV: Record<string, string> = {
  HEALTHATHON_DATABASE_URL: 'postgresql://healthathon:healthathon@127.0.0.1:5434/healthathon_e2e',
  // Under storage/, which .gitignore excludes.
  HEALTHATHON_STORAGE_DIR: path.join(REPO, 'storage', 'e2e'),
}
