import fs from 'node:fs';
import path from 'node:path';
import { chromium, firefox, webkit } from '@playwright/test';
import { config } from '../config.js';
// Reuse Part 2's config and page objects rather than reimplementing the flows.
import { env as part2Env } from '../../../part2/src/config/env.js';
import { DashboardPage } from '../../../part2/src/pages/DashboardPage.js';
import { LoginPage } from '../../../part2/src/pages/LoginPage.js';

/**
 * One browser session for a whole run. It keeps rolling buffers of console and
 * network activity, and hands out a fresh evidence bundle per check. Those
 * bundles are exactly what the ledger stores and later diffs, so evidence
 * capture is not a bolt-on: it is the reason the browser is driven at all.
 *
 * A Playwright trace covers the whole run, so any check can be replayed
 * step-by-step in the Playwright trace viewer after the fact.
 */
export class BrowserSession {
  browser;
  context;
  page;
  console = [];
  network = [];
  captureStart = 0;
  constructor(runDir, browserName = 'chromium') {
    this.runDir = runDir;
    this.browserName = browserName;
  }
  async start() {
    if (!fs.existsSync(part2Env.storageStatePath)) {
      throw new Error(
        `No saved Trupeer session at ${part2Env.storageStatePath}. ` +
          'Run `npm run auth` in part2/ first.',
      );
    }
    const engines = {
      chromium,
      firefox,
      webkit,
    };
    this.browser = await engines[this.browserName].launch({
      headless: !config.headed,
    });
    this.context = await this.browser.newContext({
      storageState: part2Env.storageStatePath,
      viewport: {
        width: 1600,
        height: 900,
      },
    });
    await this.context.tracing.start({
      screenshots: true,
      snapshots: true,
    });
    this.page = await this.context.newPage();
    this.page.on('console', (msg) => {
      if (msg.type() === 'error' || msg.type() === 'warning') {
        this.console.push({
          type: msg.type(),
          text: msg.text(),
        });
      }
    });
    // pageerror catches uncaught exceptions the console listener can miss.
    this.page.on('pageerror', (err) => {
      this.console.push({
        type: 'error',
        text: err.message,
      });
    });
    this.page.on('response', (res) => {
      const req = res.request();
      // Only record document/xhr/fetch; static asset noise is not useful here.
      if (['document', 'xhr', 'fetch'].includes(req.resourceType())) {
        this.network.push({
          url: res.url(),
          method: req.method(),
          status: res.status(),
        });
      }
    });
  }

  /** Confirms the saved session is still authenticated. */
  async assertSignedIn() {
    const dashboard = new DashboardPage(this.page);
    await dashboard.open();
    const login = new LoginPage(this.page);
    if (await login.isDisplayed(3_000)) {
      throw new Error(
        'The saved Trupeer session has expired. Re-run `npm run auth` in part2/.',
      );
    }
  }
  async openEditor() {
    const dashboard = new DashboardPage(this.page);
    await dashboard.open();
    return dashboard.openVideo(part2Env.videoName || undefined);
  }

  /** Reset the rolling buffers so the next check's evidence is isolated. */
  beginCapture() {
    this.console = [];
    this.network = [];
    this.captureStart = Date.now();
  }

  /**
   * Snapshot the current evidence: a screenshot (saved and inlined), the console
   * and network captured since beginCapture, DOM presence for the given
   * selectors, and elapsed time.
   */
  async snapshotEvidence(checkId, domSelectors = []) {
    const shotsDir = path.join(this.runDir, 'screenshots');
    fs.mkdirSync(shotsDir, {
      recursive: true,
    });
    const shotFile = path.join(shotsDir, `${checkId}.png`);
    let screenshotDataUri;
    try {
      const buffer = await this.page.screenshot({
        path: shotFile,
      });
      screenshotDataUri = `data:image/png;base64,${buffer.toString('base64')}`;
    } catch {
      /* screenshot can fail if the page is navigating; evidence is still useful */
    }
    const domPresence = {};
    for (const selector of domSelectors) {
      domPresence[selector] = (await this.page.locator(selector).count()) > 0;
    }
    return {
      screenshotPath: path.relative(this.runDir, shotFile),
      screenshotDataUri,
      consoleErrors: [...this.console],
      networkEvents: [...this.network],
      domPresence: domSelectors.length > 0 ? domPresence : undefined,
      timingMs: Date.now() - this.captureStart,
    };
  }
  async stop() {
    let tracePath;
    if (this.context) {
      tracePath = path.join(this.runDir, 'trace.zip');
      await this.context.tracing.stop({
        path: tracePath,
      });
    }
    await this.browser?.close();
    return tracePath;
  }
}
