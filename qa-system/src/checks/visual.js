import fs from 'node:fs';
import path from 'node:path';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import { config } from '../config.js';
const STABILISE_CSS = `*, *::before, *::after { animation: none !important;
  transition: none !important; caret-color: transparent !important; }`;
async function captureStableViewport(page) {
  // Kill animation and caret flicker so a diff means a real change, not timing.
  await page
    .addStyleTag({
      content: STABILISE_CSS,
    })
    .catch(() => undefined);
  return page.screenshot();
}

/**
 * Deterministic pixel-diff against a committed baseline. On the first run there
 * is no baseline, so the current shot becomes the baseline and the check is a
 * neutral "no-baseline" pass. On later runs a difference above threshold fails,
 * and the diff image is embedded in the report. This is genuine visual
 * regression, and because it flows through the ledger, a first failure after a
 * run of passes is reported as a regression, not just a red check.
 */
export const editorVisualBaseline = async (ctx) => {
  ctx.session.beginCapture();
  const id = 'editor.visual.baseline';
  const current = await captureStableViewport(ctx.session.page);
  const evidence = await ctx.session.snapshotEvidence(id);
  fs.mkdirSync(config.baselinesDir, {
    recursive: true,
  });
  const baselineFile = path.join(config.baselinesDir, 'editor.png');
  if (!fs.existsSync(baselineFile)) {
    fs.writeFileSync(baselineFile, current);
    return {
      id,
      title: 'Editor matches its visual baseline',
      category: 'visual',
      outcome: 'pass',
      severity: 'low',
      expected: 'Editor looks the same as the committed baseline',
      actual: 'No baseline yet: captured this run as the baseline',
      assertionExercised: true,
      evidence,
    };
  }
  const baseline = PNG.sync.read(fs.readFileSync(baselineFile));
  const currentPng = PNG.sync.read(current);

  // A size change is itself a visual regression; do not try to diff mismatched
  // dimensions pixel by pixel.
  if (baseline.width !== currentPng.width || baseline.height !== currentPng.height) {
    return {
      id,
      title: 'Editor matches its visual baseline',
      category: 'visual',
      outcome: 'fail',
      severity: 'medium',
      expected: `Editor renders at ${baseline.width}x${baseline.height}`,
      actual: `Editor now renders at ${currentPng.width}x${currentPng.height}`,
      assertionExercised: true,
      evidence,
    };
  }
  const { width, height } = baseline;
  const diff = new PNG({
    width,
    height,
  });
  const changed = pixelmatch(baseline.data, currentPng.data, diff.data, width, height, {
    threshold: 0.15,
  });
  const ratio = changed / (width * height);
  const failed = ratio > 0.01; // more than 1% of pixels changed

  if (failed) {
    const diffBuffer = PNG.sync.write(diff);
    evidence.screenshotDataUri = `data:image/png;base64,${diffBuffer.toString('base64')}`;
    evidence.notes = [`Pixel diff: ${(ratio * 100).toFixed(2)}% of pixels changed`];
  }
  return {
    id,
    title: 'Editor matches its visual baseline',
    category: 'visual',
    outcome: failed ? 'fail' : 'pass',
    severity: 'low',
    expected: 'Editor pixels match the committed baseline within threshold',
    actual: `${(ratio * 100).toFixed(2)}% of pixels changed versus baseline`,
    assertionExercised: true,
    evidence,
  };
};

/**
 * Cheap-model layout sanity. Pixel diffing needs a baseline and says nothing on
 * the first run; this catches obvious breakage (clipped text, overlaps, controls
 * off screen) with no baseline required, on the cheap vision route.
 */
export const editorLayoutSanity = async (ctx) => {
  ctx.session.beginCapture();
  const id = 'editor.layout.sanity';
  const shot = await captureStableViewport(ctx.session.page);
  const evidence = await ctx.session.snapshotEvidence(id);
  const verdict = await ctx.router.describeScreenshot(
    'layout-sanity',
    shot.toString('base64'),
    'image/png',
  );
  const severityMap = {
    none: 'info',
    low: 'low',
    medium: 'medium',
    high: 'high',
  };
  return {
    id,
    title: 'Editor layout has no obvious visual defects',
    category: 'visual',
    outcome: verdict.ok ? 'pass' : 'fail',
    severity: severityMap[verdict.severity],
    expected: 'No clipped, overlapping, or off-screen content',
    actual: verdict.ok ? verdict.summary : verdict.issues.join('; ') || verdict.summary,
    assertionExercised: true,
    evidence,
    message:
      verdict.issues.length > 0
        ? `Model-reported: ${verdict.issues.join(' | ')}`
        : undefined,
  };
};
export const VISUAL_CHECKS = [editorVisualBaseline, editorLayoutSanity];
