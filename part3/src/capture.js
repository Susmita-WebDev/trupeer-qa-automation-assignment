import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { config } from './config.js';
// Part 3 reuses Part 2's page objects rather than reimplementing the flows.
import { env } from '../../part2/src/config/env.js';
import { DashboardPage } from '../../part2/src/pages/DashboardPage.js';
import { LoginPage } from '../../part2/src/pages/LoginPage.js';

/**
 * Drives Trupeer through Playwright and captures script rewrites.
 *
 * Each prompt is graded against the SAME pristine script. Before every prompt the
 * session discards any pending change and reloads, resetting the editor to the
 * original transcript. That makes each prompt an independent, fair test of "did
 * this instruction produce a good rewrite of the original?", rather than grading
 * a script that has drifted through earlier edits.
 */
export class TrupeerSession {
  browser;
  context;
  page;
  editor;

  /** The script as it was before the run touched anything. */
  pristineScript = '';

  async start() {
    fs.mkdirSync(path.dirname(env.storageStatePath), { recursive: true });
    await this.#ensureSession();

    this.browser = await chromium.launch({ headless: !config.headed });
    this.context = await this.browser.newContext({
      baseURL: env.baseURL,
      storageState: env.storageStatePath,
      viewport: { width: 1600, height: 900 },
    });
    this.page = await this.context.newPage();

    const dashboard = new DashboardPage(this.page);
    await dashboard.open();
    this.editor = await dashboard.openVideo(env.videoName || undefined);

    this.pristineScript = await this.editor.getScriptText();
    if (this.pristineScript.length < 20) {
      throw new Error(
        'The script panel is empty or nearly empty. Part 3 needs a video with a ' +
          'generated transcript - re-record with the microphone enabled.',
      );
    }

    fs.mkdirSync(config.screenshotsDir, { recursive: true });
    await this.#screenshot('_baseline');
  }

  /**
   * Runs one prompt against the pristine script and returns the before/after
   * pair plus a screenshot of the editor showing the AI result. `id` names the
   * screenshot file so the report can link to it.
   */
  async runPrompt(prompt, id) {
    if (!this.editor || !this.page) {
      throw new Error('TrupeerSession.start() must be called before runPrompt().');
    }

    // Reset to the original script: discard any pending change from the previous
    // prompt, then reload so no stale dialog or in-flight request leaks in.
    if (await this.editor.discardChangesButton.isVisible(2_000)) {
      await (await this.editor.discardChangesButton.visible()).click();
    }
    await this.page.reload({ waitUntil: 'domcontentloaded' });
    await this.editor.waitForLoaded();

    const result = await this.editor.modifyScriptWithAi(prompt);
    // The rewrite is on screen now, with Keep/Discard still pending - capture it
    // as evidence before the next prompt resets the editor.
    const screenshotPath = await this.#screenshot(id);
    return {
      original: result.original,
      modified: result.modified,
      durationMs: result.durationMs,
      screenshotPath,
    };
  }

  /** Saves a viewport screenshot into results/screenshots and returns its path. */
  async #screenshot(id) {
    const file = path.join(config.screenshotsDir, `${id}.png`);
    try {
      await this.page.screenshot({ path: file });
      return file;
    } catch {
      // A screenshot is evidence, not the test - never let it fail the run.
      return null;
    }
  }

  async stop() {
    await this.browser?.close();
  }

  // --- Auth -----------------------------------------------------------------
  // Mirrors Part 2's setup: reuse a valid saved session, else log in (headed,
  // because Trupeer blocks headless sign-in) when password credentials exist.

  async #ensureSession() {
    if (fs.existsSync(env.storageStatePath) && (await this.#savedSessionWorks())) return;

    if (env.authMode !== 'password') {
      throw new Error(
        `No valid Trupeer session and AUTH_MODE is "${env.authMode}". Run ` +
          '`npm run auth` in part2/ first, or set AUTH_MODE=password with ' +
          'TRUPEER_EMAIL / TRUPEER_PASSWORD in the repo-root .env.',
      );
    }

    const browser = await chromium.launch({ headless: false });
    try {
      const context = await browser.newContext({
        baseURL: env.baseURL,
        viewport: { width: 1600, height: 900 },
      });
      const page = await context.newPage();
      const login = new LoginPage(page);
      await login.open();
      await login.signIn(env.email, env.password);
      await new DashboardPage(page).waitForAppReady();
      if (await login.isDisplayed(4_000)) {
        throw new Error('Sign-in failed - check TRUPEER_EMAIL / TRUPEER_PASSWORD.');
      }
      await context.storageState({ path: env.storageStatePath });
    } finally {
      await browser.close();
    }
  }

  async #savedSessionWorks() {
    const browser = await chromium.launch();
    try {
      const context = await browser.newContext({
        baseURL: env.baseURL,
        storageState: env.storageStatePath,
      });
      const page = await context.newPage();
      await new DashboardPage(page).open();
      return !(await new LoginPage(page).isDisplayed(4_000));
    } catch {
      return false;
    } finally {
      await browser.close();
    }
  }
}
