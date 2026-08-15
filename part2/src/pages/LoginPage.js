import { BasePage } from './BasePage.js';

/**
 * The sign-in screen.
 *
 * Trupeer offers both an email/password form and third-party SSO. Only the
 * former can be automated end to end; SSO is handled by the one-off
 * `npm run auth` capture flow instead (see part2/README.md → Authentication).
 */
export class LoginPage extends BasePage {
  constructor(page) {
    super(page);
  }
  emailInput = this.flexible('email input', [
    (p) =>
      p.getByRole('textbox', {
        name: /email/i,
      }),
    (p) => p.getByPlaceholder(/email/i),
    (p) => p.locator('input[type="email"]'),
    (p) => p.locator('input[name="email"]'),
  ]);
  passwordInput = this.flexible('password input', [
    (p) =>
      p.getByRole('textbox', {
        name: /password/i,
      }),
    (p) => p.getByPlaceholder(/password/i),
    (p) => p.locator('input[type="password"]'),
  ]);
  submitButton = this.flexible('sign in button', [
    (p) =>
      p.getByRole('button', {
        name: /^(sign in|log ?in|continue)$/i,
      }),
    (p) =>
      p.getByRole('button', {
        name: /sign in|log ?in/i,
      }),
    (p) => p.locator('button[type="submit"]'),
  ]);
  errorMessage = this.flexible('login error message', [
    (p) => p.getByRole('alert'),
    (p) => p.getByText(/invalid|incorrect|wrong|failed|does not match/i),
    (p) => p.locator('[class*="error" i]'),
  ]);
  async open() {
    await this.goto('/');
    await this.waitForAppReady();
  }
  async signIn(email, password) {
    await this.emailInput.fill(email);
    // Some flows reveal the password field only after the email is submitted.
    if (!(await this.passwordInput.isVisible(2_000))) {
      await this.submitButton.click();
    }
    await this.passwordInput.fill(password);
    await this.submitButton.click();
  }

  /** True when the sign-in form is on screen — i.e. we are NOT authenticated. */
  async isDisplayed(timeout = 5_000) {
    return this.emailInput.isVisible(timeout);
  }
}
