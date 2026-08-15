import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * A custom Playwright reporter that makes the suite regression-aware.
 *
 * Playwright's own HTML report answers "did these tests pass today". It cannot be
 * given a custom section, so this reporter writes a companion report alongside it
 * that answers the more useful question: "what CHANGED since last time". Each run
 * is remembered on disk; the next run is compared against it and every test is
 * classified regression / fixed / new / still-failing / stable, the same taxonomy
 * the qa-system uses. The report opens automatically when the run finishes.
 *
 * Output (all treated as run artifacts, gitignored):
 *   part2/run-memory/index.html         the companion report
 *   part2/run-memory/history/latest.json + run-<id>.json   the memory
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(HERE, '..', 'run-memory');
const HISTORY_DIR = path.join(OUT_DIR, 'history');
const REPORT_FILE = path.join(OUT_DIR, 'index.html');

// --- Classification (pure) -------------------------------------------------

const CHANGE_ORDER = { regression: 0, 'new': 1, fixed: 2, 'still-failing': 3, removed: 4, stable: 5 };

/** passed | skipped | failed, from Playwright's finer-grained statuses. */
function state(outcome) {
  if (outcome === 'passed') return 'pass';
  if (outcome === 'skipped') return 'skip';
  return 'fail'; // failed, timedOut, interrupted
}

function classifyOne(cur, prev) {
  // No previous record for this id (but the run itself has a baseline): it is new.
  if (!prev) return 'new';
  const was = state(prev);
  const is = state(cur);
  if (was !== 'fail' && is === 'fail') return 'regression';
  if (was === 'fail' && is !== 'fail') return 'fixed';
  if (was === 'fail' && is === 'fail') return 'still-failing';
  return 'stable';
}

function computeChanges(current, previous) {
  if (!previous || !Array.isArray(previous.results)) return null;
  const prevById = new Map(previous.results.map((r) => [r.id, r]));
  const items = current.results.map((r) => {
    const p = prevById.get(r.id);
    return {
      id: r.id,
      type: classifyOne(r.outcome, p?.outcome),
      from: p ? p.outcome : null,
      to: r.outcome,
    };
  });
  const currentIds = new Set(current.results.map((r) => r.id));
  for (const p of previous.results) {
    if (!currentIds.has(p.id)) items.push({ id: p.id, type: 'removed', from: p.outcome, to: null });
  }
  items.sort((a, b) => CHANGE_ORDER[a.type] - CHANGE_ORDER[b.type] || a.id.localeCompare(b.id));
  const counts = {};
  for (const it of items) counts[it.type] = (counts[it.type] ?? 0) + 1;
  return { previousRunAt: previous.startedAt, counts, items };
}

// --- Persistence -----------------------------------------------------------

