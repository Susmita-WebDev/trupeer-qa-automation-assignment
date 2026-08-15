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
/**
 * The judge tries providers in order and uses the first that works, so a run
 * survives one provider being unavailable. Preference: the anthropic provider
 * first when its key is present, then Gemini (free) as the fallback. JUDGE_PROVIDER forces one to
 * the front. Whichever runs, the rubric, scoring, and report are identical - only
 * the single model call differs.
 */
function resolveProviders() {
  const available = [];
  if (process.env.ANTHROPIC_API_KEY?.trim()) available.push('anthropic');
  if (process.env.GEMINI_API_KEY?.trim()) available.push('gemini');
  const explicit = optional('JUDGE_PROVIDER', '').toLowerCase();
  if (explicit) return [explicit, ...available.filter((p) => p !== explicit)];
  return available;
}

export const config = {
  judgeProviders: resolveProviders(),
  get primaryProvider() {
    return this.judgeProviders[0] ?? 'anthropic';
  },

  get anthropicApiKey() {
    const key = process.env.ANTHROPIC_API_KEY?.trim();
    if (!key) {
      throw new Error(
        'ANTHROPIC_API_KEY is not set. Add it to part3/.env, or use a free ' +
          'GEMINI_API_KEY instead (the judge auto-detects it).',
      );
    }
    return key;
  },
  get geminiApiKey() {
    const key = process.env.GEMINI_API_KEY?.trim();
    if (!key) {
      throw new Error(
        'GEMINI_API_KEY is not set. Get a free key at ' +
          'https://aistudio.google.com/app/apikey and add it to part3/.env.',
      );
    }
    return key;
  },

  judgeModel: optional('JUDGE_MODEL', 'claude-opus-5'),
  judgeEffort: optional('JUDGE_EFFORT', 'high'),
  geminiModel: optional('GEMINI_MODEL', 'gemini-2.5-flash'),

  /** The model of the primary provider, for the report header. */
  get activeModel() {
    return this.primaryProvider === 'gemini' ? this.geminiModel : this.judgeModel;
  },

  confidenceThreshold: Number(optional('CONFIDENCE_THRESHOLD', '0.75')),
  resultsDir: path.resolve(PART3_ROOT, optional('RESULTS_DIR', 'results')),
  headed: optional('HEADED', '0') === '1',
};
