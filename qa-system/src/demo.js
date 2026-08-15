/**
 * Proves the Phase 1 pipeline end to end with synthetic data: no live app, no
 * API key. It builds a previous run and a current run that deliberately contains
 * a regression, a genuine fix, a suspicious pass and a new bug, then runs the
 * real classification, ledger update and report generation.
 *
 *   npm run demo
 *
 * The point is that the memory and the report are demonstrably correct in
 * isolation, before a single browser is launched.
 */
import { compareRuns } from './ledger/classify.js';
import { updateLedger } from './ledger/ledger.js';
import { diffEvidence, describeDiff } from './evidence/diff.js';
import { buildReport } from './report/html.js';
import { openInBrowser, writeReport } from './report/open.js';
import { config } from './config.js';
function shot(label, tone) {
  // A tiny inline SVG so the report has a real image without binary assets.
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='320' height='180'>` +
    `<rect width='320' height='180' fill='${tone}'/>` +
    `<text x='160' y='95' font-family='sans-serif' font-size='16' fill='#fff' ` +
    `text-anchor='middle'>${label}</text></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}
function ev(over) {
  return {
    consoleErrors: [],
    networkEvents: [],
    ...over,
  };
}
function result(over) {
  return {
    category: 'functional',
    outcome: 'pass',
    severity: 'medium',
    expected: '',
    actual: '',
    assertionExercised: true,
    evidence: ev({}),
    ...over,
  };
}

// --- Previous run: the last known-good baseline --------------------------------
const previous = {
  runId: '20260814-0900',
  startedAt: '2026-08-14T09:00:00.000Z',
  target: config.targetUrl,
  meta: {
    target: config.targetUrl,
    browser: 'chromium',
    routing: {},
    tokenSpend: {
      input: 0,
      output: 0,
    },
    durationMs: 42_000,
  },
  results: [
    result({
      id: 'editor.script.persist',
      title: 'Edited script survives a reload',
      expected: 'The edited script is still present after reloading the editor',
      actual: 'Script persisted after reload',
      outcome: 'pass',
      evidence: ev({
        networkEvents: [
          {
            url: 'https://app.trupeer.ai/api/script/save',
            method: 'POST',
            status: 200,
          },
        ],
        domPresence: {
          '[data-testid="script-panel"]': true,
        },
        timingMs: 900,
      }),
    }),
    result({
      id: 'editor.console.clean',
      title: 'No uncaught console errors in the editor',
      expected: 'The editor loads with a clean console',
      actual: 'Console clean',
      outcome: 'pass',
    }),
    result({
      id: 'ai.modify.concise',
      title: 'Modify Script with AI honours "make concise"',
      category: 'ai-validation',
      expected: 'A shorter script that keeps every point',
      actual: 'Rewrite was shorter and complete',
      outcome: 'fail',
      // was broken last time
      assertionExercised: true,
    }),
    result({
      id: 'editor.background.persist',
      title: 'Background choice survives a reload',
      expected: 'The chosen background is still applied after reload',
      actual: 'Background persisted',
      outcome: 'fail',
      // also broken last time
      evidence: ev({
        domPresence: {
          '[data-testid="background-option"]': true,
        },
      }),
    }),
  ],
};

