// Reuse Part 3's prompt set and rubric definition. The judging runs through this
// system's own model router so there is a single key and a single config, but
// the substance (which prompts, which criteria) is Part 3's, not re-invented.
import { TEST_PROMPTS } from '../../../part3/src/prompts.js';
const CRITERIA_SCHEMA = {
  type: 'object',
  properties: {
    reflectsIntent: {
      type: 'boolean',
    },
    coherent: {
      type: 'boolean',
    },
    preservesCoreInformation: {
      type: 'boolean',
    },
    meaningfullyDifferent: {
      type: 'boolean',
    },
    confidence: {
      type: 'number',
      minimum: 0,
      maximum: 1,
    },
    summary: {
      type: 'string',
    },
  },
  required: [
    'reflectsIntent',
    'coherent',
    'preservesCoreInformation',
    'meaningfullyDifferent',
    'confidence',
    'summary',
  ],
  additionalProperties: false,
};
const JUDGE_SYSTEM =
  'You grade the output of an AI script-rewriting feature against the user intent. ' +
  'Judge each criterion independently and against the stated intent, not your own ' +
  'preferences. The original comes from a screen recording, so cleaning up filler ' +
  'and speech artifacts is an improvement, not information loss. Be honest about ' +
  'uncertainty: confidence below the threshold means a human should look.';

/**
 * Drives Modify Script with AI for one prompt, then grades the rewrite. The
 * result carries a confidence, and a low-confidence pass is reported as such so
 * the ledger and report can route it to review rather than trusting it.
 */
function aiScriptCheck(promptId) {
  return async (ctx) => {
    const spec = TEST_PROMPTS.find((p) => p.id === promptId);
    const id = `ai.modify.${promptId}`;
    ctx.session.beginCapture();
    if (!spec) {
      return skip(id, promptId, 'Unknown prompt id');
    }
    if (!ctx.router.strongAvailable) {
      return skip(id, promptId, 'No strong model key; AI validation skipped');
    }
    let original = '';
    let modified = '';
    try {
      const capture = await ctx.editor.modifyScriptWithAi(spec.prompt);
      original = capture.original;
      modified = capture.modified;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const evidence = await ctx.session.snapshotEvidence(id);
      return {
        id,
        title: `AI rewrite honours "${spec.prompt}"`,
        category: 'ai-validation',
        outcome: 'error',
        severity: 'medium',
        expected: spec.intent,
        actual: `Could not capture a rewrite: ${message}`,
        assertionExercised: false,
        evidence,
        message:
          'If this was a Trupeer rate limit or feature error, record it as a bug in ' +
          'part1/bugs.md; the harness handled it without aborting the run.',
      };
    }
    const evidence = await ctx.session.snapshotEvidence(id);
    const user =
      `USER INSTRUCTION: ${spec.prompt}\n` +
      `INTENDED OUTCOME: ${spec.intent}\n\n` +
      `ORIGINAL SCRIPT:\n${original}\n\nMODIFIED SCRIPT:\n${modified}`;
    const judgement = await ctx.router.structured(
      'ai-script-judge',
      JUDGE_SYSTEM,
      user,
      CRITERIA_SCHEMA,
      (raw) => JSON.parse(raw),
    );
    const passedAll =
      judgement.reflectsIntent &&
      judgement.coherent &&
      judgement.preservesCoreInformation &&
      judgement.meaningfullyDifferent;
    const confident = judgement.confidence >= 0.75;
    const outcome = passedAll && confident ? 'pass' : 'fail';
    const severity = passedAll ? 'low' : 'medium';
    return {
      id,
      title: `AI rewrite honours "${spec.prompt}"`,
      category: 'ai-validation',
      outcome,
      severity,
      expected: spec.intent,
      actual:
        `${judgement.summary} ` +
        `(intent:${judgement.reflectsIntent ? 'y' : 'n'} coherent:${judgement.coherent ? 'y' : 'n'} ` +
        `preserved:${judgement.preservesCoreInformation ? 'y' : 'n'} different:${judgement.meaningfullyDifferent ? 'y' : 'n'})`,
      assertionExercised: original.length > 0 && modified.length > 0,
      confidence: judgement.confidence,
      evidence,
      message: !confident
        ? `Low confidence (${judgement.confidence.toFixed(2)}): send to human review rather than trusting.`
        : undefined,
    };
  };
}
function skip(id, promptId, reason) {
  return {
    id,
    title: `AI rewrite honours "${promptId}"`,
    category: 'ai-validation',
    outcome: 'skipped',
    severity: 'info',
    expected: 'A valid, on-intent rewrite',
    actual: reason,
    assertionExercised: false,
    evidence: {
      consoleErrors: [],
      networkEvents: [],
    },
  };
}

/**
 * Which prompts to validate this run. Defaults to one (concise) to keep runs
 * fast and cheap; set AI_PROMPTS to a comma-separated list of Part 3 prompt ids
 * for more coverage.
 */
export function aiValidationChecks() {
  const raw = process.env.AI_PROMPTS?.trim();
  const ids = raw
    ? raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : ['concise'];
  return ids.map(aiScriptCheck);
}
