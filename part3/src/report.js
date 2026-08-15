import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { config } from './config.js';
import { CRITERIA, CRITERION_KEYS } from './rubric.js';
/**
 * Turns a judgement into a single outcome.
 *
 * The important rule is the third one: a *failure* the judge is not confident
 * about is not reported as a pass. It is reported as NEEDS REVIEW, which in CI
 * means "do not block the build, but put this in front of a person". Silently
 * downgrading uncertain failures to passes is how an LLM judge becomes
 * decorative.
 */
export function score(result) {
  if (result.error || !result.judgement) {
    return {
      ...result,
      outcome: 'ERROR',
      score: 0,
      lowConfidenceCriteria: [],
      failedCriteria: [],
    };
  }
  const judgement = result.judgement;
  const failed = [];
  const lowConfidence = [];
  for (const key of CRITERION_KEYS) {
    const verdict = judgement[key];
    if (!verdict.passed) failed.push(CRITERIA[key].label);
    if (verdict.confidence < config.confidenceThreshold) {
      lowConfidence.push(CRITERIA[key].label);
    }
  }
  const passedCount = CRITERION_KEYS.length - failed.length;
  const scoreValue = passedCount / CRITERION_KEYS.length;
  let outcome;
  if (failed.length === 0 && lowConfidence.length === 0) {
    outcome = 'PASS';
  } else if (failed.length === 0) {
    // Passed everything, but the judge hedged somewhere.
    outcome = 'NEEDS REVIEW';
  } else if (failed.every((label) => lowConfidence.includes(label))) {
    // Every failure is a low-confidence call - not solid enough to gate on.
    outcome = 'NEEDS REVIEW';
  } else {
    outcome = 'FAIL';
  }
  return {
    ...result,
    outcome,
    score: scoreValue,
    lowConfidenceCriteria: lowConfidence,
    failedCriteria: failed,
  };
}
export function summarise(results, startedAt) {
  const totals = {
    PASS: 0,
    FAIL: 0,
    'NEEDS REVIEW': 0,
    ERROR: 0,
  };
  for (const result of results) totals[result.outcome] += 1;
  const graded = results.filter((r) => r.outcome !== 'ERROR');
  const overallScore =
    graded.length === 0 ? 0 : graded.reduce((sum, r) => sum + r.score, 0) / graded.length;
  return {
    startedAt: startedAt.toISOString(),
    provider: config.primaryProvider,
    model: config.activeModel,
    effort: config.primaryProvider === 'anthropic' ? config.judgeEffort : null,
    confidenceThreshold: config.confidenceThreshold,
    results,
    totals,
    overallScore,
    totalTokens: {
      input: results.reduce((sum, r) => sum + (r.usage?.inputTokens ?? 0), 0),
      output: results.reduce((sum, r) => sum + (r.usage?.outputTokens ?? 0), 0),
    },
  };
}
const ICON = {
  PASS: '[PASS]',
  FAIL: '[FAIL]',
  'NEEDS REVIEW': '[????]',
  ERROR: '[ERR ]',
};
export function printToConsole(summary) {
  console.log('\n' + '='.repeat(78));
  console.log('  Modify Script with AI - validation results');
  console.log('='.repeat(78));
  console.log(
    `  Judge: ${summary.provider} / ${summary.model}` +
      (summary.effort ? ` (effort: ${summary.effort})` : '') +
      `   ` +
      `Confidence threshold: ${summary.confidenceThreshold}`,
  );
  console.log('-'.repeat(78));
  for (const result of summary.results) {
    console.log(`\n${ICON[result.outcome]}  ${result.id}  -  "${result.prompt}"`);
    if (result.error) {
      console.log(`        error: ${result.error}`);
      continue;
    }
    if (!result.judgement) continue;
    for (const key of CRITERION_KEYS) {
      const verdict = result.judgement[key];
      const mark = verdict.passed ? 'pass' : 'FAIL';
      const flag =
        verdict.confidence < summary.confidenceThreshold ? '  <- low confidence' : '';
      console.log(
        `        ${mark}  ${CRITERIA[key].label.padEnd(30)} ` +
          `conf ${verdict.confidence.toFixed(2)}${flag}`,
      );
      if (!verdict.passed) {
        console.log(`              ${verdict.reasoning}`);
      }
    }
    console.log(`        ${result.judgement.overallAssessment}`);
    console.log(
      `        script ${result.originalScript.length} -> ${result.modifiedScript.length} chars, ` +
        `capture ${(result.captureDurationMs / 1000).toFixed(1)}s, ` +
        `judge ${((result.judgeLatencyMs ?? 0) / 1000).toFixed(1)}s`,
    );
  }
  console.log('\n' + '='.repeat(78));
  console.log(
    `  ${summary.totals.PASS} passed   ` +
      `${summary.totals.FAIL} failed   ` +
      `${summary.totals['NEEDS REVIEW']} need review   ` +
      `${summary.totals.ERROR} errored`,
  );
  console.log(
    `  Overall criterion pass rate: ${(summary.overallScore * 100).toFixed(1)}%`,
  );
  console.log(
    `  Judge tokens: ${summary.totalTokens.input} in / ${summary.totalTokens.output} out`,
  );
  console.log('='.repeat(78) + '\n');
}
export function writeReports(summary) {
  fs.mkdirSync(config.resultsDir, {
    recursive: true,
  });
  const stamp = summary.startedAt.replace(/[:.]/g, '-');
  const jsonPath = path.join(config.resultsDir, `run-${stamp}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(summary, null, 2), 'utf8');
  const markdownPath = path.join(config.resultsDir, `run-${stamp}.md`);
  fs.writeFileSync(markdownPath, toMarkdown(summary), 'utf8');
  const htmlPath = path.join(config.resultsDir, `run-${stamp}.html`);
  fs.writeFileSync(htmlPath, toHtml(summary), 'utf8');

  // Stable filenames for the latest run, so a reviewer always has one path to
  // open and the README can link to them. Screenshots are referenced by a
  // relative path, so both the stamped and the "latest" copy resolve them.
  fs.copyFileSync(jsonPath, path.join(config.resultsDir, 'latest.json'));
  fs.copyFileSync(markdownPath, path.join(config.resultsDir, 'latest.md'));
  const latestHtml = path.join(config.resultsDir, 'latest.html');
  fs.copyFileSync(htmlPath, latestHtml);
  return {
    json: jsonPath,
    markdown: markdownPath,
    html: latestHtml,
  };
}

/** Opens the HTML report in the default browser unless suppressed (CI, OPEN_REPORT=0). */
export function openReport(file) {
  if (!config.openReport) return;
  const spawnOpts = { detached: true, stdio: 'ignore' };
  try {
    if (process.platform === 'win32') {
      // The empty "" is start's window-title argument; without it a quoted path
      // is mistaken for the title and nothing opens.
      spawn('cmd', ['/c', 'start', '', file], spawnOpts).unref();
    } else if (process.platform === 'darwin') {
      spawn('open', [file], spawnOpts).unref();
    } else {
      spawn('xdg-open', [file], spawnOpts).unref();
    }
    console.log('Opening the report in your browser...\n');
  } catch {
    // Opening is a convenience; a headless box without a browser must not fail.
  }
}
function toMarkdown(summary) {
  const lines = [
    '# Modify Script with AI - validation run',
    '',
    `- **Run at:** ${summary.startedAt}`,
    `- **Judge:** ${summary.provider} / \`${summary.model}\`` +
      (summary.effort ? ` (effort: ${summary.effort})` : ''),
    `- **Confidence threshold:** ${summary.confidenceThreshold}`,
    `- **Result:** ${summary.totals.PASS} passed, ${summary.totals.FAIL} failed, ` +
      `${summary.totals['NEEDS REVIEW']} need review, ${summary.totals.ERROR} errored`,
    `- **Overall criterion pass rate:** ${(summary.overallScore * 100).toFixed(1)}%`,
    '',
    '## Summary',
    '',
    '| Prompt | Outcome | Score | Failed criteria | Low-confidence criteria |',
    '| :--- | :--- | :--- | :--- | :--- |',
  ];
  for (const result of summary.results) {
    lines.push(
      `| \`${result.id}\` | ${result.outcome} | ${(result.score * 100).toFixed(0)}% | ` +
        `${result.failedCriteria.join(', ') || ' - '} | ` +
        `${result.lowConfidenceCriteria.join(', ') || ' - '} |`,
    );
  }
  for (const result of summary.results) {
    lines.push('', `## \`${result.id}\` - ${result.outcome}`, '');
    lines.push(`**Prompt:** ${result.prompt}`, '');
    lines.push(`**Intent:** ${result.intent}`, '');
    if (result.error) {
      lines.push(`**Error:** ${result.error}`, '');
      continue;
    }
    if (!result.judgement) continue;
    lines.push('| Criterion | Verdict | Confidence | Reasoning |');
    lines.push('| :--- | :--- | :--- | :--- |');
    for (const key of CRITERION_KEYS) {
      const verdict = result.judgement[key];
      lines.push(
        `| ${CRITERIA[key].label} | ${verdict.passed ? 'pass' : 'FAIL'} | ` +
          `${verdict.confidence.toFixed(2)} | ${verdict.reasoning.replace(/\|/g, '\\|')} |`,
      );
    }
    lines.push('', `**Overall:** ${result.judgement.overallAssessment}`, '');
    const shot = screenshotHref(result);
    if (shot) {
      lines.push('', `![Editor after the "${result.id}" rewrite](${shot})`, '');
    }
    lines.push('<details><summary>Scripts</summary>', '');
    lines.push('**Original**', '', '```', result.originalScript, '```', '');
    lines.push('**Modified**', '', '```', result.modifiedScript, '```', '');
    lines.push('</details>', '');
  }
  return lines.join('\n');
}

