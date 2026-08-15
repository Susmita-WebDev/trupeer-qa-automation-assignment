/**
 * The structured difference between the last-passing evidence and the current
 * failing evidence. This is the raw material the triage model reads to explain a
 * regression. Producing it is pure and deterministic; the model only interprets
 * it, so the "why" is always anchored to observable facts.
 */

function keyOf(event) {
  // Compare endpoints by method + path, ignoring volatile query strings.
  let pathname = event.url;
  try {
    pathname = new URL(event.url).pathname;
  } catch {
    /* keep raw url if it is not absolute */
  }
  return `${event.method} ${pathname}`;
}
export function diffEvidence(before, after) {
  const beforeConsole = new Set(before.consoleErrors.map((c) => c.text));
  const newConsoleErrors = after.consoleErrors
    .filter((c) => c.type === 'error' && !beforeConsole.has(c.text))
    .map((c) => c.text);
  const beforeByKey = new Map(before.networkEvents.map((e) => [keyOf(e), e]));
  const afterByKey = new Map(after.networkEvents.map((e) => [keyOf(e), e]));
  const statusRegressions = [];
  const disappearedRequests = [];
  for (const [key, beforeEvent] of beforeByKey) {
    const afterEvent = afterByKey.get(key);
    if (!afterEvent) {
      // A request that used to fire and no longer does often means the code path
      // that triggered it stopped running: a strong regression signal.
      if (beforeEvent.status < 400) {
        disappearedRequests.push({
          url: beforeEvent.url,
          method: beforeEvent.method,
          before: beforeEvent.status,
        });
      }
      continue;
    }
    if (beforeEvent.status < 400 && afterEvent.status >= 400) {
      statusRegressions.push({
        url: afterEvent.url,
        method: afterEvent.method,
        before: beforeEvent.status,
        after: afterEvent.status,
      });
    }
  }
  const newNetworkFailures = after.networkEvents.filter((e) => {
    if (e.status < 400) return false;
    const beforeEvent = beforeByKey.get(keyOf(e));
    return !beforeEvent || beforeEvent.status < 400;
  });
  const disappearedSelectors = [];
  if (before.domPresence && after.domPresence) {
    for (const [selector, wasPresent] of Object.entries(before.domPresence)) {
      if (wasPresent && after.domPresence[selector] === false) {
        disappearedSelectors.push(selector);
      }
    }
  }
  let timingRegressionMs;
  if (
    typeof before.timingMs === 'number' &&
    typeof after.timingMs === 'number' &&
    after.timingMs > before.timingMs * 2 &&
    after.timingMs - before.timingMs > 1_000
  ) {
    timingRegressionMs = {
      before: before.timingMs,
      after: after.timingMs,
    };
  }
  return {
    newConsoleErrors,
    statusRegressions,
    disappearedRequests,
    newNetworkFailures,
    disappearedSelectors,
    timingRegressionMs,
  };
}

/** True when the diff found nothing actionable. */
export function isEmptyDiff(diff) {
  return (
    diff.newConsoleErrors.length === 0 &&
    diff.statusRegressions.length === 0 &&
    diff.disappearedRequests.length === 0 &&
    diff.newNetworkFailures.length === 0 &&
    diff.disappearedSelectors.length === 0 &&
    !diff.timingRegressionMs
  );
}

/** A human-readable rendering of the diff, also used as the triage prompt input. */
export function describeDiff(diff) {
  const lines = [];
  for (const err of diff.newConsoleErrors) {
    lines.push(`NEW CONSOLE ERROR: ${err}`);
  }
  for (const reg of diff.statusRegressions) {
    lines.push(
      `STATUS REGRESSION: ${reg.method} ${reg.url} returned ${reg.before} before, ${reg.after} now`,
    );
  }
  for (const gone of diff.disappearedRequests) {
    lines.push(
      `REQUEST DISAPPEARED: ${gone.method} ${gone.url} used to fire (${gone.before}), now absent`,
    );
  }
  for (const fail of diff.newNetworkFailures) {
    lines.push(`NEW NETWORK FAILURE: ${fail.method} ${fail.url} -> ${fail.status}`);
  }
  for (const sel of diff.disappearedSelectors) {
    lines.push(`SELECTOR DISAPPEARED: "${sel}" was present before, missing now`);
  }
  if (diff.timingRegressionMs) {
    lines.push(
      `TIMING REGRESSION: interaction took ${diff.timingRegressionMs.before}ms before, ` +
        `${diff.timingRegressionMs.after}ms now`,
    );
  }
  return lines.length > 0 ? lines.join('\n') : 'No structured evidence delta found.';
}
