import fs from 'node:fs';
import { defineConfig, devices } from '@playwright/test';
import { env } from './src/config/env.js';

export default defineConfig({
  testDir: './tests',
  outputDir: './test-results',

  // Trupeer's editor and its AI calls are slow; a 30s default would fail
  // honest tests. Individual waits are still explicit and bounded.
  timeout: 3 * 60 * 1000,
  expect: { timeout: 20 * 1000 },

  fullyParallel: false, // One shared account, one video, so serial avoids collisions.
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  forbidOnly: !!process.env.CI,

  reporter: [
    ['list'],
    // Auto-open the HTML report in the browser when the run finishes, so a
    // reviewer sees results without having to run `show-report`. Suppressed on
    // CI (no browser there); set PWTEST_OPEN=never to opt out locally too.
    [
      'html',
      {
        open: process.env.CI || process.env.PWTEST_OPEN === 'never' ? 'never' : 'always',
        outputFolder: 'playwright-report',
      },
    ],
    ['json', { outputFile: 'test-results/results.json' }],
  ],

  use: {
    baseURL: env.baseURL,
    headless: !env.headed,
    actionTimeout: 20 * 1000,
    navigationTimeout: 45 * 1000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    viewport: { width: 1600, height: 900 },
  },

  projects: [
    // Runs first: signs in (or verifies the saved session) and writes the
    // storage state that the test project below reuses. This is what lets
    // `npx playwright test` work as a single command.
    { name: 'setup', testMatch: /auth\.setup\.js/ },
    {
      name: 'chromium',
      testIgnore: /auth\.setup\.js/,
      dependencies: ['setup'],
      use: {
        ...devices['Desktop Chrome'],
        storageState: env.storageStatePath,
      },
    },
  ],
});

if (env.authMode !== 'password' && !fs.existsSync(env.storageStatePath)) {
  console.warn(
    `\n[setup] AUTH_MODE=${env.authMode} and no saved session at ${env.storageStatePath}.\n` +
      `        Run \`npm run auth\` once, or set AUTH_MODE=password with credentials in .env.\n` +
      `        See part2/README.md → Authentication.\n`,
  );
}
