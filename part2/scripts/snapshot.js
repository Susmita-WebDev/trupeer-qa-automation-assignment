/**
 * Captures the real rendered DOM of Trupeer's key pages so the selectors can be
 * written against the actual markup instead of guesses. For each page it saves:
 *
 *   - <page>.html          the full rendered HTML (post-JavaScript)
 *   - <page>.elements.json a clean inventory of every interactive element
 *                          (buttons, inputs, tabs, links) with role, test id,
 *                          aria-label, placeholder, text and classes
 *   - <page>.png           a full-page screenshot
 *
 * Everything lands in part2/.snapshots/ (gitignored). Run it once against the
 * live site; the person tuning the selectors then reads those files.
 *
 *   npm run auth        (once, to sign in)
 *   npm run snapshot
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { env, PROJECT_ROOT } from '../src/config/env.js';
import { DashboardPage } from '../src/pages/DashboardPage.js';

const OUT = path.join(PROJECT_ROOT, '.snapshots');

/** The list of interactive elements on the page, as a selector-writing aid. */
async function inventory(page) {
  return page.evaluate(() => {
    const selector =
      'button, a, input, textarea, select, [role="tab"], [role="button"], [role="textbox"], [contenteditable="true"]';
    const seen = [];
    for (const el of document.querySelectorAll(selector)) {
      const text = (el.innerText || el.value || '').replace(/\s+/g, ' ').trim();
      seen.push({
        tag: el.tagName.toLowerCase(),
        role: el.getAttribute('role') || '',
        type: el.getAttribute('type') || '',
        testid:
          el.getAttribute('data-testid') || el.getAttribute('data-test') || '',
        ariaLabel: el.getAttribute('aria-label') || '',
        placeholder: el.getAttribute('placeholder') || '',
        name: el.getAttribute('name') || '',
        text: text.slice(0, 80),
        classes: (el.className?.toString() || '').slice(0, 100),
      });
    }
    return seen;
  });
}

async function capture(page, name) {
  fs.mkdirSync(OUT, { recursive: true });
  await fs.promises.writeFile(path.join(OUT, `${name}.html`), await page.content(), 'utf8');
  await fs.promises.writeFile(
    path.join(OUT, `${name}.elements.json`),
    JSON.stringify(await inventory(page), null, 2),
    'utf8',
  );
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true }).catch(() => {});
  console.log(`  saved ${name}.html / .elements.json / .png`);
}

async function main() {
  const browser = await chromium.launch({ headless: !env.headed });

  // 1. Login page - no session needed, so I can write the real login flow.
  console.log('Capturing the login page (no session)...');
  const anon = await browser.newContext({
    baseURL: env.baseURL,
    viewport: { width: 1600, height: 900 },
  });
  const anonPage = await anon.newPage();
  await anonPage.goto(`${env.baseURL}/auth?tab=login`, { waitUntil: 'domcontentloaded' });
  await anonPage.waitForTimeout(2500);
  await capture(anonPage, 'login');
  await anon.close();

  // 2. Dashboard and editor - need the saved session.
  if (!fs.existsSync(env.storageStatePath)) {
    console.warn(
      `\nNo saved session at ${env.storageStatePath}, so dashboard/editor were skipped.\n` +
        'Run `npm run auth` first, then re-run `npm run snapshot`.',
    );
    await browser.close();
    return;
  }

  const context = await browser.newContext({
    baseURL: env.baseURL,
    storageState: env.storageStatePath,
    viewport: { width: 1600, height: 900 },
  });
  const page = await context.newPage();
  const dashboard = new DashboardPage(page);

  console.log('Capturing the dashboard...');
  await dashboard.open();
  await capture(page, 'dashboard');

  // Opening the editor uses the current (guessed) selectors, so it may fail.
  // Each step is isolated so a miss never loses the snapshots already taken.
  try {
    console.log('Opening a video and capturing the editor...');
    const editor = await dashboard.openVideo(env.videoName || undefined);
    await page.waitForTimeout(2500);
    await capture(page, 'editor');

    // Capture the "one other feature" candidate tabs.
    for (const tabName of ['Zooms', 'Visuals']) {
      try {
        console.log(`Capturing the ${tabName} tab...`);
        await editor.tab(tabName).click();
        await page.waitForTimeout(1500);
        await capture(page, `tab-${tabName.toLowerCase()}`);
      } catch {
        console.log(`  could not open the ${tabName} tab (that is fine).`);
      }
    }
    try {
      await editor.scriptTab.click();
      await page.waitForTimeout(800);
    } catch {
      /* back to Script */
    }

    console.log('Trying to open the Modify Script with AI dialog...');
    try {
      await editor.openModifyScriptDialog();
      await page.waitForTimeout(1500);
      await capture(page, 'ai-dialog');
    } catch {
      console.log('  could not open the AI dialog with current selectors (that is fine).');
    }
  } catch (error) {
    console.log(
      `  could not open a video with current selectors (that is fine): ` +
        `${error instanceof Error ? error.message : error}`,
    );
    console.log('  the dashboard snapshot is enough to fix the "open video" selector.');
  }

  await browser.close();
  console.log(`\nDone. Snapshots are in ${OUT}`);
  console.log('Share that this ran, and the selectors can be finalised from these files.');
}

main().catch((error) => {
  console.error('\n[snapshot] Failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
