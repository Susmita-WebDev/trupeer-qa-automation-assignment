import { test as base, expect } from '@playwright/test';
import { DashboardPage } from '../pages/DashboardPage.js';
import { EditorPage } from '../pages/EditorPage.js';
import { LoginPage } from '../pages/LoginPage.js';
import { env } from '../config/env.js';
export const test = base.extend({
  loginPage: async ({ page }, use) => {
    await use(new LoginPage(page));
  },
  dashboardPage: async ({ page }, use) => {
    await use(new DashboardPage(page));
  },
  editorPage: async ({ page }, use) => {
    await use(new EditorPage(page));
  },
  signedInDashboard: async ({ page }, use) => {
    const dashboard = new DashboardPage(page);
    await dashboard.open();
    const login = new LoginPage(page);
    if (await login.isDisplayed(3_000)) {
      throw new Error(
        'Expected to be signed in but the login screen is showing. ' +
          'The saved session has probably expired — re-run `npm run auth`.',
      );
    }
    await use(dashboard);
  },
  loadedEditor: async ({ signedInDashboard }, use) => {
    const editor = await signedInDashboard.openVideo(env.videoName || undefined);
    await use(editor);
  },
});
export { expect };
