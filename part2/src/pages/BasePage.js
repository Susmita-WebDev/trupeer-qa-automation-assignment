import { FlexibleLocator } from '../utils/locators.js';
export class BasePage {
  constructor(page) {
    this.page = page;
  }
  flexible(name, candidates) {
    return new FlexibleLocator(this.page, name, candidates);
  }
  async goto(pathname) {
    await this.page.goto(pathname, {
      waitUntil: 'domcontentloaded',
    });
  }

  /**
   * Waits for the app to settle: network quiet plus no visible spinner.
   *
   * Trupeer renders client-side, so `domcontentloaded` fires long before
   * anything useful is on screen. This is an explicit wait on an observable
   * condition — there are no fixed sleeps anywhere in this suite.
   */
  async waitForAppReady(timeout = 30_000) {
    await this.page.waitForLoadState('domcontentloaded', {
      timeout,
    });
    await this.page
      .waitForLoadState('networkidle', {
        timeout,
      })
      .catch(() => {
        /* Long-lived sockets can keep the network busy; not a failure. */
      });
    await this.spinner
      .resolve(1_000)
      .then((locator) =>
        locator.waitFor({
          state: 'hidden',
          timeout,
        }),
      )
      .catch(() => {
        /* No spinner rendered — nothing to wait for. */
      });
  }

  /** Generic loading indicator, shared by every page. */
  spinner = this.flexible('loading spinner', [
    (p) => p.getByRole('progressbar'),
    (p) => p.locator('[data-testid*="loading" i], [data-testid*="spinner" i]'),
    (p) => p.locator('[class*="spinner" i], [class*="loader" i]'),
  ]);
  async screenshot(name) {
    return this.page.screenshot({
      path: `test-results/${name}.png`,
      fullPage: true,
    });
  }
}
