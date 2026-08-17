/**
 * A single element described by several candidate strategies, tried in order.
 *
 * Trupeer is an actively developed product with no stable `data-testid`
 * attributes, so a lone CSS selector is a liability: one class rename and the
 * whole suite goes red for a reason that has nothing to do with a real defect.
 * Each element here is instead declared as an ordered list - accessible role
 * first (the most semantically stable), then test ids, then visible text, then
 * structural CSS as a last resort.
 *
 * `resolve()` returns the first candidate that is actually attached to the DOM,
 * so a markup change only breaks the suite when *every* strategy stops matching.
 */
export class FlexibleLocator {
  constructor(page, name, candidates) {
    this.page = page;
    this.name = name;
    this.candidates = candidates;
  }

  /**
   * Returns the first candidate with at least one attached match.
   *
   * Falls back to the first candidate when nothing matches, so the eventual
   * failure message points at the primary strategy rather than at an
   * unhelpful empty union.
   */
  async resolve(timeout = 10_000) {
    const deadline = Date.now() + timeout;
    do {
      for (const build of this.candidates) {
        const locator = build(this.page).first();
        if ((await locator.count()) > 0) return locator;
      }
      // Bounded retry cadence: re-check the candidate strategies every 250ms until
      // one resolves or the deadline passes. This is a poll interval for a
      // dynamically-rendered element, not a fixed "hope it happened" sleep.
      await this.page.waitForTimeout(250);
    } while (Date.now() < deadline);
    return this.candidates[0](this.page).first();
  }

  /** Resolve, then wait until the element is visible. */
  async visible(timeout = 15_000) {
    const locator = await this.resolve(timeout);
    await locator.waitFor({
      state: 'visible',
      timeout,
    });
    return locator;
  }
  async click(timeout = 15_000) {
    const locator = await this.visible(timeout);
    await locator.click();
  }
  async fill(value, timeout = 15_000) {
    const locator = await this.visible(timeout);
    await locator.fill(value);
  }
  async textContent(timeout = 15_000) {
    const locator = await this.visible(timeout);
    return (await locator.innerText()).trim();
  }

  /** True if any candidate is visible within `timeout`. Never throws. */
  async isVisible(timeout = 5_000) {
    try {
      const locator = await this.resolve(timeout);
      return await locator.isVisible({
        timeout,
      });
    } catch {
      return false;
    }
  }
}
