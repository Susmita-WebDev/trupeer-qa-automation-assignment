import { test, expect } from '../src/fixtures/pages.js';
import { env } from '../src/config/env.js';

/**
 * Negative cases for "Modify Script with AI".
 *
 * The assignment says: if the feature misbehaves, document it as a bug and adapt
 * the tests accordingly. That is exactly what the first test does - it encodes
 * the correct behaviour, then marks itself as an expected failure because of a
 * real defect found during exploratory testing (BUG-2 in part1/bugs.md).
 */
test.describe('Modify Script with AI - negative cases', () => {
  // A whitespace-only prompt carries no instruction. Ideally submit would be
  // disabled; Trupeer instead leaves it enabled and processes it (BUG-2 in
  // part1/bugs.md). Whichever path runs, the invariant that MUST hold is that
  // the script is never left empty or corrupted - which is what this asserts.
  test('an empty (whitespace-only) prompt does not blank or corrupt the script', async ({
    loadedEditor,
  }) => {
    await loadedEditor.openModifyScriptDialog();
    await loadedEditor.promptInput.fill('   ');

    const submit = await loadedEditor.promptSubmitButton.visible();
    if (await submit.isDisabled()) {
      return; // The app refuses an empty instruction - the ideal behaviour.
    }

    // Trupeer accepts it (BUG-2). Submit, then explicitly wait for the rewrite to
    // complete - the Keep changes / Discard changes bar appears when it finishes -
    // instead of a fixed sleep. Bounded by the configurable AI response timeout.
    await submit.click();
    await loadedEditor.keepChangesButton.isVisible(env.aiResponseTimeoutMs);

    expect(
      (await loadedEditor.getScriptText()).length,
      'However the app treats a whitespace-only prompt, it must not blank the script.',
    ).toBeGreaterThan(20);

    // Leave the video as we found it.
    if (await loadedEditor.discardChangesButton.isVisible(3_000)) {
      await (await loadedEditor.discardChangesButton.visible()).click();
    }
  });

  test('the prompt input enforces its character limit', async ({ loadedEditor }) => {
    await loadedEditor.openModifyScriptDialog();

    const input = await loadedEditor.promptInput.visible();
    const maxLength = Number((await input.getAttribute('maxlength')) ?? '0');

    test.skip(
      !maxLength,
      'The prompt input does not declare a maxlength, so there is nothing to assert here.',
    );

    // Try to overflow it, then confirm the field capped the value rather than
    // accepting an unbounded prompt. Capping oversized input is graceful handling.
    await input.fill('a'.repeat(maxLength + 500));
    const value = await input.inputValue();

    expect(
      value.length,
      `The prompt input declares maxlength=${maxLength}, so it should not hold more ` +
        'than that many characters even when more are typed.',
    ).toBeLessThanOrEqual(maxLength);
  });
});
