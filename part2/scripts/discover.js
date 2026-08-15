/**
 * Prints which page-object locators actually resolve against the live app.
 *
 * Every locator in this suite is a prioritised list of strategies. This script
 * opens the dashboard and the editor with the saved session and reports, per
 * element, whether it was found - so a selector that has drifted shows up as a
 * one-line diagnostic instead of a mid-suite failure.
 *
 *   npm run discover
 */
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import { env } from '../src/config/env.js';
import { DashboardPage } from '../src/pages/DashboardPage.js';
async function report(label, locator) {
  const found = await locator.isVisible(5_000);
  console.log(`  ${found ? 'OK  ' : 'MISS'}  ${label}`);
  return found;
}
async function main() {
  if (!fs.existsSync(env.storageStatePath)) {
    throw new Error(
      `No saved session at ${env.storageStatePath}. Run \`npm run auth\` first.`,
    );
  }
  const browser = await chromium.launch({
    headless: !env.headed,
  });
  const context = await browser.newContext({
    baseURL: env.baseURL,
    storageState: env.storageStatePath,
    viewport: {
      width: 1600,
      height: 900,
    },
  });
  const page = await context.newPage();
  const dashboard = new DashboardPage(page);
  await dashboard.open();
  console.log('\nDashboard');
  await report('heading', dashboard.heading);
  await report('account menu', dashboard.userMenu);
  await report('new recording button', dashboard.newRecordingButton);
  console.log(`  ${await dashboard.videoCount()} video card(s) matched`);
  const editor = await dashboard.openVideo(env.videoName || undefined);
  console.log('\nEditor');
  await report('timeline', editor.timeline);
  await report('preview player', editor.preview);
  await report('script panel', editor.scriptPanel);
  await report('play button', editor.playButton);
  await report('Modify Script with AI button', editor.modifyScriptButton);
  await report('background tab', editor.backgroundTab);
  const script = await editor.getScriptText().catch(() => '');
  console.log(`\n  Script length: ${script.length} characters`);
  console.log(
    `  Script preview: ${script.slice(0, 160)}${script.length > 160 ? '...' : ''}`,
  );
  if (await editor.modifyScriptButton.isVisible(3_000)) {
    console.log('\nModify Script with AI dialog');
    await editor.openModifyScriptDialog().catch(() => undefined);
    await report('prompt input', editor.promptInput);
    await report('submit button', editor.promptSubmitButton);
  }
  await page.screenshot({
    path: 'test-results/discover-editor.png',
    fullPage: true,
  });
  console.log('\nScreenshot written to test-results/discover-editor.png');
  console.log(
    'Any MISS above means that element needs a new candidate strategy in ' +
      'src/pages/ - inspect it in DevTools and add the selector to the list.\n',
  );
  await browser.close();
}
main().catch((error) => {
  console.error('\n[discover] Failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
