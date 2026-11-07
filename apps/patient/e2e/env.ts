import path from 'node:path'

// This package is CommonJS, so __dirname, not import.meta.
export const REPO = path.resolve(__dirname, '../../..')
export const API_DIR = path.join(REPO, 'api')
export const API_PORT = 8002
export const WEB_PORT = 8091
export const API_URL = `http://127.0.0.1:${API_PORT}`

/* Its own database and storage, so this suite never touches the clinic's e2e data. */
export const E2E_ENV: Record<string, string> = {
  HEALTHATHON_DATABASE_URL: 'postgresql://healthathon:healthathon@127.0.0.1:5434/healthathon_patient_e2e',
  // Under storage/, which .gitignore excludes.
  HEALTHATHON_STORAGE_DIR: path.join(REPO, 'storage', 'e2e-patient'),
  HEALTHATHON_CORS_ORIGINS: JSON.stringify([`http://127.0.0.1:${WEB_PORT}`]),
  // Every test signs in again on the same few numbers.
  HEALTHATHON_OTP_SENDS_PER_HOUR: '1000',
  // Sign-in stays in test mode, whatever SMS provider keys api/.env holds:
  // no browser test may text a real phone.
  HEALTHATHON_TWILIO_ACCOUNT_SID: '',
  HEALTHATHON_TWILIO_AUTH_TOKEN: '',
  HEALTHATHON_TWILIO_VERIFY_SID: '',
  HEALTHATHON_EXOTEL_API_KEY: '',
  HEALTHATHON_EXOTEL_API_TOKEN: '',
  HEALTHATHON_EXOTEL_ACCOUNT_SID: '',
  // A page sent from the phone is read by the stand-in reader: no
  // paddlepaddle, no network and no key, and the same answer every run.
  HEALTHATHON_DETECTOR: 'stub',
  HEALTHATHON_AGENT_PROVIDER: 'stub',
  // The stand-in reads the page once; three passes would say the same thing.
  HEALTHATHON_AGENT_READS: '1',
}
