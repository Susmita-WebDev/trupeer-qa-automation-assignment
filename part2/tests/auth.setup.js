import fs from 'node:fs';
import path from 'node:path';
import { test as setup, expect, chromium } from '@playwright/test';
import { env } from '../src/config/env.js';
import { LoginPage } from '../src/pages/LoginPage.js';
import { DashboardPage } from '../src/pages/DashboardPage.js';

/**
 * Authentication setup, run once before the test projects. This is what lets the
 * suite run with a single command: it produces the saved session every test
 * reuses.
 *
 * It is resilient by design:
 *
 * 1. If a saved session already exists and still works, it is reused (fast, and
 *    it honours a session captured by `npm run auth`).
 * 2. Otherwise, in `password` mode, it logs in through the sign-in form using
 *    TRUPEER_EMAIL / TRUPEER_PASSWORD. The login runs in a **headed** window on
 *    purpose: Trupeer blocks automated sign-in from a headless browser (a common
 *    bot-detection behaviour), so a real window is what makes it reliable.
 * 3. In `manual` mode (Google SSO / magic link), it requires a session captured
 *    once with `npm run auth`, and gives a clear message if there is not one.
 */

async function savedSessionWorks() {
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

setup('authenticate', async () => {
  fs.mkdirSync(path.dirname(env.storageStatePath), { recursive: true });

  if (fs.existsSync(env.storageStatePath) && (await savedSessionWorks())) {
    console.log('[setup] Reusing the existing saved session.');
    return;
  }

  if (env.authMode !== 'password') {
    throw new Error(
      `AUTH_MODE is "${env.authMode}" and there is no valid saved session. Run ` +
        `\`npm run auth\` once to sign in by hand, or set AUTH_MODE=password with ` +
        `TRUPEER_EMAIL / TRUPEER_PASSWORD in .env.`,
    );
  }

  // Headed on purpose: headless sign-in is blocked by Trupeer.
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

    expect(
      await login.isDisplayed(4_000),
      'Expected to reach the dashboard after signing in, but the login form is still ' +
        'showing. Check TRUPEER_EMAIL / TRUPEER_PASSWORD, or use AUTH_MODE=manual if the ' +
        'account is behind Google SSO.',
    ).toBe(false);

    await context.storageState({ path: env.storageStatePath });
    console.log(`[setup] Signed in and saved the session to ${env.storageStatePath}`);
  } finally {
    await browser.close();
  }
});
