import path from 'node:path';
import { BrowserSession } from './session.js';
import { emptyEvidence } from '../evidence/types.js';

/**
 * Cross-browser smoke. The brief calls out compatibility, and a bug that only
 * appears on WebKit or Firefox is invisible to a Chromium-only suite. This runs
 * the core path (sign in, open the editor, confirm the three regions render) on
 * each extra engine and reports one result per engine.
 *
 * Opt-in via CROSS_BROWSER, because WebKit and Firefox need a one-time
 * `npx playwright install webkit firefox`.
 */
export async function crossBrowserSmoke(runDir, engines) {
  const results = [];
  for (const engine of engines) {
    const session = new BrowserSession(path.join(runDir, engine), engine);
    try {
      await session.start();
      await session.assertSignedIn();
      const editor = await session.openEditor();
      const regions = await editor.hasCoreRegions();
      const ok = regions.timeline && regions.preview && regions.script;
      const evidence = await session.snapshotEvidence(`crossbrowser.${engine}`);
      results.push({
        id: `crossbrowser.${engine}`,
        title: `Core editor path works on ${engine}`,
        category: 'functional',
        outcome: ok ? 'pass' : 'fail',
        severity: 'medium',
        expected: `Timeline, preview and script panel all render on ${engine}`,
        actual: ok
          ? `All core regions rendered on ${engine}`
          : `Missing on ${engine}: ${[!regions.timeline && 'timeline', !regions.preview && 'preview', !regions.script && 'script'].filter(Boolean).join(', ')}`,
        assertionExercised: true,
        evidence,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const evidence = emptyEvidence();
      evidence.notes = [message];
      results.push({
        id: `crossbrowser.${engine}`,
        title: `Core editor path works on ${engine}`,
        category: 'functional',
        outcome: 'error',
        severity: 'medium',
        expected: `The core path completes on ${engine}`,
        actual: `Could not complete on ${engine}: ${message}`,
        assertionExercised: false,
        evidence,
      });
    } finally {
      await session.stop();
    }
  }
  return results;
}
export function configuredExtraEngines() {
  const raw = process.env.CROSS_BROWSER?.trim();
  if (!raw || raw === '0') return [];
  if (raw === '1') return ['firefox', 'webkit'];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s === 'firefox' || s === 'webkit');
}
