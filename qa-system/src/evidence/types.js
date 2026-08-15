/**
 * Evidence is what makes the ledger able to answer "why".
 *
 * Every check attaches an evidence bundle. When a check regresses, the system
 * diffs the last-passing bundle against the current failing bundle to produce a
 * root-cause hypothesis. Nothing here is invented infrastructure: the console
 * lines, network events and screenshots all come straight out of a Playwright
 * run (or, for the security checks, a plain HTTP request).
 */

export function emptyEvidence() {
  return {
    consoleErrors: [],
    networkEvents: [],
  };
}
