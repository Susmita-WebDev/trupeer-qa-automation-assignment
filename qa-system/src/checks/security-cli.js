/**
 * Runs just the read-only security probes and prints a table. Handy on its own
 * because it needs no login and no browser.
 *
 *   npm run security
 */
import { config } from '../config.js';
import { runSecurityChecks } from './security.js';
async function main() {
  console.log(`\nRead-only security probes against ${config.targetUrl}\n`);
  const results = await runSecurityChecks(config.targetUrl);
  const order = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3,
    info: 4,
  };
  results.sort((a, b) => order[a.severity] - order[b.severity]);
  for (const r of results) {
    const mark = r.outcome === 'pass' ? 'PASS' : 'FAIL';
    console.log(`[${mark}] (${r.severity}) ${r.title}`);
    console.log(`       ${r.actual}`);
    for (const note of r.evidence.notes ?? []) console.log(`       - ${note}`);
  }
  const failed = results.filter((r) => r.outcome === 'fail');
  console.log(
    `\n${results.length - failed.length}/${results.length} passed. ${failed.length} finding(s).`,
  );
  console.log(
    'All checks are read-only and non-destructive: response headers, cookie ' +
      'flags, and client-delivered assets only.\n',
  );
}
main().catch((error) => {
  console.error('[security] Failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
