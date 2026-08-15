/** Editor time-to-ready must stay within budget. The number is recorded every
 *  run, so a future run can flag a slowdown as a regression even while it still
 *  technically passes today's threshold. */
const EDITOR_LOAD_BUDGET_MS = 15_000;
export const editorLoadWithinBudget = async (ctx) => {
  ctx.session.beginCapture();
  const startedAt = Date.now();
  await ctx.session.page.reload({
    waitUntil: 'domcontentloaded',
  });
  await ctx.editor.waitForLoaded();
  const elapsed = Date.now() - startedAt;
  const evidence = await ctx.session.snapshotEvidence('editor.load.budget');
  evidence.timingMs = elapsed;
  return {
    id: 'editor.load.budget',
    title: 'Editor becomes usable within budget',
    category: 'performance',
    outcome: elapsed <= EDITOR_LOAD_BUDGET_MS ? 'pass' : 'fail',
    severity: 'medium',
    expected: `Editor ready within ${EDITOR_LOAD_BUDGET_MS} ms`,
    actual: `Editor ready in ${elapsed} ms`,
    assertionExercised: true,
    evidence,
    message:
      elapsed > EDITOR_LOAD_BUDGET_MS
        ? 'Over budget. Even if this passes later, the recorded time lets a future run catch a trend.'
        : undefined,
  };
};
export const PERFORMANCE_CHECKS = [editorLoadWithinBudget];
