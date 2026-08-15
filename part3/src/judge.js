import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { config } from './config.js';
import { CRITERIA, CRITERION_KEYS, JudgementSchema } from './rubric.js';
const client = new Anthropic({
  apiKey: config.anthropicApiKey,
});
const SYSTEM_PROMPT = `You evaluate the output of an AI script-rewriting feature in a video editing product.

You are given three things: the original video script, the instruction a user gave, and the script the feature produced. Grade the produced script against the rubric.

How to grade:

- Judge the output against the user's stated intent, not against your own preferences. If the user asked for something you consider a bad idea, a faithful execution of it still passes.
- Grade each criterion independently. A script can follow the instruction perfectly while losing information, or preserve everything while ignoring the instruction. Do not let one verdict pull the others along.
- Cite evidence for every verdict, including the ones that pass. Quote from the modified script where you can.
- Be honest about uncertainty. Confidence below 0.75 means "a human should look at this". Borderline calls are common and useful; a judge that reports 0.95 on everything is worthless, because it can no longer flag anything for review.
- The scripts come from a real screen recording, so the original may contain speech-recognition artifacts, filler words, and false starts. Do not penalise the rewrite for cleaning those up — that is an improvement, not information loss.`;
function buildUserMessage({ testPrompt, originalScript, modifiedScript }) {
  const rubricLines = CRITERION_KEYS.map((key) => {
    const waiver = testPrompt.waived?.[key];
    const note = waiver ? `\n  Note for this prompt: ${waiver}` : '';
    return `- ${key} (${CRITERIA[key].label}): ${CRITERIA[key].question}${note}`;
  }).join('\n');
  return `<user_instruction>
${testPrompt.prompt}
</user_instruction>

<intended_outcome>
${testPrompt.intent}
</intended_outcome>

<original_script>
${originalScript}
</original_script>

<modified_script>
${modifiedScript}
</modified_script>

<rubric>
${rubricLines}
</rubric>

Grade the modified script against each rubric criterion.`;
}

/**
 * Grades one rewrite.
 *
 * Structured outputs constrain the response to the rubric schema, so there is no
 * JSON parsing, no regex extraction and no retry-on-malformed-output loop — the
 * shape is guaranteed by the API rather than hoped for.
 */
export async function judge(input) {
  const startedAt = Date.now();
  const response = await client.messages.parse({
    model: config.judgeModel,
    max_tokens: 8_000,
    system: SYSTEM_PROMPT,
    output_config: {
      effort: config.judgeEffort,
      format: zodOutputFormat(JudgementSchema),
    },
    messages: [
      {
        role: 'user',
        content: buildUserMessage(input),
      },
    ],
  });
  if (response.stop_reason === 'refusal') {
    throw new Error(
      `The judge declined to grade "${input.testPrompt.id}" ` +
        `(category: ${response.stop_details?.category ?? 'unknown'}). ` +
        'This is a judge-side outcome, not a Trupeer defect — treat it as an ungraded result.',
    );
  }
  if (!response.parsed_output) {
    throw new Error(
      `The judge returned no parseable verdict for "${input.testPrompt.id}" ` +
        `(stop_reason: ${response.stop_reason}). If this is max_tokens, raise max_tokens.`,
    );
  }
  return {
    judgement: response.parsed_output,
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    },
    latencyMs: Date.now() - startedAt,
  };
}
