import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';
/**
 * The strong-model provider (Claude). Used for judgment that must be right:
 * regression root-cause, fix intent, and, when no cheap vision model is
 * configured, layout description as a fallback.
 */
export class ClaudeProvider {
  client;
  model = config.strongModel;
  constructor(apiKey) {
    this.client = new Anthropic({
      apiKey,
    });
  }

  /** A structured JSON call. Returns the raw text plus token usage. */
  async structured(system, user, schema) {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 4_000,
      system,
      output_config: {
        format: {
          type: 'json_schema',
          schema,
        },
      },
      messages: [
        {
          role: 'user',
          content: user,
        },
      ],
    });
    if (response.stop_reason === 'refusal') {
      throw new Error('The strong model declined this request.');
    }
    const text = response.content.find((b) => b.type === 'text');
    return {
      text: text && 'text' in text ? text.text : '{}',
      spend: {
        input: response.usage.input_tokens,
        output: response.usage.output_tokens,
      },
    };
  }

  /** Vision fallback: describe a screenshot when no cheap model is available. */
  async describeScreenshot(imageBase64, mediaType) {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 1_500,
      output_config: {
        format: {
          type: 'json_schema',
          schema: LAYOUT_SCHEMA,
        },
      },
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mediaType,
                data: imageBase64,
              },
            },
            {
              type: 'text',
              text: LAYOUT_PROMPT,
            },
          ],
        },
      ],
    });
    const text = response.content.find((b) => b.type === 'text');
    const verdict = JSON.parse(text && 'text' in text ? text.text : '{}');
    return {
      verdict,
      spend: {
        input: response.usage.input_tokens,
        output: response.usage.output_tokens,
      },
    };
  }
}
export const LAYOUT_PROMPT =
  'You are inspecting a screenshot of a web application for layout defects only. ' +
  'Report concrete visual problems a user would notice: text that is clipped or ' +
  'overlapping, controls pushed off screen, broken or missing images, elements ' +
  'overlapping each other, or content that overflows its container. Do not comment ' +
  'on aesthetics, colour choices, or content. If the layout is sound, say so.';
export const LAYOUT_SCHEMA = {
  type: 'object',
  properties: {
    ok: {
      type: 'boolean',
      description: 'True if no layout defects are visible.',
    },
    issues: {
      type: 'array',
      items: {
        type: 'string',
      },
      description: 'One concrete visual defect per item. Empty if ok.',
    },
    severity: {
      type: 'string',
      enum: ['none', 'low', 'medium', 'high'],
    },
    summary: {
      type: 'string',
    },
  },
  required: ['ok', 'issues', 'severity', 'summary'],
  additionalProperties: false,
};
