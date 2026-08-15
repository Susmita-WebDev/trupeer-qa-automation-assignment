import { test, expect } from '../src/fixtures/pages.js';

/**
 * The "pick any one other editor feature" requirement. Background was chosen
 * over trim or zoom because its effect is visible in the DOM as a selection
 * state, which can be asserted without pixel comparison - trim and zoom are
 * both canvas-rendered and would need visual diffing to verify honestly.
 */
test.describe('Editor interaction - background', () => {
  test('applying a background marks it as selected', async ({ loadedEditor }) => {
    test.skip(
      !(await loadedEditor.backgroundTab.isVisible(10_000)),
      'This account or plan does not expose the background controls',
    );
    const label = await loadedEditor.applyFirstBackground();
    expect(
      await loadedEditor.hasSelectedBackground(),
      `After clicking the background option "${label || '(unlabelled)'}", the UI ` +
        'should mark an option as selected. If nothing is marked, the click was ' +
        'accepted but not reflected in the UI - a functional bug worth reporting.',
    ).toBe(true);
  });
  test('the background choice survives a page reload', async ({ loadedEditor, page }) => {
    test.skip(
      !(await loadedEditor.backgroundTab.isVisible(10_000)),
      'This account or plan does not expose the background controls',
    );
    await loadedEditor.applyFirstBackground();
    await page.reload({
      waitUntil: 'domcontentloaded',
    });
    await loadedEditor.waitForLoaded();
    await loadedEditor.backgroundTab.click();
    expect(
      await loadedEditor.hasSelectedBackground(),
      'The applied background should persist across a reload. If it does not, the ' +
        'edit was never saved server-side - silent data loss for the user.',
    ).toBe(true);
  });
});
