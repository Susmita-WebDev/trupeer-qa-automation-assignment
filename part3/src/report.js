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
 * A self-contained HTML report. Inline CSS and relative image paths, so it opens
 * straight from the file system with no server and no external requests - the
 * same "just open it" experience as Part 2's Playwright report.
 */
function toHtml(summary) {
  const baselineShot = fs.existsSync(path.join(config.screenshotsDir, '_baseline.png'))
    ? 'screenshots/_baseline.png'
    : null;

  const summaryRows = summary.results
    .map(
      (r) => `<tr>
        <td><code>${esc(r.id)}</code></td>
        <td><span class="badge ${OUTCOME_CLASS[r.outcome]}">${esc(r.outcome)}</span></td>
        <td>${(r.score * 100).toFixed(0)}%</td>
        <td>${esc(r.failedCriteria.join(', ')) || '-'}</td>
        <td>${esc(r.lowConfidenceCriteria.join(', ')) || '-'}</td>
      </tr>`,
    )
    .join('\n');

  const cards = summary.results.map((r) => renderCard(r)).join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Modify Script with AI - validation report</title>
<style>
  :root {
    --bg: #f6f7f9; --card: #ffffff; --ink: #1c2430; --muted: #667085;
    --line: #e4e7ec; --pass: #067647; --pass-bg: #ecfdf3; --fail: #b42318;
    --fail-bg: #fef3f2; --review: #b54708; --review-bg: #fffaeb;
    --error: #475467; --error-bg: #f2f4f7; --accent: #3538cd;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--ink);
    font: 15px/1.55 -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  }
  .wrap { max-width: 980px; margin: 0 auto; padding: 32px 20px 64px; }
  h1 { font-size: 24px; margin: 0 0 4px; }
  .sub { color: var(--muted); margin: 0 0 20px; }
  .meta { display: flex; flex-wrap: wrap; gap: 8px 20px; color: var(--muted); font-size: 13.5px; margin-bottom: 20px; }
  .meta b { color: var(--ink); font-weight: 600; }
  .tallies { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 28px; }
  .tally { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 10px 16px; }
  .tally .n { font-size: 22px; font-weight: 700; }
  .tally .l { font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: .04em; }
  .badge { display: inline-block; padding: 2px 9px; border-radius: 999px; font-size: 12px; font-weight: 600; }
  .badge.pass { color: var(--pass); background: var(--pass-bg); }
  .badge.fail { color: var(--fail); background: var(--fail-bg); }
  .badge.review { color: var(--review); background: var(--review-bg); }
  .badge.error { color: var(--error); background: var(--error-bg); }
  table { width: 100%; border-collapse: collapse; background: var(--card); border: 1px solid var(--line); border-radius: 10px; overflow: hidden; }
  th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid var(--line); font-size: 13.5px; vertical-align: top; }
  th { background: #fafbfc; color: var(--muted); font-weight: 600; }
  tr:last-child td { border-bottom: none; }
  code { background: #f2f4f7; padding: 1px 5px; border-radius: 4px; font-size: 12.5px; }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 20px 22px; margin-top: 22px; }
  .card h3 { margin: 0 0 2px; font-size: 17px; }
  .card .prompt { color: var(--ink); font-weight: 600; }
  .card .intent { color: var(--muted); font-size: 13.5px; margin: 6px 0 16px; }
  .crit td:nth-child(2) { white-space: nowrap; }
  .conf { font-variant-numeric: tabular-nums; }
  .low { color: var(--review); font-weight: 600; }
  .overall { margin: 16px 0; padding: 12px 14px; background: #fafbfc; border-left: 3px solid var(--accent); border-radius: 6px; font-size: 14px; }
  figure { margin: 16px 0 0; }
  figure img { width: 100%; border: 1px solid var(--line); border-radius: 8px; display: block; }
  figcaption { color: var(--muted); font-size: 12.5px; margin-top: 6px; }
  details { margin-top: 14px; }
  summary { cursor: pointer; color: var(--accent); font-size: 13.5px; font-weight: 600; }
  pre { background: #0f172a; color: #e2e8f0; padding: 14px; border-radius: 8px; overflow-x: auto; font-size: 12.5px; line-height: 1.5; white-space: pre-wrap; }
  .scripts { display: grid; gap: 14px; margin-top: 12px; }
  .scripts h4 { margin: 0 0 6px; font-size: 12.5px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); }
  footer { margin-top: 40px; color: var(--muted); font-size: 12.5px; text-align: center; }
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
    <span><b>Criterion pass rate</b> ${(summary.overallScore * 100).toFixed(1)}%</span>
  </div>

  <div class="tallies">
    <div class="tally"><div class="n" style="color:var(--pass)">${summary.totals.PASS}</div><div class="l">Passed</div></div>
    <div class="tally"><div class="n" style="color:var(--fail)">${summary.totals.FAIL}</div><div class="l">Failed</div></div>
    <div class="tally"><div class="n" style="color:var(--review)">${summary.totals['NEEDS REVIEW']}</div><div class="l">Need review</div></div>
    <div class="tally"><div class="n" style="color:var(--error)">${summary.totals.ERROR}</div><div class="l">Errored</div></div>
  </div>

  <table>
    <thead><tr><th>Prompt</th><th>Outcome</th><th>Score</th><th>Failed criteria</th><th>Low-confidence</th></tr></thead>
    <tbody>
${summaryRows}
    </tbody>
  </table>
${
  baselineShot
    ? `\n  <figure><img src="${baselineShot}" alt="The editor with the original script before any rewrite" /><figcaption>Baseline: the original script in the editor, graded against for every prompt.</figcaption></figure>`
    : ''
}
${cards}

  <footer>Generated by the Part 3 validation harness. Screenshots are captured live from Trupeer during the run.</footer>
</div>
</body>
</html>`;
}

function renderCard(result) {
  const outcomeClass = OUTCOME_CLASS[result.outcome];
  if (result.error) {
    return `  <div class="card">
    <h3><span class="badge ${outcomeClass}">${esc(result.outcome)}</span> <code>${esc(result.id)}</code></h3>
    <p class="prompt">${esc(result.prompt)}</p>
    <div class="overall">Error: ${esc(result.error)}</div>
  </div>`;
  }
  if (!result.judgement) return '';

  const critRows = CRITERION_KEYS.map((key) => {
    const v = result.judgement[key];
    const low = v.confidence < config.confidenceThreshold;
    return `<tr>
      <td>${esc(CRITERIA[key].label)}</td>
      <td><span class="badge ${v.passed ? 'pass' : 'fail'}">${v.passed ? 'pass' : 'FAIL'}</span></td>
      <td class="conf ${low ? 'low' : ''}">${v.confidence.toFixed(2)}${low ? ' &#9888;' : ''}</td>
      <td>${esc(v.reasoning)}</td>
    </tr>`;
  }).join('\n');

  const shot = screenshotHref(result);
  const figure = shot
    ? `\n    <figure><img src="${shot}" alt="Editor after the ${esc(result.id)} rewrite" /><figcaption>Trupeer's editor showing the rewrite for this prompt.</figcaption></figure>`
    : '';

  return `  <div class="card">
    <h3><span class="badge ${outcomeClass}">${esc(result.outcome)}</span> <code>${esc(result.id)}</code></h3>
    <p class="prompt">${esc(result.prompt)}</p>
    <p class="intent">Intent: ${esc(result.intent)}</p>
    <table class="crit">
      <thead><tr><th>Criterion</th><th>Verdict</th><th>Conf.</th><th>Reasoning</th></tr></thead>
      <tbody>
${critRows}
      </tbody>
    </table>
    <div class="overall">${esc(result.judgement.overallAssessment)}</div>${figure}
    <details>
      <summary>Original and modified scripts</summary>
      <div class="scripts">
        <div><h4>Original (${result.originalScript.length} chars)</h4><pre>${esc(result.originalScript)}</pre></div>
        <div><h4>Modified (${result.modifiedScript.length} chars)</h4><pre>${esc(result.modifiedScript)}</pre></div>
      </div>
    </details>
  </div>`;
}
