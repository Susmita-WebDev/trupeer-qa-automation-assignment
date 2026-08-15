import { config, hasStrongModel, hasVisionModel } from '../config.js';
import { ClaudeProvider } from './claude.js';
import { GeminiProvider } from './gemini.js';
/**
 * Routes each task to the right model by cost and capability, and records what
 * it chose so the report can show the routing. The rule is simple: judgment goes
 * to the strong model, perception goes to the cheap one, and a missing key
 * downgrades gracefully rather than failing the run.
 */
export class ModelRouter {
  claude;
  gemini;
  routing = {};
  spend = {
    input: 0,
    output: 0,
  };
  constructor() {
    if (hasStrongModel()) this.claude = new ClaudeProvider(config.anthropicApiKey);
    if (hasVisionModel()) this.gemini = new GeminiProvider(config.geminiApiKey);
  }
  record(task, model) {
    this.routing[task] = model;
  }
  addSpend(spend) {
    this.spend.input += spend.input;
    this.spend.output += spend.output;
  }
  get strongAvailable() {
    return !!this.claude;
  }

  /** Judgment tasks: regression cause, fix intent, script rubric. */
  async structured(task, system, user, schema, parse) {
    if (!this.claude) {
      throw new Error(
        `Task "${task}" needs the strong model, but ANTHROPIC_API_KEY is not set.`,
      );
    }
    this.record(task, this.claude.model);
    const { text, spend } = await this.claude.structured(system, user, schema);
    this.addSpend(spend);
    return parse(text);
  }

  /**
   * Perception task. Prefers the cheap vision model; falls back to the strong
   * model when no vision key is configured, and records which one ran so the
   * cost tradeoff is visible in the report.
   */
  async describeScreenshot(task, imageBase64, mediaType = 'image/png') {
    if (this.gemini) {
      this.record(task, this.gemini.model);
      const { verdict, spend } = await this.gemini.describeScreenshot(
        imageBase64,
        mediaType,
      );
      this.addSpend(spend);
      return verdict;
    }
    if (this.claude) {
      this.record(task, `${this.claude.model} (vision fallback)`);
      const { verdict, spend } = await this.claude.describeScreenshot(
        imageBase64,
        mediaType,
      );
      this.addSpend(spend);
      return verdict;
    }
    // No model at all: skip rather than fail the run.
    this.record(task, 'skipped (no model key)');
    return {
      ok: true,
      issues: [],
      severity: 'none',
      summary: 'Skipped: no vision or strong model key configured.',
    };
  }
}
