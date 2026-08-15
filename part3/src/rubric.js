import { z } from 'zod';

/**
 * The validation rubric.
 *
 * Four criteria, each independently gradeable. They are deliberately
 * orthogonal: intent-following can pass while information-preservation fails
 * (an over-aggressive summariser), and vice versa (a rewrite that preserves
 * everything but ignored the prompt). Collapsing them into one "is it good?"
 * score would hide exactly the failures worth catching.
 *
 * Every criterion demands `evidence` - a quote or concrete observation. A judge
 * forced to cite something is markedly harder to talk into a confident verdict
 * it cannot support, and it makes disagreements auditable by a human later.
 */
export const CRITERIA = {
  reflectsIntent: {
    label: 'Reflects the prompt intent',
    question:
      'Does the modified script do what the user asked for, as described in the stated intent?',
  },
  coherent: {
    label: 'Coherent and grammatical',
    question:
      'Is the modified script fluent, grammatically correct, and internally consistent? ' +
      'Judge in whatever language the output is written in.',
  },
  preservesCoreInformation: {
    label: 'Preserves core information',
    question:
      'Does the modified script retain the substantive facts, steps and claims of the ' +
      'original? Removing filler is fine; losing a distinct fact is not.',
  },
  meaningfullyDifferent: {
    label: 'Meaningfully different',
    question:
      'Is the modified script a genuine rewrite rather than a trivial reword - a few ' +
      'synonyms swapped, punctuation changed, or the original returned verbatim?',
  },
};
const CriterionVerdict = z.object({
  passed: z.boolean().describe('Whether this criterion is satisfied.'),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe(
      'How confident you are in this verdict, 0 to 1. Use values below 0.75 when the ' +
        'call is genuinely borderline - do not inflate confidence to seem decisive.',
    ),
  evidence: z
    .string()
    .describe(
      'A short quote from the modified script, or a concrete observation, that supports ' +
        'the verdict. Required whether the criterion passed or failed.',
    ),
  reasoning: z.string().describe('One or two sentences explaining the verdict.'),
});
export const JudgementSchema = z.object({
  reflectsIntent: CriterionVerdict,
  coherent: CriterionVerdict,
  preservesCoreInformation: CriterionVerdict,
  meaningfullyDifferent: CriterionVerdict,
  overallAssessment: z
    .string()
    .describe('Two sentences at most, summarising whether this rewrite is acceptable.'),
});
export const CRITERION_KEYS = Object.keys(CRITERIA);
