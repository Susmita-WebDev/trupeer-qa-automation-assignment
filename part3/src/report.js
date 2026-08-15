import fs from 'node:fs';
import path from 'node:path';
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

  // Stable filenames for the latest run, so the README can link to them.
  fs.copyFileSync(jsonPath, path.join(config.resultsDir, 'latest.json'));
  fs.copyFileSync(markdownPath, path.join(config.resultsDir, 'latest.md'));
  return {
    json: jsonPath,
    markdown: markdownPath,
  };
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
    lines.push('<details><summary>Scripts</summary>', '');
    lines.push('**Original**', '', '```', result.originalScript, '```', '');
    lines.push('**Modified**', '', '```', result.modifiedScript, '```', '');
    lines.push('</details>', '');
  }
  return lines.join('\n');
}
