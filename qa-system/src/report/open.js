import { exec } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

/** Writes the report next to the run and returns its path. */
export function writeReport(runId, html) {
  const dir = path.join(config.runsDir, 'reports');
  fs.mkdirSync(dir, {
    recursive: true,
  });
  const file = path.join(dir, `report-${runId}.html`);
  fs.writeFileSync(file, html, 'utf8');

  // Stable filename for "the latest report", handy for scripts and bookmarks.
  fs.copyFileSync(file, path.join(dir, 'latest.html'));
  return file;
}

/** Opens a file in the OS default handler. Best-effort; never throws. */
export function openInBrowser(filePath) {
  const platform = process.platform;
  const command =
    platform === 'win32'
      ? `start "" "${filePath}"`
      : platform === 'darwin'
        ? `open "${filePath}"`
        : `xdg-open "${filePath}"`;
  exec(command, (error) => {
    if (error) {
      console.warn(`[report] Could not auto-open the report: ${error.message}`);
      console.warn(`[report] Open it manually: ${filePath}`);
    }
  });
}