function loadPrevious() {
  const file = path.join(HISTORY_DIR, 'latest.json');
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function saveSnapshot(snapshot) {
  fs.mkdirSync(HISTORY_DIR, { recursive: true });
  const stamp = snapshot.startedAt.replace(/[:.]/g, '-');
  fs.writeFileSync(path.join(HISTORY_DIR, `run-${stamp}.json`), JSON.stringify(snapshot, null, 2), 'utf8');
  fs.writeFileSync(path.join(HISTORY_DIR, 'latest.json'), JSON.stringify(snapshot, null, 2), 'utf8');
}

function openInBrowser(file) {
  const opts = { detached: true, stdio: 'ignore' };
  try {
    if (process.platform === 'win32') spawn('cmd', ['/c', 'start', '', file], opts).unref();
    else if (process.platform === 'darwin') spawn('open', [file], opts).unref();
    else spawn('xdg-open', [file], opts).unref();
  } catch {
    // opening is a convenience, never fail the run over it
  }
}

// --- Reporter --------------------------------------------------------------

export default class RunMemoryReporter {
  constructor(options = {}) {
    // open by default; suppressed on CI or with { open: false } in the config.
    this.shouldOpen = options.open !== false && !process.env.CI && process.env.PWTEST_OPEN !== 'never';
    this.byId = new Map();
    this.startedAt = new Date();
  }

  onTestEnd(test, result) {
    // test.location.file is the authoritative source file; titlePath() is
    // [root, project, file, ...describes, title].
    const file = path.basename(test.location?.file || test.titlePath()[2] || '');
    if (file === 'auth.setup.js') return; // the auth setup is plumbing, not a test
    const id = `${file} > ${test.titlePath().slice(3).join(' > ')}`;
    // onTestEnd fires per attempt; keep the last (final) outcome.
    this.byId.set(id, {
      id,
      title: test.title,
      file,
      outcome: result.status,
      durationMs: result.duration,
    });
  }

  async onEnd(runResult) {
    const results = [...this.byId.values()].sort((a, b) => a.id.localeCompare(b.id));
    const snapshot = {
      runId: this.startedAt.toISOString().replace(/[:.]/g, '-'),
      startedAt: this.startedAt.toISOString(),
      status: runResult.status,
      results,
    };
    const changes = computeChanges(snapshot, loadPrevious());
    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(REPORT_FILE, buildHtml(snapshot, changes), 'utf8');
    saveSnapshot(snapshot);

    const passed = results.filter((r) => r.outcome === 'passed').length;
    console.log(
      `\n[run-memory] ${passed}/${results.length} passed. ` +
        (changes
          ? `Since last run: ${summarizeCounts(changes.counts)}.`
          : 'Baseline run (nothing to compare yet).'),
    );
    console.log(`[run-memory] Report: ${REPORT_FILE}`);
    if (this.shouldOpen) openInBrowser(REPORT_FILE);
  }
}

function summarizeCounts(counts) {
  const order = ['regression', 'new', 'fixed', 'still-failing', 'removed', 'stable'];
  const parts = order.filter((k) => counts[k]).map((k) => `${counts[k]} ${LABEL[k].toLowerCase()}`);
  return parts.length ? parts.join(', ') : 'no changes';
}

// --- HTML ------------------------------------------------------------------

const LABEL = {
  regression: 'Regression',
  'new': 'New',
  fixed: 'Fixed',
  'still-failing': 'Still failing',
  removed: 'Removed',
  stable: 'Stable',
};
const CLS = {
  regression: 'reg',
  'new': 'new',
  fixed: 'fix',
  'still-failing': 'sf',
  removed: 'rem',
  stable: 'stab',
};

function esc(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function outcomeBadge(outcome) {
  const cls = outcome === 'passed' ? 'pass' : outcome === 'skipped' ? 'skip' : 'fail';
  const label = outcome === 'passed' ? 'PASS' : outcome === 'skipped' ? 'SKIP' : 'FAIL';
  return `<span class="badge ${cls}">${label}</span>`;
}

function buildHtml(snapshot, changes) {
  const total = snapshot.results.length;
  const passed = snapshot.results.filter((r) => r.outcome === 'passed').length;
  const failed = snapshot.results.filter((r) => state(r.outcome) === 'fail').length;
  const skipped = snapshot.results.filter((r) => r.outcome === 'skipped').length;

  // Failures first, then the rest.
  const ordered = [...snapshot.results].sort((a, b) => {
    const rank = (o) => (state(o) === 'fail' ? 0 : o === 'skipped' ? 2 : 1);
    return rank(a.outcome) - rank(b.outcome) || a.id.localeCompare(b.id);
  });
  const testRows = ordered
    .map(
      (r) => `    <div class="row ${state(r.outcome)}">
      ${outcomeBadge(r.outcome)}
      <span class="tid">${esc(r.id)}</span>
      <span class="dur">${(r.durationMs / 1000).toFixed(1)}s</span>
    </div>`,
    )
    .join('\n');

  let changesTabBadge = '';
  let changesPanel = `<div class="empty">This is the <b>baseline run</b> - no previous run to compare against yet. Run the suite again and this tab will show what changed.</div>`;
  if (changes) {
    const cc = changes.counts;
    const reg = cc.regression ?? 0;
    const recurring = cc['still-failing'] ?? 0;
    const otherChanges = (cc.fixed ?? 0) + (cc['new'] ?? 0) + (cc.removed ?? 0);
    changesTabBadge =
      reg > 0
        ? `<span class="cnt warn">${reg} regression${reg > 1 ? 's' : ''}</span>`
        : recurring > 0
          ? `<span class="cnt warn">${recurring} recurring</span>`
          : otherChanges > 0
            ? `<span class="cnt">${otherChanges} changed</span>`
            : `<span class="cnt">no change</span>`;

    const order = ['regression', 'new', 'fixed', 'still-failing', 'removed', 'stable'];
    const chips = order
      .filter((k) => cc[k])
      .map((k) => `<span class="chip ${CLS[k]}">${cc[k]} ${LABEL[k].toLowerCase()}</span>`)
      .join('');
    const transitions = reg + (cc.fixed ?? 0) + (cc['new'] ?? 0) + (cc.removed ?? 0);
    let headline;
    if (transitions === 0 && recurring === 0) {
      headline = `<div class="empty">Every test landed the same outcome as the previous run (<code>${esc(changes.previousRunAt)}</code>) - no regressions. Steady is good.</div>`;
    } else if (transitions === 0) {
      headline = `<div class="empty">No outcomes changed since the previous run (<code>${esc(changes.previousRunAt)}</code>) - no regressions. ${recurring} test${recurring > 1 ? 's' : ''} still failing (below).</div>`;
    } else {
      headline = `<p class="sub">Compared with the previous run (<code>${esc(changes.previousRunAt)}</code>). Ordered by severity: regressions first.</p>`;
    }
    const rows = changes.items
      .map((it) => {
        const move = it.from && it.to ? `${esc(it.from)} &rarr; ${esc(it.to)}` : it.to ? `new &rarr; ${esc(it.to)}` : `was ${esc(it.from)}`;
        return `    <div class="row ${CLS[it.type]}">
      <span class="ctag ${CLS[it.type]}">${LABEL[it.type]}</span>
      <span class="tid">${esc(it.id)}</span>
      <span class="dur">${move}</span>
    </div>`;
      })
      .join('\n');
    changesPanel = `${headline}\n    <div class="chips">${chips}</div>\n${rows}`;
  }

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Part 2 E2E - run memory</title>
<style>
  :root {
    --bg:#0b0f17; --panel:#141a24; --card:#151b27; --ink:#e6edf5; --muted:#8b98ab; --faint:#5b6676; --line:#232c3a;
    --pass:#3fb950; --pass-bg:rgba(63,185,80,.12); --fail:#f85149; --fail-bg:rgba(248,81,73,.13);
    --skip:#8b98ab; --skip-bg:rgba(139,152,171,.13); --review:#d9a125; --review-bg:rgba(217,161,37,.13);
    --accent:#7c8bff; --kind:#c3b1ff;
  }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--ink); font:15px/1.55 -apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif; -webkit-font-smoothing:antialiased; }
  .wrap { max-width:940px; margin:0 auto; padding:40px 20px 72px; }
  h1 { font-size:25px; margin:0 0 4px; letter-spacing:-.01em; }
  .sub { color:var(--muted); margin:0 0 22px; }
  .meta { display:flex; flex-wrap:wrap; gap:8px 22px; color:var(--muted); font-size:13px; margin-bottom:22px; }
  .meta b { color:var(--ink); font-weight:600; }
  .tallies { display:flex; flex-wrap:wrap; gap:12px; margin-bottom:8px; }
  .tally { background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:14px 20px; min-width:96px; }
  .tally .n { font-size:26px; font-weight:700; line-height:1; }
  .tally .l { font-size:11.5px; color:var(--muted); text-transform:uppercase; letter-spacing:.05em; margin-top:6px; }
  .badge { display:inline-block; padding:3px 10px; border-radius:6px; font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.04em; white-space:nowrap; }
  .badge.pass { color:var(--pass); background:var(--pass-bg); } .badge.fail { color:var(--fail); background:var(--fail-bg); } .badge.skip { color:var(--skip); background:var(--skip-bg); }
  .tabs { display:flex; gap:2px; border-bottom:1px solid var(--line); margin:22px 0 4px; }
  .tab { background:none; border:none; color:var(--muted); font:inherit; font-size:13.5px; font-weight:600; padding:10px 15px; cursor:pointer; border-bottom:2px solid transparent; margin-bottom:-1px; }
  .tab:hover { color:var(--ink); } .tab.is-active { color:var(--ink); border-bottom-color:var(--accent); }
  .tab .cnt { display:inline-block; margin-left:7px; padding:1px 8px; border-radius:999px; font-size:11px; font-weight:700; background:var(--panel); color:var(--muted); }
  .tab .cnt.warn { background:var(--review-bg); color:var(--review); }
  .panel { display:none; } .panel.is-active { display:block; }
  .empty { color:var(--muted); background:var(--card); border:1px solid var(--line); border-radius:12px; padding:22px; margin-top:16px; }
  .chips { display:flex; flex-wrap:wrap; gap:8px; margin:18px 0 6px; }
  .chip { padding:4px 11px; border-radius:999px; font-size:12px; font-weight:600; border:1px solid var(--line); color:var(--muted); }
  .chip.reg { color:var(--fail); background:var(--fail-bg); border-color:rgba(248,81,73,.3); }
  .chip.fix { color:var(--pass); background:var(--pass-bg); border-color:rgba(63,185,80,.28); }
  .chip.new { color:var(--kind); background:rgba(124,110,255,.14); border-color:rgba(124,110,255,.32); }
  .chip.sf { color:var(--review); background:var(--review-bg); border-color:rgba(217,161,37,.3); }
  .row { display:flex; align-items:center; gap:12px; flex-wrap:wrap; background:var(--card); border:1px solid var(--line); border-left:4px solid var(--edge,var(--line)); border-radius:10px; padding:12px 14px; margin-top:10px; }
  .row.pass { --edge:var(--pass); } .row.fail, .row.reg { --edge:var(--fail); } .row.fix { --edge:var(--pass); }
  .row.new { --edge:var(--kind); } .row.sf { --edge:var(--review); } .row.skip, .row.rem { --edge:var(--faint); } .row.stab { --edge:var(--line); opacity:.7; }
  .ctag { font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.04em; padding:3px 9px; border-radius:6px; white-space:nowrap; }
  .ctag.reg { color:var(--fail); background:var(--fail-bg); } .ctag.fix { color:var(--pass); background:var(--pass-bg); }
  .ctag.new { color:var(--kind); background:rgba(124,110,255,.14); } .ctag.sf { color:var(--review); background:var(--review-bg); }
  .ctag.rem, .ctag.stab { color:var(--muted); background:var(--skip-bg); }
  .tid { font-family:ui-monospace,Menlo,monospace; font-size:12.5px; color:var(--ink); }
  .dur { margin-left:auto; color:var(--muted); font-size:12.5px; font-variant-numeric:tabular-nums; white-space:nowrap; }
  code { background:#0d1119; padding:1px 5px; border-radius:4px; font-size:12px; }
  footer { margin-top:44px; color:var(--faint); font-size:12px; text-align:center; }
</style>
</head>
<body>
<div class="wrap">
  <h1>Part 2 E2E - run memory</h1>
  <p class="sub">Playwright suite against live Trupeer, made regression-aware. Open Playwright's own report for traces and screenshots.</p>

  <div class="meta">
    <span><b>Run at</b> ${esc(snapshot.startedAt)}</span>
    <span><b>Overall</b> ${esc(snapshot.status)}</span>
  </div>

  <div class="tallies">
    <div class="tally"><div class="n">${total}</div><div class="l">Tests</div></div>
    <div class="tally"><div class="n" style="color:var(--pass)">${passed}</div><div class="l">Passed</div></div>
    <div class="tally"><div class="n" style="color:var(--fail)">${failed}</div><div class="l">Failed</div></div>
    <div class="tally"><div class="n" style="color:var(--skip)">${skipped}</div><div class="l">Skipped</div></div>
  </div>

  <div class="tabs">
    <button class="tab is-active" onclick="showTab(event,'tests')">Tests</button>
    <button class="tab" onclick="showTab(event,'changes')">Changes since last run${changesTabBadge}</button>
  </div>

  <div id="panel-tests" class="panel is-active">
${testRows}
  </div>
  <div id="panel-changes" class="panel">
${changesPanel}
  </div>

  <footer>Generated by the Part 2 run-memory reporter. Each run is remembered under run-memory/history/.</footer>
</div>
<script>
  function showTab(e, name) {
    var t = document.querySelectorAll('.tab'); for (var i=0;i<t.length;i++) t[i].classList.remove('is-active');
    var p = document.querySelectorAll('.panel'); for (var j=0;j<p.length;j++) p[j].classList.remove('is-active');
    e.currentTarget.classList.add('is-active');
    document.getElementById('panel-'+name).classList.add('is-active');
  }
</script>
</body>
</html>`;
}
