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
    (p) => p.getByRole('textbox', { name: 'Email', exact: true }),
    (p) => p.getByLabel('Email', { exact: true }),
    (p) => p.getByPlaceholder(/your email/i),
    (p) => p.locator('input[type="email"]'),
  ]);
  passwordInput = this.flexible('password input', [
    // A password input is not exposed as a "textbox" role, so match by label.
    (p) => p.getByLabel('Password', { exact: true }),
    (p) => p.getByPlaceholder(/^password$/i),
    (p) => p.locator('input[type="password"]'),
  ]);
  submitButton = this.flexible('sign in button', [
    // Exact "Continue" so it never grabs the "Continue with Google" button.
    (p) => p.getByRole('button', { name: 'Continue', exact: true }),
    (p) => p.locator('button[type="submit"]'),
    (p) => p.getByRole('button', { name: /^(sign in|log ?in)$/i }),
  ]);
  errorMessage = this.flexible('login error message', [
    (p) => p.getByRole('alert'),
    (p) => p.getByText(/invalid|incorrect|wrong|failed|does not match/i),
    (p) => p.locator('[class*="error" i]'),
  ]);
  async open() {
    // The real login route on Trupeer. Falls back to the app root if the app
    // redirects unauthenticated users there anyway.
    await this.goto('/auth?tab=login');
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

  /** True when the sign-in form is on screen - i.e. we are NOT authenticated. */
  async isDisplayed(timeout = 5_000) {
    return this.emailInput.isVisible(timeout);
  }
}
