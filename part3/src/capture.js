import fs from 'node:fs';
import { chromium } from '@playwright/test';
import { config } from './config.js';
// Part 3 reuses Part 2's page objects rather than reimplementing the flows.
import { env } from '../../part2/src/config/env.js';
import { DashboardPage } from '../../part2/src/pages/DashboardPage.js';
import { LoginPage } from '../../part2/src/pages/LoginPage.js';
/**
 * Drives Trupeer through Playwright and captures script rewrites.
 *
 * A note on baselines: Trupeer edits the script in place, and the free tier does
 * not expose a reliable "revert to original" control. So each prompt is graded
 * against the script *as it stood immediately before that prompt*, not against
 * the very first version. That is the honest comparison — the judge is asked
 * "did this edit do what was asked?", and chaining edits does not invalidate
 * that question. The true original is still recorded in the report so a human
 * can see how far the script drifted over the run.
 */
export class TrupeerSession {
  browser;
  page;
  editor;

  /** The script as it was before the run touched anything. */
  pristineScript = '';
  async start() {
    if (!fs.existsSync(env.storageStatePath)) {
      throw new Error(
        `No saved Trupeer session at ${env.storageStatePath}.\n` +
          'Run `npm run auth` in part2/ first — see part2/README.md → Authentication.',
      );
    }
    this.browser = await chromium.launch({
      headless: !config.headed,
    });
    const context = await this.browser.newContext({
      storageState: env.storageStatePath,
      viewport: {
        width: 1600,
        height: 900,
      },
    });
    this.page = await context.newPage();
    const dashboard = new DashboardPage(this.page);
    await dashboard.open();
    const login = new LoginPage(this.page);
    if (await login.isDisplayed(3_000)) {
      throw new Error(
        'The saved Trupeer session has expired — re-run `npm run auth` in part2/.',
      );
    }
    this.editor = await dashboard.openVideo(env.videoName || undefined);
    this.pristineScript = await this.editor.getScriptText();
    if (this.pristineScript.length < 20) {
      throw new Error(
        'The script panel is empty or nearly empty. Part 3 needs a video with a ' +
          'generated transcript — re-record with the microphone enabled.',
      );
    }
  }

  /** Runs one prompt and returns the before/after pair. */
  async runPrompt(prompt) {
    if (!this.editor || !this.page) {
      throw new Error('TrupeerSession.start() must be called before runPrompt().');
    }

    // Reload between prompts so each starts from a clean editor state — a stale
    // dialog or in-flight request from the previous prompt would otherwise leak
    // into this one and produce a result nobody can interpret.
    await this.page.reload({
      waitUntil: 'domcontentloaded',
    });
    await this.editor.waitForLoaded();
    const result = await this.editor.modifyScriptWithAi(prompt);
    return {
      original: result.original,
      modified: result.modified,
      durationMs: result.durationMs,
    };
  }
  async stop() {
    await this.browser?.close();
  }
}
