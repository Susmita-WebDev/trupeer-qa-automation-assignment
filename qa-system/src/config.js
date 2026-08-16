import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
const here = path.dirname(fileURLToPath(import.meta.url));
export const SYSTEM_ROOT = path.resolve(here, '..');
export const REPO_ROOT = path.resolve(SYSTEM_ROOT, '..');

// One shared config for the whole repo: the .env at the repo root configures
// Part 2, Part 3, and this system.
dotenv.config({
  path: path.resolve(REPO_ROOT, '.env'),
});
function optional(name, fallback) {
  return process.env[name]?.trim() || fallback;
}
export const config = {
  targetUrl: optional('TARGET_URL', 'https://app.trupeer.ai').replace(/\/$/, ''),
  anthropicApiKey: process.env.ANTHROPIC_API_KEY?.trim() || '',
  geminiApiKey: process.env.GEMINI_API_KEY?.trim() || '',
  strongModel: optional('STRONG_MODEL', 'claude-opus-5'),
  visionModel: optional('VISION_MODEL', 'gemini-2.5-flash'),
  openReport: optional('OPEN_REPORT', '1') === '1',
  headed: optional('HEADED', '0') === '1',
  // Persisted state (committed) and per-run artefacts (gitignored).
  ledgerPath: path.join(SYSTEM_ROOT, 'state', 'ledger.json'),
  runsDir: path.join(SYSTEM_ROOT, 'runs'),
  baselinesDir: path.join(SYSTEM_ROOT, 'baselines'),
};
export function hasStrongModel() {
  return config.anthropicApiKey.length > 0;
}
export function hasVisionModel() {
  return config.geminiApiKey.length > 0;
}
