import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
const here = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = path.resolve(here, '..', '..');
// One shared config for the whole repo: the .env at the repo root (one level
// above part2/) configures both Part 2 and Part 3.
export const REPO_ROOT = path.resolve(PROJECT_ROOT, '..');
dotenv.config({
  path: path.join(REPO_ROOT, '.env'),
});
function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable ${name}. ` +
        `Copy .env.example to .env in the repo root and fill it in.`,
    );
  }
  return value;
}
function optional(name, fallback) {
  return process.env[name]?.trim() || fallback;
}
export const env = {
  baseURL: optional('TRUPEER_BASE_URL', 'https://app.trupeer.ai').replace(/\/$/, ''),
  authMode: optional('AUTH_MODE', 'manual'),
  /** Only read when authMode === 'password'. */
  get email() {
    return required('TRUPEER_EMAIL');
  },
  get password() {
    return required('TRUPEER_PASSWORD');
  },
  storageStatePath: path.resolve(
    PROJECT_ROOT,
    optional('STORAGE_STATE_PATH', '.auth/user.json'),
  ),
  /** Empty string means "use the first video on the dashboard". */
  videoName: optional('TRUPEER_VIDEO_NAME', ''),
  aiResponseTimeoutMs: Number(optional('AI_RESPONSE_TIMEOUT_MS', '120000')),
  headed: optional('HEADED', '0') === '1',
};
