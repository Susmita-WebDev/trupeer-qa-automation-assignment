/**
 * Runs a list of checks in sequence, isolating failures. One check throwing
 * must not lose the results of the others, so a thrown error becomes an
 * `error` result rather than aborting the run. Checks are written to catch
 * their own expected failures; this is the backstop for the unexpected.
 */
export async function runChecks(checks, ctx) {
  const results = [];
  for (const check of checks) {
    try {
      const result = await check(ctx);
      results.push(result);
      console.log(`  [${result.outcome.toUpperCase().padEnd(7)}] ${result.title}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`  [ERROR  ] ${check.name}: ${message}`);
      results.push({
        id: check.name,
        title: check.name,
        category: 'functional',
        outcome: 'error',
        severity: 'medium',
        expected: 'The check completes',
        actual: `Check threw: ${message}`,
        assertionExercised: false,
        evidence: {
          consoleErrors: [],
          networkEvents: [],
        },
      });
    }
  }
  return results;
}
