/**
 * The prompts sent to Trupeer's "Modify Script with AI".
 *
 * Each carries an `intent` written for the judge: a plain-language statement of
 * what a correct response would look like. The judge grades against the intent,
 * not against the prompt string, because "make this more professional" is not
 * something a rubric can check literally.
 *
 * The set is deliberately varied in *kind*, not just wording — tone change,
 * additive change, translation, and compression each stress a different part of
 * the feature. Four near-identical rephrasings would all pass or all fail
 * together and tell us nothing.
 */

export const TEST_PROMPTS = [
  {
    id: 'concise',
    prompt: 'Make this script more concise.',
    intent:
      'The output should be meaningfully shorter than the original while keeping ' +
      'every substantive point. Cutting filler and redundancy is correct; dropping ' +
      'a distinct fact or step is not.',
  },
  {
    id: 'professional',
    prompt: 'Make this more professional.',
    intent:
      'The output should read in a more formal, polished register — fewer colloquialisms, ' +
      'fewer filler words, tighter sentence construction — while saying the same things ' +
      'as the original. Length may stay roughly the same.',
  },
  {
    id: 'call-to-action',
    prompt: 'Add a call to action at the end.',
    intent:
      'The output should keep the original script essentially intact and append a ' +
      'closing call to action (e.g. inviting the viewer to sign up, try the product, ' +
      'or get in touch). Rewriting the whole script is not what was asked for.',
  },
  {
    id: 'translate-spanish',
    prompt: 'Translate this script to Spanish.',
    intent:
      'The output should be the same script rendered in fluent Spanish, preserving ' +
      'meaning, structure and any product names. Output that remains in English is a ' +
      'failure, as is a partial translation.',
    waived: {
      coherent:
        'Grammatical correctness is judged in Spanish, not English — the criterion is ' +
        'applied to the target language.',
    },
  },
  {
    id: 'beginner-friendly',
    prompt: 'Rewrite this so a complete beginner can follow it, explaining any jargon.',
    intent:
      'The output should explain or replace technical terms and add brief context where ' +
      'the original assumed knowledge. It may be longer than the original. It must not ' +
      'become inaccurate in the process of simplifying.',
  },
];
