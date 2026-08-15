import { BasePage } from './BasePage.js';
import { env } from '../config/env.js';
/** The video edit page: timeline, preview player, script panel, AI tooling. */
export class EditorPage extends BasePage {
  constructor(page) {
    super(page);
  }

  // --- Core layout ----------------------------------------------------------

  timeline = this.flexible('timeline', [
    (p) => p.locator('[class*="timeline" i]'),
    (p) => p.getByRole('region', { name: /timeline/i }),
  ]);
  preview = this.flexible('preview player', [
    (p) => p.locator('canvas[data-engine]'), // Trupeer renders the preview with three.js
    (p) => p.locator('canvas').first(),
    (p) => p.locator('video'),
  ]);
  scriptPanel = this.flexible('script panel', [
    (p) => p.locator('[class*="slateEditor" i]').first(),
    (p) => p.locator('[class*="script" i]').first(),
  ]);
  /** All editable script paragraphs (Trupeer renders a Slate editor per line). */
  scriptLines() {
    return this.page.locator('[class*="slateEditor" i]');
  }
  // The play control is an unlabelled icon; the mute button and seek slider are
  // the reliably-labelled playback controls to assert on.
  playButton = this.flexible('playback controls', [
    (p) => p.getByRole('button', { name: /mute audio|unmute/i }),
    (p) => p.locator('input[type="range"]'),
    (p) => p.getByRole('button', { name: /play|pause/i }),
  ]);

  // Editor tabs are role="tab": Script, AI Voice, Music, Visuals, Zooms, AI Avatar, Elements.
  tab(name) {
    return this.flexible(`${name} tab`, [
      (p) => p.getByRole('tab', { name, exact: true }),
      (p) => p.getByRole('button', { name, exact: true }),
    ]);
  }
  scriptTab = this.tab('Script');
  zoomsTab = this.tab('Zooms');
  visualsTab = this.tab('Visuals');

  // --- Modify Script with AI ------------------------------------------------

  // The trigger is an unlabelled icon button in the script toolbar; anchored on
  // its sparkle SVG. (Its lack of an accessible name is itself an a11y nit.)
  modifyScriptButton = this.flexible('Rewrite with AI (sparkle) button', [
    (p) => p.locator('button:has(svg path[d^="M2.916 17.084"])'),
    (p) => p.locator('button:has(svg path[d^="m7.083 2.033"])'),
  ]);
  promptInput = this.flexible('AI prompt input', [
    (p) => p.getByPlaceholder(/make it more conversational|simplify the language|conversational/i),
    (p) => p.locator('textarea'),
    (p) => p.getByPlaceholder(/describe|prompt|instruction|change/i),
  ]);
  promptSubmitButton = this.flexible('AI prompt submit button', [
    (p) => p.getByRole('button', { name: /rewrite script/i }),
    (p) => p.getByRole('button', { name: /^(rewrite|generate|apply|submit|send)$/i }),
  ]);
  aiDialog = this.flexible('Rewrite with AI dialog', [
    (p) => p.getByRole('dialog'),
    (p) => p.getByText(/rewrite with ai/i),
    (p) => p.locator('[role="dialog"], [class*="modal" i], [class*="popover" i]'),
  ]);
  keepChangesButton = this.flexible('Keep changes button', [
    (p) => p.getByRole('button', { name: /keep changes/i }),
  ]);
  discardChangesButton = this.flexible('Discard changes button', [
    (p) => p.getByRole('button', { name: /discard changes/i }),
  ]);
  aiErrorMessage = this.flexible('AI error message', [
    (p) => p.getByRole('alert'),
    (p) => p.getByText(/error|failed|try again|rate limit|too long|required/i),
    (p) => p.locator('[class*="error" i], [class*="toast" i]'),
  ]);

  // --- Editor feature under test: the Zooms auto-zoom toggle ----------------
  // Chosen because a switch has an observable on/off state (aria-checked /
  // data-state), so "the change applied" can be asserted without pixel diffing.

  /** The auto-zoom switch on the Zooms tab. */
  zoomSwitch() {
    return this.page.getByRole('switch').first();
  }
  async switchState(locator) {
    return (
      (await locator.getAttribute('aria-checked')) ??
      (await locator.getAttribute('data-state')) ??
      ''
    );
  }

  // --- Behaviour ------------------------------------------------------------

  async waitForLoaded(timeout = 45_000) {
    await this.waitForAppReady(timeout);
    await this.scriptPanel.visible(timeout);
    // Trupeer's Slate editor mounts its container before filling in the text, so
    // wait until the script has actually hydrated with content before returning.
    // Otherwise a test can read an empty panel in the moment between the two.
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if ((await this.getScriptText().catch(() => '')).length > 20) return;
      await this.page.waitForTimeout(500);
    }
  }

  /** True when timeline, preview and script panel are all rendered. The timeline
   *  and the WebGL preview canvas are checked by DOM attachment rather than strict
   *  visibility, because Playwright's visibility heuristic is unreliable for a
   *  three.js canvas; being mounted is the real "the region rendered" signal. */
  async hasCoreRegions() {
    const attached = async (flex, timeout = 30_000) => {
      try {
        const locator = (await flex.resolve(timeout)).first();
        await locator.waitFor({ state: 'attached', timeout });
        return true;
      } catch {
        return false;
      }
    };
    return {
      timeline: await attached(this.timeline),
      preview: await attached(this.preview),
      script: await this.scriptPanel.isVisible(30_000),
    };
  }

  /** The full visible script text, whitespace-normalised. */
  async getScriptText() {
    // Trupeer renders each script paragraph as its own Slate editor, so join them.
    const lines = this.scriptLines();
    const count = await lines.count();
    if (count === 0) {
      const panel = await this.scriptPanel.visible();
      return (await panel.innerText()).replace(/\s+/g, ' ').trim();
    }
    const parts = [];
    for (let i = 0; i < count; i++) {
      parts.push((await lines.nth(i).innerText()).trim());
    }
    return parts.join(' ').replace(/\s+/g, ' ').trim();
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
   * Opens the Zooms tab and flips the auto-zoom switch, returning the state
   * before and after so the test can assert the toggle actually changed. Leaves
   * the switch back in its original position so the run has no lasting effect.
   */
  async toggleZoomSwitch() {
    await this.zoomsTab.click();
    const sw = this.zoomSwitch();
    await sw.waitFor({ state: 'visible', timeout: 20_000 });

    const before = await this.switchState(sw);
    await sw.click();
    await this.page.waitForTimeout(600);
    const after = await this.switchState(sw);

    // Restore the original state so we do not leave the video modified.
    if (after !== before) {
      await sw.click().catch(() => {});
    }
    return { before, after };
  }
}
