import { test, expect } from '../src/fixtures/pages.js';
test.describe('Login', () => {
  test('an authenticated user lands on the dashboard', async ({ signedInDashboard }) => {
    expect(
      await signedInDashboard.isDisplayed(),
      'After signing in, the dashboard should render its heading or at least one video card',
    ).toBe(true);
    expect(
      await signedInDashboard.userMenu.isVisible(10_000),
      'The account menu should be present on the dashboard, proving the session is authenticated',
    ).toBe(true);
  });
  test('the dashboard lists at least one video to edit', async ({
    signedInDashboard,
  }) => {
    const count = await signedInDashboard.videoCount();
    expect(
      count,
      'Parts 2 and 3 both operate on an existing video. If this is 0, record one ' +
        '(with the mic enabled so a script is generated) before running the suite.',
    ).toBeGreaterThan(0);
  });
});
