const SCRIPT_PANEL = '[class*="script" i], [class*="transcript" i]';

/** No uncaught console errors while the editor loads. A page that "works" while
 *  throwing is a latent bug, and it is the cheapest signal we can collect. */
export const editorConsoleClean = async (ctx) => {
  ctx.session.beginCapture();
  await ctx.session.page.reload({
    waitUntil: 'domcontentloaded',
  });
  await ctx.editor.waitForLoaded();
  const evidence = await ctx.session.snapshotEvidence('editor.console.clean');
  const errors = evidence.consoleErrors.filter((c) => c.type === 'error');
  return {
    id: 'editor.console.clean',
    title: 'No uncaught console errors in the editor',
    category: 'functional',
    outcome: errors.length === 0 ? 'pass' : 'fail',
    severity: 'medium',
    expected: 'The editor loads with a clean console',
    actual:
      errors.length === 0
        ? 'Console clean during editor load'
        : `${errors.length} console error(s): ${errors[0]?.text ?? ''}`,
    assertionExercised: true,
    // we always observe the console
    evidence,
  };
};

/** No unexpected 4xx/5xx on the editor's own document/API traffic. */
export const editorNetworkHealthy = async (ctx) => {
  ctx.session.beginCapture();
  await ctx.session.page.reload({
    waitUntil: 'domcontentloaded',
  });
  await ctx.editor.waitForLoaded();
  const evidence = await ctx.session.snapshotEvidence('editor.network.health');
  const failures = evidence.networkEvents.filter((n) => n.status >= 400);
  return {
    id: 'editor.network.health',
    title: 'Editor loads without failed network calls',
    category: 'functional',
    outcome: failures.length === 0 ? 'pass' : 'fail',
    severity: failures.some((f) => f.status >= 500) ? 'high' : 'medium',
    expected: 'No 4xx or 5xx responses on the editor happy path',
    actual:
      failures.length === 0
        ? 'All observed requests returned under 400'
        : `${failures.length} failing request(s), e.g. ${failures[0]?.method} ${failures[0]?.url} -> ${failures[0]?.status}`,
    assertionExercised: evidence.networkEvents.length > 0,
    evidence,
  };
};

/** The transcript generated from the recording is actually present. */
export const editorScriptPresent = async (ctx) => {
  ctx.session.beginCapture();
  const script = await ctx.editor.getScriptText().catch(() => '');
  const evidence = await ctx.session.snapshotEvidence('editor.script.present', [
    SCRIPT_PANEL,
  ]);
  const present = script.length > 20;
  return {
    id: 'editor.script.present',
    title: 'Editor shows the generated transcript',
    category: 'functional',
    outcome: present ? 'pass' : 'fail',
    severity: 'high',
    expected: 'The script panel contains the transcript generated from the recording',
    actual: present
      ? `Script present (${script.length} characters)`
      : 'Script panel empty or missing',
    // If the panel selector did not resolve, the "pass" would be meaningless.
    assertionExercised: evidence.domPresence?.[SCRIPT_PANEL] === true,
    evidence,
  };
};

/**
 * An applied background survives a reload. This is the highest-value functional
 * check for an editor: silent edit loss is exactly the class of bug users hit
 * and rarely report cleanly. The domPresence of the background option is
 * captured so a future "pass" cannot be trusted if the control has vanished.
 */
export const backgroundPersists = async (ctx) => {
  ctx.session.beginCapture();
  if (!(await ctx.editor.backgroundTab.isVisible(8_000))) {
    const evidence = await ctx.session.snapshotEvidence('editor.background.persist');
    return {
      id: 'editor.background.persist',
      title: 'Background choice survives a reload',
      category: 'functional',
      outcome: 'skipped',
      severity: 'medium',
      expected: 'The chosen background is still applied after reloading',
      actual: 'Background controls not exposed on this account or plan',
      assertionExercised: false,
      evidence,
    };
  }
  const optionCountBefore = await ctx.editor.backgroundOptions().count();
  await ctx.editor.applyFirstBackground();
  await ctx.session.page.reload({
    waitUntil: 'domcontentloaded',
  });
  await ctx.editor.waitForLoaded();
  await ctx.editor.backgroundTab.click();
  const selected = await ctx.editor.hasSelectedBackground();
  const evidence = await ctx.session.snapshotEvidence('editor.background.persist');
  // Encode option presence so the ledger's suspicious-pass logic has a target.
  evidence.domPresence = {
    'background option': optionCountBefore > 0,
  };
  return {
    id: 'editor.background.persist',
    title: 'Background choice survives a reload',
    category: 'functional',
    outcome: selected ? 'pass' : 'fail',
    severity: 'high',
    expected: 'The chosen background is still applied after reloading',
    actual: selected
      ? 'Background remained selected after reload'
      : 'Background was not selected after reload (edit not persisted)',
    assertionExercised: optionCountBefore > 0,
    evidence,
  };
};
export const FUNCTIONAL_CHECKS = [
  editorConsoleClean,
  editorNetworkHealthy,
  editorScriptPresent,
  backgroundPersists,
];