/** Relative (forward-slash) path from the report to a result's screenshot, or null. */
function screenshotHref(result) {
  if (!result.screenshotPath) return null;
  return path
    .relative(config.resultsDir, result.screenshotPath)
    .split(path.sep)
    .join('/');
}

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

const OUTCOME_CLASS = {
  PASS: 'pass',
  FAIL: 'fail',
  'NEEDS REVIEW': 'review',
  ERROR: 'error',
};

/**
 * A self-contained dark-themed HTML report. Inline CSS/JS and relative image
 * paths, so it opens straight from the file system with no server and no
 * external requests - the same "just open it" experience as Part 2's Playwright
 * report. Screenshots are shown as thumbnails that expand to a full-screen
 * lightbox on click.
 */
function toHtml(summary) {
  const baselineShot = fs.existsSync(path.join(config.screenshotsDir, '_baseline.png'))
    ? 'screenshots/_baseline.png'
    : null;

  const baselineCard = baselineShot
    ? `  <article class="card baseline">
    <div class="card-head">
      <div class="card-main">
        <div class="tags"><span class="pill kind">Baseline</span></div>
        <h3 class="prompt">The original script, before any rewrite</h3>
        <p class="assess">Every prompt is graded against this pristine transcript, so each rewrite is an independent test rather than a drift from the previous one.</p>
      </div>
      <img class="thumb" src="${baselineShot}" alt="The editor with the original script" onclick="zoom(this.src)" />
    </div>
  </article>`
    : '';

  const cards = summary.results.map((r) => renderCard(r)).join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Modify Script with AI - validation report</title>
<style>
  :root {
    --bg: #0b0f17; --panel: #141a24; --card: #151b27; --ink: #e6edf5;
    --muted: #8b98ab; --faint: #5b6676; --line: #232c3a;
    --pass: #3fb950; --pass-bg: rgba(63,185,80,.12);
    --fail: #f85149; --fail-bg: rgba(248,81,73,.13);
    --review: #d9a125; --review-bg: rgba(217,161,37,.13);
    --error: #8b98ab; --error-bg: rgba(139,152,171,.13);
    --accent: #7c8bff; --kind: #c3b1ff; --kind-bg: rgba(124,110,255,.14);
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--ink);
    font: 15px/1.55 -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .wrap { max-width: 940px; margin: 0 auto; padding: 40px 20px 72px; }
  h1 { font-size: 25px; margin: 0 0 4px; letter-spacing: -.01em; }
  .sub { color: var(--muted); margin: 0 0 24px; }
  .meta { display: flex; flex-wrap: wrap; gap: 8px 22px; color: var(--muted); font-size: 13px; margin-bottom: 22px; }
  .meta b { color: var(--ink); font-weight: 600; }
  .tallies { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 12px; }
  .tally { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 14px 20px; min-width: 96px; }
  .tally .n { font-size: 26px; font-weight: 700; line-height: 1; }
  .tally .l { font-size: 11.5px; color: var(--muted); text-transform: uppercase; letter-spacing: .05em; margin-top: 6px; }
  .rate { color: var(--muted); font-size: 13px; margin: 0 0 8px; }
  .rate b { color: var(--ink); }

  .badge { display: inline-block; padding: 3px 10px; border-radius: 6px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; }
  .badge.pass { color: var(--pass); background: var(--pass-bg); }
  .badge.fail { color: var(--fail); background: var(--fail-bg); }
  .badge.review { color: var(--review); background: var(--review-bg); }
  .badge.error { color: var(--error); background: var(--error-bg); }

  .card { position: relative; background: var(--card); border: 1px solid var(--line); border-left: 4px solid var(--edge, var(--line)); border-radius: 12px; padding: 18px 20px; margin-top: 16px; }
  .card.pass { --edge: var(--pass); } .card.fail { --edge: var(--fail); }
  .card.review { --edge: var(--review); } .card.error { --edge: var(--error); }
  .card.baseline { --edge: var(--faint); }
  .card-head { display: flex; gap: 18px; align-items: flex-start; justify-content: space-between; }
  .card-main { min-width: 0; flex: 1; }
  .tags { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 10px; }
  .tags .id { color: var(--faint); font-size: 12px; font-family: ui-monospace, "SF Mono", Menlo, monospace; }
  .prompt { margin: 0 0 6px; font-size: 16.5px; font-weight: 650; color: var(--ink); }
  .assess { margin: 0; color: var(--muted); font-size: 13.5px; }

  .pill { display: inline-flex; align-items: center; gap: 5px; padding: 3px 9px; border-radius: 999px; font-size: 11.5px; font-weight: 600; border: 1px solid transparent; white-space: nowrap; }
  .pill.kind { color: var(--kind); background: var(--kind-bg); border-color: rgba(124,110,255,.32); }
  .pill.pass { color: var(--pass); background: var(--pass-bg); border-color: rgba(63,185,80,.28); }
  .pill.fail { color: var(--fail); background: var(--fail-bg); border-color: rgba(248,81,73,.30); }
  .pill.low { box-shadow: inset 0 0 0 1px var(--review); }
  .pill .c { opacity: .7; font-variant-numeric: tabular-nums; }
  .pills { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 13px; }

  .thumb { flex: 0 0 auto; width: 150px; height: 94px; object-fit: cover; object-position: top left; border-radius: 8px; border: 1px solid var(--line); cursor: zoom-in; transition: transform .12s ease, border-color .12s ease; background: #0d1119; }
  .thumb:hover { transform: scale(1.035); border-color: var(--accent); }

  .cardmeta { margin-top: 14px; color: var(--faint); font-size: 12px; font-variant-numeric: tabular-nums; }
  details { margin-top: 12px; border-top: 1px solid var(--line); padding-top: 10px; }
  summary { cursor: pointer; color: var(--accent); font-size: 12.5px; font-weight: 600; list-style: none; }
  summary::-webkit-details-marker { display: none; }
  summary::before { content: "▸ "; }
  details[open] summary::before { content: "▾ "; }
  .crit { width: 100%; border-collapse: collapse; margin: 12px 0 4px; }
  .crit th, .crit td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--line); font-size: 12.5px; vertical-align: top; color: var(--ink); }
  .crit th { color: var(--muted); font-weight: 600; }
  .crit td:nth-child(3) { font-variant-numeric: tabular-nums; white-space: nowrap; }
  .scripts { display: grid; gap: 14px; margin-top: 12px; }
  .scripts h4 { margin: 0 0 6px; font-size: 11.5px; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); }
  pre { background: #0a0e15; color: #cbd5e1; padding: 13px; border: 1px solid var(--line); border-radius: 8px; overflow-x: auto; font-size: 12.5px; line-height: 1.55; white-space: pre-wrap; margin: 0; }
  code { background: #0d1119; padding: 1px 5px; border-radius: 4px; font-size: 12px; }
  footer { margin-top: 44px; color: var(--faint); font-size: 12px; text-align: center; }

  .lightbox { position: fixed; inset: 0; z-index: 50; display: none; align-items: center; justify-content: center; padding: 24px; background: rgba(3,6,12,.9); cursor: zoom-out; }
  .lightbox.open { display: flex; }
  .lightbox img { max-width: 96vw; max-height: 92vh; border-radius: 10px; border: 1px solid var(--line); box-shadow: 0 24px 70px rgba(0,0,0,.6); }
  .lightbox .hint { position: fixed; top: 18px; right: 22px; color: var(--muted); font-size: 12.5px; }

  @media (max-width: 640px) {
    .card-head { flex-direction: column-reverse; }
    .thumb { width: 100%; height: auto; }
  }
</style>
</head>
<body>
<div class="wrap">
  <h1>Modify Script with AI - validation report</h1>
  <p class="sub">LLM-as-judge evaluation of Trupeer's AI script rewriting.</p>

  <div class="meta">
    <span><b>Run at</b> ${esc(summary.startedAt)}</span>
    <span><b>Judge</b> ${esc(summary.provider)} / <code>${esc(summary.model)}</code>${
      summary.effort ? ` (effort: ${esc(summary.effort)})` : ''
    }</span>
    <span><b>Confidence threshold</b> ${summary.confidenceThreshold}</span>
  </div>

  <div class="tallies">
    <div class="tally"><div class="n" style="color:var(--pass)">${summary.totals.PASS}</div><div class="l">Passed</div></div>
    <div class="tally"><div class="n" style="color:var(--fail)">${summary.totals.FAIL}</div><div class="l">Failed</div></div>
    <div class="tally"><div class="n" style="color:var(--review)">${summary.totals['NEEDS REVIEW']}</div><div class="l">Need review</div></div>
    <div class="tally"><div class="n" style="color:var(--error)">${summary.totals.ERROR}</div><div class="l">Errored</div></div>
  </div>
  <p class="rate">Overall criterion pass rate: <b>${(summary.overallScore * 100).toFixed(1)}%</b> &nbsp;&middot;&nbsp; click any thumbnail to enlarge.</p>

${baselineCard}
${cards}

  <footer>Generated by the Part 3 validation harness. Screenshots are captured live from Trupeer during the run.</footer>
</div>

<div class="lightbox" id="lb" onclick="this.classList.remove('open')">
  <span class="hint">Click anywhere or press Esc to close</span>
  <img alt="Enlarged screenshot" />
</div>
<script>
  function zoom(src) {
    var lb = document.getElementById('lb');
    lb.querySelector('img').src = src;
    lb.classList.add('open');
  }
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') document.getElementById('lb').classList.remove('open');
  });
