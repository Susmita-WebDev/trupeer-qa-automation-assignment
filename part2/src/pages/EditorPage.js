import { BasePage } from './BasePage.js';
import { env } from '../config/env.js';
/** The video edit page: timeline, preview player, script panel, AI tooling. */
export class EditorPage extends BasePage {
  constructor(page) {
    super(page);
  }

  // --- Core layout ----------------------------------------------------------

  timeline = this.flexible('timeline', [
    (p) => p.getByTestId(/timeline/i),
    (p) =>
      p.getByRole('region', {
        name: /timeline/i,
      }),
    (p) => p.locator('[class*="timeline" i]'),
    (p) => p.locator('[aria-label*="timeline" i]'),
  ]);
  preview = this.flexible('preview player', [
    (p) => p.getByTestId(/preview|player/i),
    (p) => p.locator('video'),
    (p) => p.locator('[class*="preview" i], [class*="player" i]'),
    (p) => p.locator('canvas'),
  ]);
  scriptPanel = this.flexible('script panel', [
    (p) => p.getByTestId(/script/i),
    (p) =>
      p.getByRole('region', {
        name: /script|transcript/i,
      }),
    (p) => p.locator('[class*="script" i], [class*="transcript" i]'),
  ]);
  playButton = this.flexible('play button', [
    (p) =>
      p.getByRole('button', {
        name: /^play$/i,
      }),
    (p) =>
      p.getByRole('button', {
        name: /play|preview/i,
      }),
    (p) => p.locator('[aria-label*="play" i]'),
  ]);

  // --- Modify Script with AI ------------------------------------------------

  modifyScriptButton = this.flexible('Modify Script with AI button', [
    (p) =>
      p.getByRole('button', {
        name: /modify script with ai/i,
      }),
    (p) =>
      p.getByRole('button', {
        name: /modify.*script|ai.*script|edit with ai/i,
      }),
    (p) => p.getByText(/modify script with ai/i),
  ]);
  promptInput = this.flexible('AI prompt input', [
    (p) =>
      p.getByRole('textbox', {
        name: /prompt|instruction|describe|ask/i,
      }),
    (p) => p.getByPlaceholder(/prompt|instruction|describe|make this|ask/i),
    (p) => p.locator('[role="dialog"] textarea'),
    (p) => p.locator('textarea').last(),
  ]);
  promptSubmitButton = this.flexible('AI prompt submit button', [
    (p) =>
      p.getByRole('button', {
        name: /^(generate|submit|apply|send|modify)$/i,
      }),
    (p) =>
      p.getByRole('button', {
        name: /generate|submit|apply|send/i,
      }),
    (p) => p.locator('[role="dialog"] button[type="submit"]'),
  ]);
  aiDialog = this.flexible('AI prompt dialog', [
    (p) => p.getByRole('dialog'),
    (p) => p.locator('[role="dialog"], [class*="modal" i], [class*="drawer" i]'),
  ]);
  aiErrorMessage = this.flexible('AI error message', [
    (p) => p.getByRole('alert'),
    (p) => p.getByText(/error|failed|try again|rate limit|too long|required/i),
    (p) => p.locator('[class*="error" i], [class*="toast" i]'),
  ]);

  // --- Editor feature under test: background --------------------------------

  backgroundTab = this.flexible('background tab', [
    (p) =>
      p.getByRole('tab', {
        name: /background/i,
      }),
    (p) =>
      p.getByRole('button', {
        name: /background/i,
      }),
    (p) => p.getByText(/^background$/i),
  ]);
  backgroundOptions() {
    return this.page.locator(
      [
        '[data-testid*="background" i] button',
        '[class*="background" i] button',
        '[class*="background" i] [role="option"]',
      ].join(', '),
    );
  }

  // --- Behaviour ------------------------------------------------------------

  async waitForLoaded(timeout = 45_000) {
    await this.waitForAppReady(timeout);
    // The script panel is the slowest of the three regions to hydrate, so
    // waiting on it implies the rest of the editor has rendered.
    await this.scriptPanel.visible(timeout);
  }

  /** True when timeline, preview and script panel are all on screen. */
  async hasCoreRegions() {
    return {
      timeline: await this.timeline.isVisible(15_000),
      preview: await this.preview.isVisible(15_000),
      script: await this.scriptPanel.isVisible(15_000),
    };
  }

  /** The full visible script text, whitespace-normalised. */
  async getScriptText() {
    const panel = await this.scriptPanel.visible();
    const text = await panel.innerText();
    return text.replace(/\s+/g, ' ').trim();
  }
  async openModifyScriptDialog() {
    await this.modifyScriptButton.click();
    await this.promptInput.visible(15_000);
  }
  async submitPrompt(prompt) {
    await this.promptInput.fill(prompt);
    await this.promptSubmitButton.click();
  }

  /**
   * Runs one "Modify Script with AI" round trip and returns before/after text.
   *
   * Completion is detected by polling the script panel until its text differs
   * from the baseline *and* has stopped changing for two consecutive polls.
   * The AI response may stream in token by token, and asserting on a
   * half-written script is the single most likely source of flake here.
   */
  async modifyScriptWithAi(prompt, timeout = env.aiResponseTimeoutMs) {
    const original = await this.getScriptText();
    const startedAt = Date.now();
    await this.openModifyScriptDialog();
    await this.submitPrompt(prompt);
    const modified = await this.waitForScriptToChange(original, timeout);
    return {
      original,
      modified,
      durationMs: Date.now() - startedAt,
    };
  }

  /**
   * Polls until the script text differs from `baseline` and has settled.
   * Throws with a diagnostic message on timeout so failures are actionable.
   */
  async waitForScriptToChange(baseline, timeout) {
    const pollMs = 1_000;
    const deadline = Date.now() + timeout;
    let previous = baseline;
    let stableReads = 0;
    while (Date.now() < deadline) {
      await this.page.waitForTimeout(pollMs);
      const current = await this.getScriptText().catch(() => previous);
      if (current !== baseline) {
        stableReads = current === previous ? stableReads + 1 : 0;
        if (stableReads >= 2) return current;
      }
      previous = current;
    }
    const visibleError = (await this.aiErrorMessage.isVisible(1_000))
      ? await this.aiErrorMessage.textContent()
      : '(no error message rendered)';
    throw new Error(
      `The script did not change within ${timeout}ms of submitting the prompt. ` +
        `UI error shown: ${visibleError}. ` +
        `If this is reproducible, it is a product bug, not a test bug - ` +
        `record it in part1/bugs.md.`,
    );
  }

  /**
   * Applies a background and reports whether the UI reflected the change.
   * Returns the option's accessible name so the test can assert on it.
   */
  async applyFirstBackground() {
    await this.backgroundTab.click();
    const options = this.backgroundOptions();
    await options.first().waitFor({
      state: 'visible',
      timeout: 20_000,
    });
    const option = options.first();
    const label =
      (await option.getAttribute('aria-label')) ??
      (await option.getAttribute('title')) ??
      (await option.innerText().catch(() => '')) ??
      '';
    await option.click();
    await this.waitForAppReady(20_000);
    return label.trim();
  }

  /** True when a background option reports itself as active/selected. */
  async hasSelectedBackground() {
    const selected = this.backgroundOptions().filter({
      has: this.page.locator('[aria-selected="true"], [data-selected="true"]'),
    });
    if ((await selected.count()) > 0) return true;
    const byAttribute = this.backgroundOptions().locator(
      '[aria-pressed="true"], [aria-selected="true"], [class*="selected" i], [class*="active" i]',
    );
    return (await byAttribute.count()) > 0;
  }
}
