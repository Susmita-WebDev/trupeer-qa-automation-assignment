import { BasePage } from './BasePage.js';
import { EditorPage } from './EditorPage.js';

/** The post-login landing page listing the user's videos. */
export class DashboardPage extends BasePage {
  constructor(page) {
    super(page);
  }
  // Trupeer has no page heading; the sidebar nav and the "Create new" button are
  // the reliable "this is the dashboard" landmarks.
  heading = this.flexible('dashboard landmark', [
    (p) => p.getByRole('link', { name: 'Library' }),
    (p) => p.getByRole('button', { name: /create new/i }),
    (p) => p.locator('h1, h2').first(),
  ]);
  userMenu = this.flexible('account menu', [
    (p) => p.getByRole('button', { name: /account and settings/i }),
    (p) => p.getByRole('button', { name: /free trial|account|profile|settings/i }),
  ]);
  newRecordingButton = this.flexible('new recording button', [
    (p) => p.getByRole('button', { name: /create new/i }),
    (p) => p.getByRole('button', { name: /start recording|upload videos/i }),
  ]);

  /** Every clickable video tile on the dashboard (Trupeer renders them as
   *  `<a role="button">`, not links with hrefs). */
  videoCards() {
    return this.page.locator(
      [
        'a[role="button"][class*="cursor-pointer"]',
        'a[href*="/content/"]',
        '[data-testid*="video" i]',
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
   *             video on the dashboard - which keeps the suite runnable on a
   *             fresh account without editing the config.
   */
  async openVideo(name) {
    await this.waitForAppReady();
    // The video tile is an `<a role="button">` whose accessible name includes
    // the title, so match the button by (substring) name. getByRole name
    // matching is case-insensitive substring by default.
    const target = name
      ? this.page.getByRole('button', { name }).first()
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
