import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
const here = path.dirname(fileURLToPath(import.meta.url));
export const PART3_ROOT = path.resolve(here, '..');

// Part 2's .env carries the Trupeer credentials; part3/.env adds the judge's.
dotenv.config({
  path: path.resolve(PART3_ROOT, '..', 'part2', '.env'),
});
dotenv.config({
  path: path.join(PART3_ROOT, '.env'),
  override: true,
});
function optional(name, fallback) {
  return process.env[name]?.trim() || fallback;
}
export const config = {
  get anthropicApiKey() {
    const key = process.env.ANTHROPIC_API_KEY?.trim();
    if (!key) {
      throw new Error(
        'ANTHROPIC_API_KEY is not set. Copy part3/.env.example to part3/.env and add your key.',
      );
    }
    return key;
  },
  judgeModel: optional('JUDGE_MODEL', 'claude-opus-5'),
  judgeEffort: optional('JUDGE_EFFORT', 'high'),
  confidenceThreshold: Number(optional('CONFIDENCE_THRESHOLD', '0.75')),
  resultsDir: path.resolve(PART3_ROOT, optional('RESULTS_DIR', 'results')),
  headed: optional('HEADED', '0') === '1',
};
