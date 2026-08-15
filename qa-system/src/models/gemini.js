import { GoogleGenAI } from '@google/genai';
import { config } from '../config.js';
import { LAYOUT_PROMPT, LAYOUT_SCHEMA } from './claude.js';
/**
 * The cheap-vision provider (Gemini Flash). Vision here is perception, not deep
 * reasoning, and Flash is about 20x cheaper per image than a flagship, so
 * screenshot and layout work belongs here. Judgment stays on the strong model.
 */
export class GeminiProvider {
  ai;
  model = config.visionModel;
  constructor(apiKey) {
    this.ai = new GoogleGenAI({
      apiKey,
    });
  }
  async describeScreenshot(imageBase64, mediaType) {
    const response = await this.ai.models.generateContent({
      model: this.model,
      contents: [
        {
          role: 'user',
          parts: [
            {
              inlineData: {
                mimeType: mediaType,
                data: imageBase64,
              },
            },
            {
              text: LAYOUT_PROMPT,
            },
          ],
        },
      ],
      config: {
        responseMimeType: 'application/json',
        responseJsonSchema: LAYOUT_SCHEMA,
      },
    });
    const raw = response.text ?? '{}';
    const verdict = JSON.parse(raw);
    const usage = response.usageMetadata;
    return {
      verdict,
      spend: {
        input: usage?.promptTokenCount ?? 0,
        output: usage?.candidatesTokenCount ?? 0,
      },
    };
  }
}
