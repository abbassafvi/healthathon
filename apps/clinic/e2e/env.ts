import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

export const REPO = path.resolve(here, '../../..')
export const API_DIR = path.join(REPO, 'api')
export const API_PORT = 8001
export const WEB_PORT = 5174

export const E2E_ENV: Record<string, string> = {
  HEALTHATHON_DATABASE_URL: 'postgresql://healthathon:healthathon@127.0.0.1:5434/healthathon_e2e',
  // The browser tests read with the built-in stand-in: no paddlepaddle to
  // install and no model provider to reach. What the real reader decides
  // is settled by the API's own tests.
  HEALTHATHON_DETECTOR: 'stub',
  HEALTHATHON_AGENT_PROVIDER: 'stub',
  // Under storage/, which .gitignore excludes.
  HEALTHATHON_STORAGE_DIR: path.join(REPO, 'storage', 'e2e'),
  // The gateway secrets the suite sends, not whatever a developer's
  // api/.env holds. Rotating a real key must not turn these tests red.
  HEALTHATHON_SMS_GATEWAY_KEY: 'dev-only-gateway-key',
  HEALTHATHON_VOICE_GATEWAY_KEY: 'dev-only-voice-key',
  // Sign-in stays in test mode, whatever Twilio keys api/.env holds:
  // the visit tests sign a patient in, and no browser test may text a phone.
  HEALTHATHON_TWILIO_ACCOUNT_SID: '',
  HEALTHATHON_TWILIO_AUTH_TOKEN: '',
  HEALTHATHON_TWILIO_VERIFY_SID: '',
}
