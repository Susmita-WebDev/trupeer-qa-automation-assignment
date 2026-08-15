import { test, expect } from '../src/fixtures/pages.js';

/**
 * Negative cases for "Modify Script with AI".
 *
 * The bar for passing is *graceful* handling, not any one specific behaviour:
 * a disabled submit button, an inline validation message, and a rejected
 * request with a toast are all acceptable. What is not acceptable is silently
 * accepting the input and destroying the user's script.
 */
test.describe('Modify Script with AI - negative cases', () => {
  test('an empty prompt is rejected and leaves the script untouched', async ({
    loadedEditor,
  }) => {
    const original = await loadedEditor.getScriptText();
    await loadedEditor.openModifyScriptDialog();
    await loadedEditor.promptInput.fill('');
    const submit = await loadedEditor.promptSubmitButton.visible();
    const wasDisabled = await submit.isDisabled();
    if (!wasDisabled) {
      await submit.click();
    }
    const showedError = await loadedEditor.aiErrorMessage.isVisible(10_000);
    expect(
      wasDisabled || showedError,
      'An empty prompt should be blocked - either by disabling submit or by showing ' +
        'a validation message. Accepting it silently is a defect.',
    ).toBe(true);

    // Whatever the app chose to do, it must not have mangled the script.
    await loadedEditor.page.waitForTimeout(3_000);
    expect(
      await loadedEditor.getScriptText(),
      'Rejecting an empty prompt must leave the existing script exactly as it was',
    ).toBe(original);
  });
  test('an extremely long prompt is handled without corrupting the script', async ({
    loadedEditor,
  }) => {
    const original = await loadedEditor.getScriptText();
    const longPrompt = 'Rewrite this script to be more engaging. '.repeat(500); // ~20k chars

    await loadedEditor.openModifyScriptDialog();
    await loadedEditor.promptInput.fill(longPrompt);
    const submit = await loadedEditor.promptSubmitButton.visible();
    if (await submit.isDisabled()) {
      // Rejecting oversized input up front is a perfectly good outcome.
      expect(await loadedEditor.getScriptText()).toBe(original);
      return;
    }
    await submit.click();

    // Either outcome is acceptable: a clear error, or a successful rewrite.
    // A blank or truncated script is not.
    const settled = await Promise.race([
      loadedEditor.waitForScriptToChange(original, 90_000).then((text) => ({
        kind: 'changed',
        text,
      })),
      loadedEditor.aiErrorMessage.visible(90_000).then(() => ({
        kind: 'error',
        text: original,
      })),
    ]).catch(() => ({
      kind: 'timeout',
      text: '',
    }));
    expect(
      settled.kind,
      'A 20,000-character prompt should produce either a visible error or a valid ' +
        'rewritten script within 90s. Hanging indefinitely is a defect.',
    ).not.toBe('timeout');
    const finalScript = await loadedEditor.getScriptText();
    expect(
      finalScript.length,
      'However the app responds to an oversized prompt, the script must not be ' +
        'left empty or truncated to nothing',
    ).toBeGreaterThan(20);
  });
});
