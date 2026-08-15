import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { GoogleGenAI } from '@google/genai';
import { config } from './config.js';
import { CRITERIA, CRITERION_KEYS, JudgementSchema } from './rubric.js';
const SYSTEM_PROMPT = `You evaluate the output of an AI script-rewriting feature in a video editing product.

You are given three things: the original video script, the instruction a user gave, and the script the feature produced. Grade the produced script against the rubric.

How to grade:

- Judge the output against the user's stated intent, not against your own preferences. If the user asked for something you consider a bad idea, a faithful execution of it still passes.
- Grade each criterion independently. A script can follow the instruction perfectly while losing information, or preserve everything while ignoring the instruction. Do not let one verdict pull the others along.
- Cite evidence for every verdict, including the ones that pass. Quote from the modified script where you can.
- Be honest about uncertainty. Confidence below 0.75 means "a human should look at this". Borderline calls are common and useful; a judge that reports 0.95 on everything is worthless, because it can no longer flag anything for review.
- The scripts come from a real screen recording, so the original may contain speech-recognition artifacts, filler words, and false starts. Do not penalise the rewrite for cleaning those up - that is an improvement, not information loss.`;
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
 * Grades one rewrite. Tries each configured provider in order and returns the
 * first that succeeds, so the run survives one provider being unavailable (e.g.
 * the anthropic provider out of credits -> fall back to Gemini). The rubric, scoring, and report
 * are provider-agnostic; only the model call differs.
 */
export async function judge(input) {
  const providers = config.judgeProviders;
  if (providers.length === 0) {
    throw new Error(
      'No judge API key is set. Add a free GEMINI_API_KEY ' +
        '(https://aistudio.google.com/app/apikey) or an ANTHROPIC_API_KEY to part3/.env.',
    );
  }

  const errors = [];
  for (let i = 0; i < providers.length; i++) {
    const provider = providers[i];
    try {
      const result =
        provider === 'gemini'
          ? await judgeWithGemini(input)
          : await judgeWithAnthropic(input);
      if (i > 0) {
        console.warn(`  [judge] ${providers[0]} failed; fell back to ${provider}.`);
      }
      return { ...result, provider };
    } catch (error) {
      errors.push(`${provider}: ${error instanceof Error ? error.message : error}`);
    }
  }

  throw new Error(
    `All judge providers failed for "${input.testPrompt.id}": ${errors.join(' | ')}`,
  );
}

// --- Anthropic ------------------------------------------------------------
// Structured outputs constrain the response to the rubric schema, so there is no
// JSON parsing or retry-on-malformed-output loop - the shape is guaranteed.

async function judgeWithAnthropic(input) {
  const client = new Anthropic({ apiKey: config.anthropicApiKey });
  const startedAt = Date.now();
  const response = await client.messages.parse({
    model: config.judgeModel,
    max_tokens: 8_000,
    system: SYSTEM_PROMPT,
    output_config: {
      effort: config.judgeEffort,
      format: zodOutputFormat(JudgementSchema),
    },
    messages: [{ role: 'user', content: buildUserMessage(input) }],
  });
  if (response.stop_reason === 'refusal') {
    throw new Error(
      `The judge declined to grade "${input.testPrompt.id}" ` +
        `(category: ${response.stop_details?.category ?? 'unknown'}).`,
    );
  }
  if (!response.parsed_output) {
    throw new Error(
      `The judge returned no parseable verdict for "${input.testPrompt.id}" ` +
        `(stop_reason: ${response.stop_reason}).`,
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

// --- Gemini (free tier) ----------------------------------------------------
// Gemini constrains output with a JSON schema (responseJsonSchema); the result
// is then validated against the same Zod rubric, so a malformed verdict fails
// loudly rather than silently producing a wrong score.

const CRITERION_JSON_SCHEMA = {
  type: 'object',
  properties: {
    passed: { type: 'boolean' },
    confidence: { type: 'number' },
    evidence: { type: 'string' },
    reasoning: { type: 'string' },
  },
  required: ['passed', 'confidence', 'evidence', 'reasoning'],
};
const GEMINI_JSON_SCHEMA = {
  type: 'object',
  properties: {
    ...Object.fromEntries(CRITERION_KEYS.map((key) => [key, CRITERION_JSON_SCHEMA])),
    overallAssessment: { type: 'string' },
  },
  required: [...CRITERION_KEYS, 'overallAssessment'],
};

async function judgeWithGemini(input) {
  const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });
  const startedAt = Date.now();
  const response = await ai.models.generateContent({
    model: config.geminiModel,
    contents: [{ role: 'user', parts: [{ text: buildUserMessage(input) }] }],
    config: {
      systemInstruction: SYSTEM_PROMPT,
      responseMimeType: 'application/json',
      responseJsonSchema: GEMINI_JSON_SCHEMA,
    },
  });

  const raw = response.text ?? '';
  let judgement;
  try {
    judgement = JudgementSchema.parse(JSON.parse(raw));
  } catch (error) {
    throw new Error(
      `The Gemini judge returned output that did not match the rubric schema for ` +
        `"${input.testPrompt.id}": ${error instanceof Error ? error.message : error}`,
    );
  }

  const usage = response.usageMetadata;
  return {
    judgement,
    usage: {
      inputTokens: usage?.promptTokenCount ?? 0,
      outputTokens: usage?.candidatesTokenCount ?? 0,
    },
    latencyMs: Date.now() - startedAt,
  };
}
