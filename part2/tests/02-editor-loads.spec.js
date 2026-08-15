import { test, expect } from '../src/fixtures/pages.js';
test.describe('Editor', () => {
  test('opening a video renders the timeline, preview and script panel', async ({
    loadedEditor,
  }) => {
    const regions = await loadedEditor.hasCoreRegions();
    expect(regions.timeline, 'The editor should render a timeline region').toBe(true);
    expect(regions.preview, 'The editor should render a video preview / player').toBe(
      true,
    );
    expect(regions.script, 'The editor should render the script panel').toBe(true);
  });
  test('the script panel contains the generated transcript', async ({ loadedEditor }) => {
    const script = await loadedEditor.getScriptText();
    expect(
      script.length,
      'The script panel should contain the transcript generated from the recording. ' +
        'An empty panel means the video was recorded without a mic, or transcription failed.',
    ).toBeGreaterThan(20);
  });
  test('the preview exposes playback controls', async ({ loadedEditor }) => {
    expect(
      await loadedEditor.playButton.isVisible(15_000),
      'The preview should expose a play control so the edit can be reviewed',
    ).toBe(true);
  });
});
