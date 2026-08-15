/**
 * One-time sign-in, saved to disk for every later run.
 *
 * AUTH_MODE=password — fills the sign-in form from TRUPEER_EMAIL / TRUPEER_PASSWORD.
 * AUTH_MODE=manual   — opens a visible browser and waits for you to sign in by
 *                      hand. Use this when the account is behind Google SSO, a
 *                      magic link, or an OTP, none of which can be driven
 *                      reliably (or legitimately) from a test.
 *
 * Either way the resulting cookies and local storage land in
 * STORAGE_STATE_PATH, which is gitignored.
 *
 *   npm run auth
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { chromium } from '@playwright/test';
import { env } from '../src/config/env.js';
import { LoginPage } from '../src/pages/LoginPage.js';
import { DashboardPage } from '../src/pages/DashboardPage.js';
async function main() {
  const browser = await chromium.launch({
    headless: false,
  });
  const context = await browser.newContext({
    viewport: {
      width: 1600,
      height: 900,
    },
  });
  const page = await context.newPage();
  const login = new LoginPage(page);
  const dashboard = new DashboardPage(page);
  await page.goto(env.baseURL, {
    waitUntil: 'domcontentloaded',
  });
  if (env.authMode === 'password') {
    console.log('[auth] Signing in with email and password...');
    await login.signIn(env.email, env.password);
  } else {
    console.log(
      '\n[auth] Manual mode.\n' +
        '       1. Sign in to Trupeer in the browser window that just opened.\n' +
        '       2. Wait until the dashboard has fully loaded.\n' +
        '       3. Come back here and press Enter.\n',
    );
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    await rl.question('Press Enter once you are signed in and on the dashboard... ');
    rl.close();
  }
  await dashboard.waitForAppReady();
  if (await login.isDisplayed(3_000)) {
    await browser.close();
    throw new Error(
      'Still on the login screen — the session was not captured. ' +
        'Check the credentials, or re-run with AUTH_MODE=manual.',
    );
  }
  fs.mkdirSync(path.dirname(env.storageStatePath), {
    recursive: true,
  });
  await context.storageState({
    path: env.storageStatePath,
  });
  const videos = await dashboard.videoCount();
  console.log(`\n[auth] Session saved to ${env.storageStatePath}`);
  console.log(`[auth] Videos visible on the dashboard: ${videos}`);
  if (videos === 0) {
    console.warn(
      '[auth] No videos found. Parts 2 and 3 both need one recorded video ' +
        'with a generated script — record one before running the suite.',
    );
  }
  await browser.close();
}
main().catch((error) => {
  console.error('\n[auth] Failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
