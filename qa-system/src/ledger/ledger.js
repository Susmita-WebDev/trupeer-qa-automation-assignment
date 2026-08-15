import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
/**
 * The persistent memory. Plain JSON on disk, committed to the repo: small,
 * diffable, reviewable in a pull request, and readable as the product's bug
 * history without any tooling. A database would be more machinery than the job
 * needs.
 */

export function loadLedger() {
  if (!fs.existsSync(config.ledgerPath)) {
    return {
      updatedAt: new Date().toISOString(),
      entries: [],
    };
  }
  return JSON.parse(fs.readFileSync(config.ledgerPath, 'utf8'));
}
export function saveLedger(ledger) {
  fs.mkdirSync(path.dirname(config.ledgerPath), {
    recursive: true,
  });
  fs.writeFileSync(config.ledgerPath, JSON.stringify(ledger, null, 2), 'utf8');
}

/** The most recent run snapshot, or undefined on the very first run. */
export function loadPreviousRun() {
  if (!fs.existsSync(config.runsDir)) return undefined;
  const snapshots = fs
    .readdirSync(config.runsDir)
    .filter((name) => name.startsWith('run-') && name.endsWith('.json'))
    .sort();
  const latest = snapshots.at(-1);
  if (!latest) return undefined;
  return JSON.parse(fs.readFileSync(path.join(config.runsDir, latest), 'utf8'));
}
export function saveRun(snapshot) {
  fs.mkdirSync(config.runsDir, {
    recursive: true,
  });
  const file = path.join(config.runsDir, `run-${snapshot.runId}.json`);
  fs.writeFileSync(file, JSON.stringify(snapshot, null, 2), 'utf8');
  return file;
}

/**
 * Fold a comparison back into the ledger: open new bugs, close fixed ones,
 * append history to the rest. The ledger is what gives run N+1 something to
 * compare against, so this is the step that makes the memory cumulative.
 */
export function updateLedger(ledger, comparison, runId) {
  const now = new Date().toISOString();
  const byId = new Map(ledger.entries.map((e) => [e.id, e]));
  for (const entry of comparison.entries) {
    const { result, classification } = entry;
    const isBroken = result.outcome === 'fail' || result.outcome === 'error';
    let ledgerEntry = byId.get(result.id);

    // Track anything that is broken, or that has a history worth keeping.
    if (!ledgerEntry && isBroken) {
      ledgerEntry = {
        id: result.id,
        title: result.title,
        category: result.category,
        expectedBehaviour: result.expected,
        firstSeen: now,
        lastSeen: now,
        status: 'open',
        history: [],
      };
      byId.set(result.id, ledgerEntry);
    }
    if (!ledgerEntry) continue;
    ledgerEntry.lastSeen = now;
    ledgerEntry.status = isBroken ? 'open' : 'fixed';
    ledgerEntry.history.push({
      runId,
      at: now,
      outcome: result.outcome,
      classification,
    });
  }
  return {
    updatedAt: now,
    entries: [...byId.values()].sort((a, b) => a.id.localeCompare(b.id)),
  };
}