</script>
</body>
</html>`;
}

function renderCard(result) {
  const outcomeClass = OUTCOME_CLASS[result.outcome];
  const kindTag = result.kind ? `<span class="pill kind">${esc(result.kind)}</span>` : '';

  if (result.error) {
    return `  <article class="card ${outcomeClass}">
    <div class="tags"><span class="badge ${outcomeClass}">${esc(result.outcome)}</span>${kindTag}<span class="id">${esc(result.id)}</span></div>
    <h3 class="prompt">${esc(result.prompt)}</h3>
    <p class="assess">Error: ${esc(result.error)}</p>
  </article>`;
  }
  if (!result.judgement) return '';

  // Each criterion becomes a pass/fail pill - the scannable, tag-like summary.
  const pills = CRITERION_KEYS.map((key) => {
    const v = result.judgement[key];
    const low = v.confidence < config.confidenceThreshold;
    const mark = v.passed ? '&#10003;' : '&#10007;';
    return `<span class="pill ${v.passed ? 'pass' : 'fail'}${low ? ' low' : ''}">${mark} ${esc(
      CRITERIA[key].label,
    )} <span class="c">${v.confidence.toFixed(2)}</span></span>`;
  }).join('\n        ');

  // Full reasoning lives behind a disclosure so the card stays scannable.
  const critRows = CRITERION_KEYS.map((key) => {
    const v = result.judgement[key];
    const low = v.confidence < config.confidenceThreshold;
    return `<tr>
        <td>${esc(CRITERIA[key].label)}</td>
        <td><span class="badge ${v.passed ? 'pass' : 'fail'}">${v.passed ? 'pass' : 'fail'}</span></td>
        <td>${v.confidence.toFixed(2)}${low ? ' &#9888;' : ''}</td>
        <td>${esc(v.reasoning)}</td>
      </tr>`;
  }).join('\n      ');

  const shot = screenshotHref(result);
  const thumb = shot
    ? `\n      <img class="thumb" src="${shot}" alt="Editor after the ${esc(
        result.id,
      )} rewrite" onclick="zoom(this.src)" />`
    : '';

  return `  <article class="card ${outcomeClass}">
    <div class="card-head">
      <div class="card-main">
        <div class="tags"><span class="badge ${outcomeClass}">${esc(result.outcome)}</span>${kindTag}<span class="id">${esc(result.id)}</span></div>
        <h3 class="prompt">${esc(result.prompt)}</h3>
        <p class="assess">${esc(result.judgement.overallAssessment)}</p>
        <div class="pills">
        ${pills}
        </div>
      </div>${thumb}
    </div>
    <div class="cardmeta">Score ${(result.score * 100).toFixed(0)}% &middot; ${result.originalScript.length} &rarr; ${result.modifiedScript.length} chars &middot; captured ${(result.captureDurationMs / 1000).toFixed(1)}s &middot; judged ${((result.judgeLatencyMs ?? 0) / 1000).toFixed(1)}s</div>
    <details>
      <summary>Per-criterion reasoning and full scripts</summary>
      <table class="crit">
        <thead><tr><th>Criterion</th><th>Verdict</th><th>Conf.</th><th>Reasoning</th></tr></thead>
        <tbody>
      ${critRows}
        </tbody>
      </table>
      <div class="scripts">
        <div><h4>Original (${result.originalScript.length} chars)</h4><pre>${esc(result.originalScript)}</pre></div>
        <div><h4>Modified (${result.modifiedScript.length} chars)</h4><pre>${esc(result.modifiedScript)}</pre></div>
      </div>
    </details>
  </article>`;
}
