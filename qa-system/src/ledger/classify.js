const EMPTY_COUNTS = {
  stable: 0,
  'new-bug': 0,
  regression: 0,
  fixed: 0,
  'still-broken': 0,
  'suspicious-pass': 0,
  'no-baseline': 0,
};
function failed(outcome) {
  return outcome === 'fail' || outcome === 'error';
}

/**
 * Classify one current result against its previous outcome.
 *
 * The two rows that carry the product's intent:
 *
 * - A previously-failing check that now passes is only "fixed" when its
 *   assertion still exercised its target. If the target vanished, the green is
 *   an artefact (the check now matches nothing), so it is "suspicious-pass" and
 *   goes to human review rather than being reported as a win.
 *
 * - A previously-passing check that now fails is a "regression": the event worth
 *   waking someone for. Triage then diffs the evidence to explain it.
 */
export function classifyOne(result, previous) {
  if (!previous) {
    return failed(result.outcome) ? 'new-bug' : 'stable';
  }
  const wasBroken = failed(previous.outcome);
  const isBroken = failed(result.outcome);
  if (wasBroken && !isBroken) {
    return result.assertionExercised ? 'fixed' : 'suspicious-pass';
  }
  if (!wasBroken && isBroken) {
    return 'regression';
  }
  if (wasBroken && isBroken) {
    return 'still-broken';
  }
  return 'stable';
}

/**
 * Compare a whole run against the previous snapshot. Pure: no I/O, no model
 * calls, so it is trivially testable and deterministic. Triage and fix-intent
 * enrichment happen afterwards, only for the entries that warrant a model call.
 */
export function compareRuns(current, previous) {
  const previousById = new Map((previous?.results ?? []).map((r) => [r.id, r]));
  const counts = {
    ...EMPTY_COUNTS,
  };
  const entries = current.results.map((result) => {
    const prev = previousById.get(result.id);
    const classification = previous ? classifyOne(result, prev) : 'no-baseline';
    counts[classification] += 1;
    return {
      result,
      classification,
      previousOutcome: prev?.outcome,
    };
  });
  return {
    runId: current.runId,
    previousRunId: previous?.runId,
    entries,
    counts,
  };
}

/** The entries a human should look at, in priority order. */
export function needsAttention(comparison) {
  const priority = {
    regression: 0,
    'new-bug': 1,
    'suspicious-pass': 2,
    'still-broken': 3,
    fixed: 4,
    'no-baseline': 5,
    stable: 6,
  };
  return comparison.entries
    .filter((e) =>
      ['regression', 'new-bug', 'suspicious-pass', 'still-broken'].includes(
        e.classification,
      ),
    )
    .sort((a, b) => priority[a.classification] - priority[b.classification]);
}
