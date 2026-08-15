import { BasePage } from './BasePage.js';
import { EditorPage } from './EditorPage.js';

/** The post-login landing page listing the user's videos. */
export class DashboardPage extends BasePage {
  constructor(page) {
    super(page);
  }
  heading = this.flexible('dashboard heading', [
    (p) =>
      p.getByRole('heading', {
        name: /projects|videos|dashboard|home|library/i,
      }),
    (p) => p.locator('h1, h2').first(),
  ]);
  userMenu = this.flexible('account menu', [
    (p) =>
      p.getByRole('button', {
        name: /account|profile|settings|avatar/i,
      }),
    (p) => p.locator('[class*="avatar" i]'),
    (p) => p.locator('img[alt*="avatar" i], img[alt*="profile" i]'),
  ]);
  newRecordingButton = this.flexible('new recording button', [
    (p) =>
      p.getByRole('button', {
        name: /new|record|create|upload/i,
      }),
    (p) =>
      p.getByRole('link', {
        name: /new|record|create|upload/i,
      }),
  ]);

  /** Every clickable video card / row on the dashboard. */
  videoCards() {
    return this.page.locator(
      [
        '[data-testid*="video" i]',
        '[data-testid*="project" i]',
        'a[href*="/edit"]',
        'a[href*="/video"]',
        'a[href*="/project"]',
      ].join(', '),
    );
  }
  async open() {
    await this.goto('/');
    await this.waitForAppReady();
  }
  async isDisplayed(timeout = 15_000) {
    if (await this.heading.isVisible(timeout)) return true;
    return (await this.videoCards().count()) > 0;
  }
  async videoCount() {
    await this.waitForAppReady();
    return this.videoCards().count();
  }

  /**
   * Opens a video's editor.
   *
   * @param name Exact or partial video title. When omitted, opens the first
   *             video on the dashboard — which keeps the suite runnable on a
   *             fresh account without editing the config.
   */
  async openVideo(name) {
    await this.waitForAppReady();
    const target = name
      ? this.page
          .getByText(name, {
            exact: false,
          })
          .first()
      : this.videoCards().first();
    await target.waitFor({
      state: 'visible',
      timeout: 20_000,
    });
    await target.click();
    const editor = new EditorPage(this.page);
    await editor.waitForLoaded();
    return editor;
  }
}
