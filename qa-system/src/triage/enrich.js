import { describeDiff, diffEvidence, isEmptyDiff } from '../evidence/diff.js';
import { classifyFixIntent, triageRegression } from './triage.js';

/**
 * Adds model-backed judgment to a comparison, but only where it earns its cost:
 * a root-cause for each regression, and a fix-intent verdict for each fixed or
 * suspicious pass. Everything else is left as the deterministic classification
 * decided. When no strong model is configured, this is a no-op and the run still
 * produces a full report from the deterministic layer.
 */
export async function enrichComparison(comparison, _snapshot, previous, router) {
  if (!router.strongAvailable || !previous) return;
  const previousById = new Map(previous.results.map((r) => [r.id, r]));
  for (const entry of comparison.entries) {
    try {
      if (entry.classification === 'regression') {
        const prev = previousById.get(entry.result.id);
        if (!prev) continue;
        const diff = diffEvidence(prev.evidence, entry.result.evidence);
        if (isEmptyDiff(diff)) continue; // nothing observable to explain
        entry.rootCause = await triageRegression(
          router,
          entry.result,
          describeDiff(diff),
        );
      } else if (
        entry.classification === 'fixed' ||
        entry.classification === 'suspicious-pass'
      ) {
        entry.fixIntent = await classifyFixIntent(router, entry);
      }
    } catch (error) {
      // Triage is an enhancement, never a gate. A model hiccup must not lose the
      // deterministic result, so swallow and move on.
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[triage] Skipped ${entry.result.id}: ${message}`);
    }
  }
}
