/**
 * The regression explainer. It reads the structured evidence diff (the same
 * console -> network -> DOM -> timing order a human would work through) and
 * writes the single most likely cause, anchored to the evidence lines it was
 * given. It is told not to speculate beyond the evidence, so the "why" stays
 * grounded rather than plausible-sounding fiction.
 */
const TRIAGE_SYSTEM =
  'You are a senior engineer triaging a web app regression. A check that passed ' +
  'on the previous run fails now. You are given the check, and a structured diff ' +
  'of what changed between the last passing run and this failing run: new console ' +
  'errors, HTTP status changes, requests that stopped firing, missing DOM ' +
  'elements, and timing shifts.\n\n' +
  'Work in this order, because it is where causes usually surface: console errors ' +
  'first, then network, then DOM, then timing. Name the single most likely cause ' +
  'in one paragraph. Ground every claim in a specific evidence line you were ' +
  'given; do not invent mechanisms the evidence does not support. If the evidence ' +
  'is thin, say so and lower your confidence rather than guessing.';
const ROOT_CAUSE_SCHEMA = {
  type: 'object',
  properties: {
    hypothesis: {
      type: 'string',
      description: 'One paragraph, the single most likely cause.',
    },
    layer: {
      type: 'string',
      enum: ['frontend', 'backend', 'network', 'unknown'],
      description: 'Where the fault most likely sits.',
    },
    confidence: {
      type: 'number',
      minimum: 0,
      maximum: 1,
    },
    evidence: {
      type: 'array',
      items: {
        type: 'string',
      },
      description: 'The evidence lines that support the hypothesis, quoted.',
    },
  },
  required: ['hypothesis', 'layer', 'confidence', 'evidence'],
  additionalProperties: false,
};
export async function triageRegression(router, result, diffText) {
  const user =
    `CHECK: ${result.title}\n` +
    `EXPECTED: ${result.expected}\n` +
    `OBSERVED NOW: ${result.actual}\n\n` +
    `EVIDENCE DIFF (last passing run -> this failing run):\n${diffText}`;
  return router.structured(
    'regression-triage',
    TRIAGE_SYSTEM,
    user,
    ROOT_CAUSE_SCHEMA,
    (raw) => JSON.parse(raw),
  );
}

/**
 * The fix-intent judge. A green check is not proof of a fix, so this decides
 * whether a previously-failing check that now passes was genuinely repaired or
 * merely stopped exercising anything. The `assertionExercised` flag and the
 * DOM presence are the deciding evidence.
 */
const FIX_INTENT_SYSTEM =
  'A check that failed on the previous run now passes. Decide whether this is a ' +
  'genuine product fix or a false pass. A false pass happens when the check no ' +
  'longer exercises its target: the element it looked for is gone, so it matches ' +
  'nothing and reports green. You are given whether the assertion actually ' +
  'exercised its target and which DOM elements were present. If the assertion ' +
  'did not exercise its target, it is not a real fix. Be conservative: when in ' +
  'doubt, treat it as unintended and lower confidence.';
const FIX_INTENT_SCHEMA = {
  type: 'object',
  properties: {
    intended: {
      type: 'boolean',
      description: 'True only if this is a genuine product fix.',
    },
    confidence: {
      type: 'number',
      minimum: 0,
      maximum: 1,
    },
    reasoning: {
      type: 'string',
    },
  },
  required: ['intended', 'confidence', 'reasoning'],
  additionalProperties: false,
};
export async function classifyFixIntent(router, entry) {
  const { result } = entry;
  const dom = result.evidence.domPresence
    ? JSON.stringify(result.evidence.domPresence)
    : '(none captured)';
  const user =
    `CHECK: ${result.title}\n` +
    `EXPECTED BEHAVIOUR: ${result.expected}\n` +
    `OBSERVED NOW: ${result.actual}\n` +
    `ASSERTION EXERCISED ITS TARGET: ${result.assertionExercised}\n` +
    `DOM PRESENCE: ${dom}\n` +
    `CLASSIFICATION HINT: ${entry.classification}`;
  return router.structured(
    'fix-intent',
    FIX_INTENT_SYSTEM,
    user,
    FIX_INTENT_SCHEMA,
    (raw) => JSON.parse(raw),
  );
}
