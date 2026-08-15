/**
 * The orchestrator. One command runs the checks, compares this run to the last,
 * updates the memory, and writes and opens the report.
 *
 *   npm run run
 *
 * Needs the Part 2 session (`npm run auth` in part2/). Model keys are optional:
 * without them, the deterministic checks still run and the report still builds;
 * only the model-backed layout sanity and regression triage are skipped.
 */
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { BrowserSession } from './checks/session.js';
import { runChecks } from './checks/runner.js';
import { FUNCTIONAL_CHECKS } from './checks/functional.js';
import { PERFORMANCE_CHECKS } from './checks/performance.js';
import { VISUAL_CHECKS } from './checks/visual.js';
import { aiValidationChecks } from './checks/ai-validation.js';
import { runSecurityChecks } from './checks/security.js';
import { configuredExtraEngines, crossBrowserSmoke } from './checks/cross-browser.js';
import { ModelRouter } from './models/router.js';
import { compareRuns } from './ledger/classify.js';
import {
  loadLedger,
  loadPreviousRun,
  saveLedger,
  saveRun,
  updateLedger,
} from './ledger/ledger.js';
import { enrichComparison } from './triage/enrich.js';
import { buildReport } from './report/html.js';
import { openInBrowser, writeReport } from './report/open.js';
function runId() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}
async function main() {
  const id = runId();
  const startedAt = new Date();
  const runDir = path.join(config.runsDir, id);
  fs.mkdirSync(runDir, {
    recursive: true,
  });
  const router = new ModelRouter();
  if (!router.strongAvailable) {
    console.warn(
      '[run] No ANTHROPIC_API_KEY: layout sanity and regression triage are skipped.',
    );
  }
  const session = new BrowserSession(runDir);
  const results = [];
  let tracePath;
  console.log(`[run] ${id} against ${config.targetUrl}`);
  await session.start();
  await session.assertSignedIn();
  try {
    const editor = await session.openEditor();
    const ctx = {
      session,
      router,
      editor,
    };
    console.log('\n[run] Functional checks');
    results.push(...(await runChecks(FUNCTIONAL_CHECKS, ctx)));
    console.log('\n[run] Performance checks');
    results.push(...(await runChecks(PERFORMANCE_CHECKS, ctx)));
    console.log('\n[run] Visual checks');
    results.push(...(await runChecks(VISUAL_CHECKS, ctx)));
    console.log('\n[run] AI script validation');
    results.push(...(await runChecks(aiValidationChecks(), ctx)));
  } finally {
    tracePath = await session.stop();
  }

  // Security probes are HTTP-only and need no browser session.
  console.log('\n[run] Security probes (read-only)');
  const security = await runSecurityChecks(config.targetUrl);
  for (const r of security)
    console.log(`  [${r.outcome.toUpperCase().padEnd(7)}] ${r.title}`);
  results.push(...security);

  // Cross-browser smoke, opt-in via CROSS_BROWSER (needs webkit/firefox installed).
  const extraEngines = configuredExtraEngines();
  if (extraEngines.length > 0) {
    console.log(`\n[run] Cross-browser smoke: ${extraEngines.join(', ')}`);
    results.push(...(await crossBrowserSmoke(runDir, extraEngines)));
  }

  // Point the primary-session checks at the run's trace for step-by-step replay.
  // Security checks are HTTP-only and cross-browser checks keep their own traces.
  if (tracePath) {
    const rel = path.relative(runDir, tracePath);
    for (const r of results) {
      if (r.category !== 'security' && !r.id.startsWith('crossbrowser.')) {
        r.evidence.tracePath = rel;
      }
    }
  }
  const snapshot = {
    runId: id,
    startedAt: startedAt.toISOString(),
    target: config.targetUrl,
    results,
    meta: {
      target: config.targetUrl,
      browser: 'chromium',
      strongModel: router.strongAvailable ? config.strongModel : undefined,
      visionModel: config.visionModel,
      routing: router.routing,
      tokenSpend: router.spend,
      durationMs: Date.now() - startedAt.getTime(),
    },
  };
  const previous = loadPreviousRun();
  const comparison = compareRuns(snapshot, previous);

  // Enrich regressions with a root cause and fixed checks with fix intent.
  // No-op when the strong model is unavailable.
  await enrichComparison(comparison, snapshot, previous, router);
  saveRun(snapshot);
  saveLedger(updateLedger(loadLedger(), comparison, id));
  const html = buildReport({
    snapshot,
    comparison,
    previous,
  });
  const reportFile = writeReport(id, html);
  console.log('\n[run] Classification:', comparison.counts);
  console.log(`[run] Report: ${reportFile}`);
  if (config.openReport) openInBrowser(reportFile);

  // A regression is the one outcome that should fail the process for CI.
  process.exitCode = comparison.counts.regression > 0 ? 1 : 0;
}
main().catch((error) => {
  console.error('\n[run] Fatal:', error instanceof Error ? error.message : error);
  process.exit(1);
});
