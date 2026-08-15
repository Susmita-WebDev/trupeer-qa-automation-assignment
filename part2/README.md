# Part 2 — E2E Test Automation (Playwright)

A Playwright + JavaScript suite covering login, the video editor, "Modify Script
with AI", and one further editor feature, plus negative cases.

## Setup

```bash
npm install
npx playwright install chromium
cp .env.example .env      # then fill it in
npm run auth              # one-time sign-in capture
npx playwright test
```

## Environment variables

All configuration is read from `.env` (gitignored). Nothing is hardcoded.

| Variable | Required | Purpose |
| :--- | :--- | :--- |
| `TRUPEER_BASE_URL` | no | App under test. Defaults to `https://app.trupeer.ai`. |
| `AUTH_MODE` | no | `manual` (default) or `password`. See below. |
| `TRUPEER_EMAIL` | if `password` | Account email. |
| `TRUPEER_PASSWORD` | if `password` | Account password. |
| `STORAGE_STATE_PATH` | no | Where the captured session is written. Defaults to `.auth/user.json`. |
| `TRUPEER_VIDEO_NAME` | no | Title of the video to open. Blank = first video on the dashboard. |
| `AI_RESPONSE_TIMEOUT_MS` | no | Budget for one AI script rewrite. Defaults to 120000. |
| `HEADED` | no | `1` to watch the browser. |

## Authentication

Trupeer's sign-in can go through a third-party identity provider. Driving Google
SSO from an automated browser is unreliable and, on a real account, arguably
something a test should not be doing at all. So the suite separates *acquiring* a
session from *using* one:

- **`AUTH_MODE=password`** — `npm run auth` fills the sign-in form from the env
  vars. Use this if the account has a Trupeer-native password.
- **`AUTH_MODE=manual`** — `npm run auth` opens a visible browser, you sign in
  however the account requires, and press Enter. The session is then saved.

Either way the cookies and local storage land in `.auth/user.json`, which
`playwright.config.js` loads as `storageState`. Every test therefore starts
already signed in — faster, and no credentials touch the test bodies.

When the session expires, tests fail with an explicit message telling you to
re-run `npm run auth` rather than an opaque selector timeout.

## Selector strategy

No test file contains a selector. Every element lives in a page object under
`src/pages/` and is declared as an **ordered list of candidate strategies**:

```ts
readonly modifyScriptButton = this.flexible('Modify Script with AI button', [
  (p) => p.getByRole('button', { name: /modify script with ai/i }),  // accessible role
  (p) => p.getByRole('button', { name: /modify.*script|ai.*script/i }), // looser role
  (p) => p.getByText(/modify script with ai/i),                       // visible text
]);
```

`FlexibleLocator.resolve()` returns the first candidate that is attached to the
DOM. Trupeer ships no stable `data-testid` attributes, so a single CSS selector
would make the suite fail on cosmetic refactors — noise that trains people to
ignore red builds. With this layering, the suite only breaks when *every*
strategy stops matching, which usually means something real changed.

`npm run discover` prints which locators currently resolve against the live app,
so a drifted selector shows up as a one-line `MISS` instead of a mid-suite
failure.

## Waiting

There are no `waitForTimeout(5000)`-style sleeps standing in for readiness.
Waits are on observable conditions:

- `waitForAppReady()` — DOM ready, then network idle, then spinner hidden.
- `waitForLoaded()` — the script panel is visible (it hydrates last).
- `waitForScriptToChange()` — polls the script panel until the text both
  **differs from the baseline** and **has stopped changing for two consecutive
  polls**. The AI response streams in token by token; asserting on a
  half-written script is the single most likely source of flake in this suite.

The one bounded `waitForTimeout` is in the empty-prompt negative test, where the
assertion is that nothing happens — proving a negative needs a settling window.

## Test inventory

| File | Covers |
| :--- | :--- |
| `01-login.spec.js` | Session is authenticated; dashboard renders; at least one video exists. |
| `02-editor-loads.spec.js` | Timeline, preview and script panel render; transcript is present; playback control exists. |
| `03-modify-script-ai.spec.js` | A prompt returns a different, non-empty script and displays it; the dialog exposes its controls. |
| `04-editor-interaction.spec.js` | Applying a background is reflected in the UI and survives a reload. |
| `05-modify-script-negative.spec.js` | Empty prompt is rejected without touching the script; a 20k-character prompt errors or succeeds, but never corrupts the script. |

Background was chosen for the "any one other editor feature" requirement because
its effect is observable in the DOM as a selection state. Trim and zoom render
to canvas, so verifying them honestly would need visual diffing — a claim of
"trim works" backed only by "the button was clickable" would be worse than not
testing it.

## Reports and debugging

```bash
npx playwright test --headed        # watch it run
npx playwright test --ui            # interactive runner
npm run report                      # open the HTML report
```

Traces, screenshots and video are retained on failure under `test-results/`.

## Known constraints

- **Serial, single worker.** One account with one video means parallel workers
  would fight over the same editor state.
- **The AI feature is non-deterministic and rate-limited.** Test 03 asserts only
  that a plausible, different script came back — string matching cannot verify
  "more concise". Whether the output honoured the prompt's *intent* is Part 3.
- **Selectors are best-effort until run against the live app.** Run
  `npm run discover` first; anything reported as `MISS` needs a candidate
  strategy added to the relevant page object.
