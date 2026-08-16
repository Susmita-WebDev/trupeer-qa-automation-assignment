/**
 * End-to-end validation of Trupeer's "Modify Script with AI".
 *
 *   npm run validate
 *
 * 1. Logs in and opens the video editor (reusing Part 2's page objects).
 * 2. Sends each prompt in src/prompts.js and captures the rewritten script.
 * 3. Grades each rewrite with an LLM judge against the rubric in src/rubric.js.
 * 4. Prints a summary and writes JSON + Markdown + HTML reports to results/.
 *
 * Exit code is 1 if any prompt FAILs, 0 otherwise. NEEDS REVIEW does not fail
 * the run - see NOTES.md for why.
 */
import { TrupeerSession } from './src/capture.js';
import { TEST_PROMPTS } from './src/prompts.js';
import { judge } from './src/judge.js';
import { printToConsole, score, summarise, writeReports, openReport } from './src/report.js';
import { config } from './src/config.js';
async function main() {
  const startedAt = new Date();
  const session = new TrupeerSession();
  const results = [];
  console.log('[validate] Opening Trupeer...');
  await session.start();
  console.log(
    `[validate] Editor loaded. Baseline script: ${session.pristineScript.length} characters.`,
  );
  try {
    for (const [index, testPrompt] of TEST_PROMPTS.entries()) {
      const position = `${index + 1}/${TEST_PROMPTS.length}`;
      console.log(`\n[validate] ${position} "${testPrompt.prompt}"`);
      let partial = {
        id: testPrompt.id,
        kind: testPrompt.kind,
        prompt: testPrompt.prompt,
        intent: testPrompt.intent,
        originalScript: '',
        modifiedScript: '',
        captureDurationMs: 0,
        screenshotPath: null,
      };
      try {
        const capture = await session.runPrompt(testPrompt.prompt, testPrompt.id);
        partial = {
          ...partial,
          originalScript: capture.original,
          modifiedScript: capture.modified,
          captureDurationMs: capture.durationMs,
          screenshotPath: capture.screenshotPath,
        };
        console.log(
          `[validate]   captured in ${(capture.durationMs / 1000).toFixed(1)}s ` +
            `(${capture.original.length} -> ${capture.modified.length} chars). Grading...`,
        );
        const verdict = await judge({
          testPrompt,
          originalScript: capture.original,
          modifiedScript: capture.modified,
        });
        partial = {
          ...partial,
          judgement: verdict.judgement,
          judgeLatencyMs: verdict.latencyMs,
          usage: verdict.usage,
        };
      } catch (error) {
        // One prompt failing must not abort the run - a rate limit on prompt 2
        // should not cost us the results for prompts 3 to 5.
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[validate]   error: ${message}`);
        partial = {
          ...partial,
          error: message,
        };
      }
      results.push(score(partial));
    }
  } finally {
    await session.stop();
  }
  const summary = summarise(results, startedAt);
  printToConsole(summary);
  const paths = writeReports(summary);
  console.log(
    '\nReport ready. Open this in a browser to see the full results,\n' +
      'the per-prompt verdicts, and a screenshot of each rewrite:\n\n' +
      `  ${paths.html}\n\n` +
      `Also written: ${paths.markdown} (Markdown) and ${paths.json} (JSON).\n`,
  );
  openReport(paths.html);
  if (summary.totals.ERROR > 0) {
    console.warn(
      `${summary.totals.ERROR} prompt(s) could not be graded. If the cause was a ` +
        'Trupeer error or rate limit rather than the judge, record it in part1/bugs.md.',
    );
  }
  process.exitCode = summary.totals.FAIL > 0 ? 1 : 0;
}
main().catch((error) => {
  console.error('\n[validate] Fatal:', error instanceof Error ? error.message : error);
  console.error(
    '\nCommon causes:\n' +
      '  - No saved session: run `npm run auth` in part2/, or set password creds in the root .env\n' +
      '  - No judge key: set a free GEMINI_API_KEY (or ANTHROPIC_API_KEY) in the root .env\n' +
      '  - Selectors drifted: run `npm run discover` in part2/\n' +
      `  - Judge model unavailable: check the model for ${config.primaryProvider} (currently ${config.activeModel})`,
  );
  process.exit(1);
});