// --- Current run: what today looks like ----------------------------------------
const current = {
  runId: '20260815-0900',
  startedAt: '2026-08-15T09:00:00.000Z',
  target: config.targetUrl,
  meta: {
    target: config.targetUrl,
    browser: 'chromium',
    strongModel: config.strongModel,
    routing: {
      'regression-triage': config.strongModel,
      'layout-sanity': config.visionModel,
    },
    tokenSpend: {
      input: 1840,
      output: 260,
    },
    durationMs: 51_000,
  },
  results: [
    // REGRESSION: persistence worked yesterday, the save now 500s.
    result({
      id: 'editor.script.persist',
      title: 'Edited script survives a reload',
      expected: 'The edited script is still present after reloading the editor',
      actual: 'After reload the script reverted to the original',
      outcome: 'fail',
      severity: 'high',
      evidence: ev({
        screenshotDataUri: shot('reverted script', '#b3261e'),
        consoleErrors: [
          {
            type: 'error',
            text: 'Failed to save script: 500 Internal Server Error',
          },
        ],
        networkEvents: [
          {
            url: 'https://app.trupeer.ai/api/script/save',
            method: 'POST',
            status: 500,
          },
        ],
        domPresence: {
          '[data-testid="script-panel"]': true,
        },
        timingMs: 1100,
      }),
    }),
    // STABLE: still clean.
    result({
      id: 'editor.console.clean',
      title: 'No uncaught console errors in the editor',
      expected: 'The editor loads with a clean console',
      actual: 'Console clean',
      outcome: 'pass',
    }),
    // FIXED (genuine): the AI rewrite now works and the assertion exercised it.
    result({
      id: 'ai.modify.concise',
      title: 'Modify Script with AI honours "make concise"',
      category: 'ai-validation',
      expected: 'A shorter script that keeps every point',
      actual: 'Rewrite was 32% shorter and preserved all points',
      outcome: 'pass',
      assertionExercised: true,
      confidence: 0.9,
      evidence: ev({
        screenshotDataUri: shot('AI rewrite OK', '#137a4b'),
      }),
    }),
    // SUSPICIOUS PASS: background "passes" but the option element vanished, so
    // the check is no longer exercising anything. Not a real fix.
    result({
      id: 'editor.background.persist',
      title: 'Background choice survives a reload',
      expected: 'The chosen background is still applied after reload',
      actual: 'Check passed, but the background option element was not found',
      outcome: 'pass',
      assertionExercised: false,
      evidence: ev({
        domPresence: {
          '[data-testid="background-option"]': false,
        },
      }),
    }),
    // NEW BUG: security check finds a missing header this run.
    result({
      id: 'security.headers.csp',
      title: 'Content-Security-Policy is enforced',
      category: 'security',
      severity: 'medium',
      expected: 'A CSP header that meaningfully restricts sources',
      actual: 'CSP present but includes unsafe-inline for scripts',
      outcome: 'fail',
      assertionExercised: true,
    }),
  ],
};

// --- Run the real pipeline -----------------------------------------------------
const comparison = compareRuns(current, previous);

// Show the evidence diff that would feed regression triage.
const regressed = current.results.find((r) => r.id === 'editor.script.persist');
const prevEvidence = previous.results.find(
  (r) => r.id === 'editor.script.persist',
).evidence;
const diff = diffEvidence(prevEvidence, regressed.evidence);

// Attach a hand-written root cause so the report renders it (the live system
// fills this from the strong model; here we show the shape).
const regressionEntry = comparison.entries.find((e) => e.classification === 'regression');
if (regressionEntry) {
  regressionEntry.rootCause = {
    hypothesis:
      'The script save endpoint began returning 500. The console error and the ' +
      'POST /api/script/save status change both point at a backend save failure, ' +
      'so the reload has nothing persisted to restore. This is a backend regression, ' +
      'not a UI one: the panel still renders, the save just does not complete.',
    layer: 'backend',
    confidence: 0.82,
    evidence: describeDiff(diff).split('\n'),
  };
}
const suspicious = comparison.entries.find((e) => e.classification === 'suspicious-pass');
if (suspicious) {
  suspicious.fixIntent = {
    intended: false,
    confidence: 0.88,
    reasoning:
      'The check passed only because its target element is gone, so it no longer ' +
      'verifies persistence. Treat as a check to repair, not a product fix.',
  };
}
const updatedLedger = updateLedger(
  {
    updatedAt: '',
    entries: [],
  },
  comparison,
  current.runId,
);
console.log('\nClassification counts:', comparison.counts);
console.log(`Ledger now tracks ${updatedLedger.entries.length} bug(s):`);
for (const e of updatedLedger.entries) {
  console.log(`  ${e.status.padEnd(5)} ${e.id}  (${e.history.length} event/s)`);
}
console.log('\nEvidence diff feeding triage for the regression:');
console.log(
  describeDiff(diff)
    .split('\n')
    .map((l) => '  ' + l)
    .join('\n'),
);
const html = buildReport({
  snapshot: current,
  comparison,
  previous,
});
const file = writeReport(current.runId, html);
console.log(`\nReport written: ${file}`);
if (config.openReport) openInBrowser(file);
