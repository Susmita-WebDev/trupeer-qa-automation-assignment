import { needsAttention } from '../ledger/classify.js';

/**
 * Builds one self-contained HTML report. Images are embedded as data URIs, all
 * CSS is inline, so the file opens anywhere with no server and can be attached
 * to a ticket or published as an artifact unchanged.
 *
 * The ordering is deliberate: regressions sit at the very top because they are
 * the reason the system exists. A reader who only looks at the first screen
 * still sees the thing that matters most.
 */

function esc(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low', 'info'];
function outcomeBadge(result) {
  const map = {
    pass: 'ok',
    fail: 'bad',
    error: 'bad',
    skipped: 'muted',
  };
  return `<span class="badge ${map[result.outcome] ?? 'muted'}">${result.outcome}</span>`;
}
function classificationBadge(c) {
  const map = {
    regression: 'bad',
    'new-bug': 'bad',
    'suspicious-pass': 'warn',
    'still-broken': 'warn',
    fixed: 'ok',
    stable: 'muted',
    'no-baseline': 'muted',
  };
  return `<span class="badge ${map[c] ?? 'muted'}">${c.replace(/-/g, ' ')}</span>`;
}
function screenshot(result) {
  const uri = result.evidence.screenshotDataUri;
  if (!uri) return '';
  return `<div class="shot"><img src="${uri}" alt="${esc(result.title)} screenshot" loading="lazy"></div>`;
}
function evidenceBlock(result) {
  const e = result.evidence;
  const parts = [];
  if (e.consoleErrors.length > 0) {
    const lines = e.consoleErrors
      .slice(0, 8)
      .map((c) => `<code>[${esc(c.type)}] ${esc(c.text)}</code>`)
      .join('');
    parts.push(
      `<details><summary>Console (${e.consoleErrors.length})</summary>${lines}</details>`,
    );
  }
  const failures = e.networkEvents.filter((n) => n.status >= 400);
  if (failures.length > 0) {
    const lines = failures
      .slice(0, 8)
      .map((n) => `<code>${esc(n.method)} ${esc(n.url)} -> ${n.status}</code>`)
      .join('');
    parts.push(
      `<details><summary>Network failures (${failures.length})</summary>${lines}</details>`,
    );
  }
  if (typeof e.timingMs === 'number') {
    parts.push(`<span class="pill">${e.timingMs} ms</span>`);
  }
  if (e.tracePath) {
    parts.push(`<span class="pill">trace: ${esc(e.tracePath)}</span>`);
  }
  return parts.length > 0 ? `<div class="evidence">${parts.join('')}</div>` : '';
}
function comparedCard(entry) {
  const { result } = entry;
  const rootCause = entry.rootCause
    ? `<div class="rootcause">
         <div class="rootcause-h">Likely cause (${entry.rootCause.layer}, confidence ${entry.rootCause.confidence.toFixed(2)})</div>
         <p>${esc(entry.rootCause.hypothesis)}</p>
         ${entry.rootCause.evidence.map((l) => `<code>${esc(l)}</code>`).join('')}
       </div>`
    : '';
  const fixIntent = entry.fixIntent
    ? `<div class="fixintent ${entry.fixIntent.intended ? 'ok' : 'warn'}">
         ${entry.fixIntent.intended ? 'Intended fix' : 'Unintended / suspicious fix'}
         (confidence ${entry.fixIntent.confidence.toFixed(2)}): ${esc(entry.fixIntent.reasoning)}
       </div>`
    : '';
  return `<article class="card">
    <header>
      ${classificationBadge(entry.classification)} ${outcomeBadge(result)}
      <span class="title">${esc(result.title)}</span>
      <span class="cat">${result.category}</span>
    </header>
    <div class="grid">
      <div>
        <p class="kv"><b>Expected:</b> ${esc(result.expected)}</p>
        <p class="kv"><b>Actual:</b> ${esc(result.actual)}</p>
        ${entry.previousOutcome ? `<p class="kv"><b>Previous run:</b> ${entry.previousOutcome}</p>` : ''}
        ${result.message ? `<p class="kv">${esc(result.message)}</p>` : ''}
        ${rootCause}
        ${fixIntent}
        ${evidenceBlock(result)}
      </div>
      ${screenshot(result)}
    </div>
  </article>`;
}
function section(title, subtitle, body) {
  if (!body.trim()) return '';
  return `<section>
    <h2>${esc(title)}</h2>
    <p class="sub">${esc(subtitle)}</p>
    ${body}
  </section>`;
}
function summaryTiles(input) {
  const c = input.comparison.counts;
  const tiles = [
    ['Regressions', c.regression, c.regression > 0 ? 'bad' : 'ok'],
    ['New bugs', c['new-bug'], c['new-bug'] > 0 ? 'bad' : 'ok'],
    ['Fixed', c.fixed, 'ok'],
    ['Needs review', c['suspicious-pass'], c['suspicious-pass'] > 0 ? 'warn' : 'muted'],
    ['Still broken', c['still-broken'], c['still-broken'] > 0 ? 'warn' : 'muted'],
    ['Stable', c.stable, 'muted'],
  ];
  return `<div class="tiles">${tiles.map(([label, n, tone]) => `<div class="tile ${tone}"><div class="n">${n}</div><div class="l">${label}</div></div>`).join('')}</div>`;
}
function securityTable(results) {
  const sec = results
    .filter((r) => r.category === 'security')
    .sort(
      (a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity),
    );
  if (sec.length === 0) return '';
  const rows = sec
    .map(
      (r) => `<tr class="sev-${r.severity}">
        <td><span class="badge sev-${r.severity}">${r.severity}</span></td>
        <td>${outcomeBadge(r)}</td>
        <td>${esc(r.title)}</td>
        <td>${esc(r.actual)}</td>
      </tr>`,
    )
    .join('');
  return `<table><thead><tr><th>Severity</th><th>Result</th><th>Check</th><th>Finding</th></tr></thead><tbody>${rows}</tbody></table>`;
}
function detailTable(results, category) {
  const rows = results
    .filter((r) => r.category === category)
    .map(
      (r) => `<tr>
        <td>${outcomeBadge(r)}</td>
        <td>${esc(r.title)}</td>
        <td>${esc(r.expected)}</td>
        <td>${esc(r.actual)}</td>
      </tr>`,
    )
    .join('');
  if (!rows) return '';
  return `<table><thead><tr><th>Result</th><th>Check</th><th>Expected</th><th>Observed</th></tr></thead><tbody>${rows}</tbody></table>`;
}
export function buildReport(input) {
  const { snapshot } = input;
  const attention = needsAttention(input.comparison).map(comparedCard).join('');
  const fixed = input.comparison.entries
    .filter((e) => e.classification === 'fixed' || e.classification === 'suspicious-pass')
    .map(comparedCard)
    .join('');
  const meta = snapshot.meta;
  const routing = Object.entries(meta.routing)
    .map(([task, model]) => `<code>${esc(task)} -> ${esc(model)}</code>`)
    .join('');
  const firstRunNote = input.previous
    ? ''
    : `<p class="note">First recorded run. Nothing to compare against yet, so every
       result is a new baseline. The comparison begins on the next run.</p>`;
  return `<!doctype html>
<html lang="en" data-report>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>QA run ${esc(snapshot.runId)}</title>
<style>
  :root {
    --bg:#f7f7f8; --panel:#ffffff; --ink:#1a1a1f; --muted:#6b6b76; --line:#e4e4ea;
    --ok:#137a4b; --okbg:#e7f6ee; --bad:#b3261e; --badbg:#fdecea; --warn:#8a5a00; --warnbg:#fff4e0;
    --accent:#3d5afe;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --bg:#16161a; --panel:#1f1f26; --ink:#ececf2; --muted:#a0a0ad; --line:#33333d;
      --ok:#4ecb8d; --okbg:#123626; --bad:#ff6b61; --badbg:#3a1512; --warn:#ffc86b; --warnbg:#3a2c0e;
      --accent:#8c9eff;
    }
  }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--ink);
    font:15px/1.55 system-ui,-apple-system,Segoe UI,Roboto,sans-serif; }
  .wrap { max-width:1080px; margin:0 auto; padding:32px 20px 80px; }
  h1 { font-size:26px; margin:0 0 4px; }
  h2 { font-size:19px; margin:34px 0 4px; }
  .sub, .note { color:var(--muted); margin:0 0 14px; }
  .head-meta { color:var(--muted); font-size:13px; }
  .tiles { display:grid; grid-template-columns:repeat(auto-fit,minmax(130px,1fr)); gap:12px; margin:20px 0; }
  .tile { background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:16px; text-align:center; }
  .tile .n { font-size:30px; font-weight:700; }
  .tile .l { color:var(--muted); font-size:13px; }
  .tile.bad .n { color:var(--bad); } .tile.ok .n { color:var(--ok); } .tile.warn .n { color:var(--warn); }
  section { margin-top:8px; }
  .card { background:var(--panel); border:1px solid var(--line); border-left:4px solid var(--accent);
    border-radius:10px; padding:16px; margin:12px 0; }
  .card header { display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-bottom:10px; }
  .card .title { font-weight:600; }
  .card .cat { color:var(--muted); font-size:12px; margin-left:auto; text-transform:uppercase; letter-spacing:.04em; }
  .grid { display:grid; grid-template-columns:1fr; gap:16px; }
  @media (min-width:720px) { .grid.has-shot { grid-template-columns:1fr 320px; } }
  .kv { margin:4px 0; }
  .badge { font-size:11px; font-weight:700; padding:2px 8px; border-radius:999px; text-transform:uppercase; letter-spacing:.03em; }
  .badge.ok { background:var(--okbg); color:var(--ok); }
  .badge.bad { background:var(--badbg); color:var(--bad); }
  .badge.warn { background:var(--warnbg); color:var(--warn); }
  .badge.muted { background:var(--line); color:var(--muted); }
  .badge.sev-critical, .badge.sev-high { background:var(--badbg); color:var(--bad); }
  .badge.sev-medium { background:var(--warnbg); color:var(--warn); }
  .badge.sev-low, .badge.sev-info { background:var(--line); color:var(--muted); }
  .pill { display:inline-block; font-size:12px; background:var(--line); color:var(--muted); padding:2px 8px; border-radius:6px; margin:2px 4px 2px 0; }
  code { display:block; font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;
    background:var(--bg); border:1px solid var(--line); border-radius:6px; padding:6px 8px; margin:4px 0; overflow-x:auto; white-space:pre-wrap; word-break:break-all; }
  details { margin:8px 0; } summary { cursor:pointer; color:var(--accent); font-size:13px; }
  .rootcause { background:var(--badbg); border-radius:8px; padding:10px 12px; margin:10px 0; }
  .rootcause-h { font-weight:700; color:var(--bad); margin-bottom:4px; }
  .fixintent { border-radius:8px; padding:8px 12px; margin:10px 0; font-size:13px; }
  .fixintent.ok { background:var(--okbg); color:var(--ok); } .fixintent.warn { background:var(--warnbg); color:var(--warn); }
  .shot img { width:100%; border:1px solid var(--line); border-radius:8px; }
  table { width:100%; border-collapse:collapse; background:var(--panel); border:1px solid var(--line); border-radius:10px; overflow:hidden; margin:10px 0; }
  th, td { text-align:left; padding:9px 12px; border-bottom:1px solid var(--line); font-size:14px; vertical-align:top; }
  th { color:var(--muted); font-weight:600; font-size:12px; text-transform:uppercase; letter-spacing:.04em; }
  tr:last-child td { border-bottom:none; }
  .routing code { display:inline-block; margin:2px 6px 2px 0; }
  footer { margin-top:40px; color:var(--muted); font-size:12px; }
</style>
</head>
<body>
<div class="wrap">
  <h1>QA run report</h1>
  <div class="head-meta">
    Run <b>${esc(snapshot.runId)}</b> at ${esc(snapshot.startedAt)} against ${esc(snapshot.target)}
    ${input.previous ? ` &middot; compared with run ${esc(input.previous.runId)}` : ''}
  </div>
  ${firstRunNote}
  ${summaryTiles(input)}

  ${section('Regressions and new bugs', 'What broke since last time, most urgent first. Each carries the evidence and a likely cause.', attention)}
  ${section('Fixed since last run', 'Previously-failing checks that now pass. Suspicious passes are flagged for review rather than trusted.', fixed)}
  ${section('Security findings', 'Read-only, non-destructive checks against our own account, ranked by severity.', securityTable(snapshot.results))}
  ${section('Visual checks', 'Layout and screenshot results.', detailTable(snapshot.results, 'visual'))}
  ${section('Functional checks', 'Every functional assertion this run made.', detailTable(snapshot.results, 'functional'))}
  ${section('Performance checks', 'Interaction timings against their budgets.', detailTable(snapshot.results, 'performance'))}
  ${section('AI script validation', 'Rubric results for the Modify Script with AI feature.', detailTable(snapshot.results, 'ai-validation'))}

  <section>
    <h2>Run metadata</h2>
    <table>
      <tbody>
      <tr><th>Target</th><td>${esc(meta.target)}</td></tr>
      <tr><th>Browser</th><td>${esc(meta.browser)}</td></tr>
      <tr><th>Duration</th><td>${(meta.durationMs / 1000).toFixed(1)} s</td></tr>
      <tr><th>Model routing</th><td class="routing">${routing || '<span class="pill">none</span>'}</td></tr>
      <tr><th>Token spend</th><td>${meta.tokenSpend.input} in / ${meta.tokenSpend.output} out</td></tr>
      </tbody>
    </table>
  </section>

  <footer>
    Generated by the Trupeer QA system. Regressions are ranked first because they
    are the point: a suite that only reports today's pass rate has no memory.
  </footer>
</div>
<script>
  // Give any card that has a screenshot the two-column grid.
  for (const g of document.querySelectorAll('.grid')) {
    if (g.querySelector('.shot')) g.classList.add('has-shot');
  }
</script>
</body>
</html>`;
}
