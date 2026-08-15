import fs from 'node:fs';
import { defineConfig, devices } from '@playwright/test';
import { env } from './src/config/env.js';
const hasStoredSession = fs.existsSync(env.storageStatePath);
export default defineConfig({
  testDir: './tests',
  outputDir: './test-results',
  // Trupeer's editor and its AI calls are slow; a 30s default would fail
  // honest tests. Individual waits are still explicit and bounded.
  timeout: 3 * 60 * 1000,
  expect: {
    timeout: 20 * 1000,
  },
  fullyParallel: false,
  // One shared account, one video - serial avoids collisions.
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  forbidOnly: !!process.env.CI,
  reporter: [
    ['list'],
    [
      'html',
      {
        open: 'never',
        outputFolder: 'playwright-report',
      },
    ],
    [
      'json',
      {
        outputFile: 'test-results/results.json',
      },
    ],
  ],
  use: {
    baseURL: env.baseURL,
    headless: !env.headed,
    actionTimeout: 20 * 1000,
    navigationTimeout: 45 * 1000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    viewport: {
      width: 1600,
      height: 900,
    },
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Reuse the session captured by `npm run auth`. Without it the suite
        // still runs, but every test starts signed out and only the login
        // spec will pass - the console output says so explicitly.
        storageState: hasStoredSession ? env.storageStatePath : undefined,
      },
    },
  ],
});
if (!hasStoredSession) {
  console.warn(
    `\n[setup] No saved session at ${env.storageStatePath}.\n` +
      `        Run \`npm run auth\` first - see part2/README.md → Authentication.\n`,
  );
}
