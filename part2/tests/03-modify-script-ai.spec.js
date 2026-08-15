import { test, expect } from '../src/fixtures/pages.js';
test.describe('Modify Script with AI', () => {
  test('a prompt returns a modified script and displays it in the UI', async ({
    loadedEditor,
  }) => {
    const { original, modified, durationMs } = await loadedEditor.modifyScriptWithAi(
      'Make this script more concise.',
    );
    expect(
      modified.length,
      'The AI should return a non-empty script, not blank out the panel',
    ).toBeGreaterThan(20);
    expect(
      modified,
      'The displayed script should differ from the original — an identical script ' +
        'means the prompt was accepted but had no effect',
    ).not.toBe(original);

    // "More concise" is a semantic claim; a string assertion cannot verify it.
    // All this test owns is that a plausible, different script came back and
    // rendered. Judging whether it honoured the intent is Part 3's job.
    console.log(
      `AI round trip: ${durationMs}ms, ${original.length} -> ${modified.length} characters`,
    );
  });
  test('the prompt dialog opens and exposes an input and a submit control', async ({
    loadedEditor,
  }) => {
    await loadedEditor.openModifyScriptDialog();
    expect(
      await loadedEditor.promptInput.isVisible(10_000),
      'The Modify Script dialog should expose a prompt input',
    ).toBe(true);
    expect(
      await loadedEditor.promptSubmitButton.isVisible(10_000),
      'The Modify Script dialog should expose a submit control',
    ).toBe(true);
  });
});
