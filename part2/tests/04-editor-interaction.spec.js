import { test, expect } from '../src/fixtures/pages.js';

/**
 * The "pick any one other editor feature" requirement. The Zooms auto-zoom
 * toggle was chosen because a switch has an observable on/off state
 * (aria-checked / data-state), so "the change applied" can be asserted directly.
 * Trim and background render to a canvas, so verifying them honestly would need
 * pixel diffing; a toggle needs none.
 */
test.describe('Editor interaction - Zooms auto-zoom toggle', () => {
  test('toggling the auto-zoom switch flips its state', async ({ loadedEditor }) => {
    const { before, after } = await loadedEditor.toggleZoomSwitch();

    expect(
      after,
      `Clicking the auto-zoom switch should change its state (it was "${before}"). ` +
        'If the state does not change, the control accepted the click but did not apply it.',
    ).not.toBe(before);
  });
});
