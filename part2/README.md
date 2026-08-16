# Part 2 - E2E Test Automation (Playwright)

A Playwright + JavaScript suite covering login, the video editor, "Modify Script
with AI", and one further editor feature, plus negative cases.

## Setup (clone and run)

```bash
# Config lives in ONE .env at the repo root (shared with Part 3 and the qa-system).
cd .. && cp .env.example .env && cd part2   # then fill in credentials (see below)

npm install
npx playwright install chromium
npx playwright test       # one command: signs in, then runs everything
```

That single `npx playwright test` works because a **setup project** signs in
first, using the credentials from the repo-root `.env`, and every test reuses that
session. No separate step, no secrets in the code. Set these two in the root `.env`:

```
AUTH_MODE=password
TRUPEER_EMAIL=the-test-account@example.com
TRUPEER_PASSWORD=the-test-account-password
```

If the account is behind Google SSO instead (which cannot be automated safely),
use `AUTH_MODE=manual` and run `npm run auth` once to sign in by hand before
`npx playwright test`. See [Authentication](#authentication).

### Want to watch it run?

`npx playwright test` runs headless (no visible browser) on purpose - it is
faster and works anywhere. To **watch the browser drive Trupeer** through every
test, use either:

```bash
npm run test:headed    # same tests, browser stays visible the whole time
npm run test:ui        # interactive runner: click a test and step through it
```

(Or set `HEADED=1` in `.env`, which makes the plain `npx playwright test` visible
too.) On the first run a browser always opens briefly to sign in - Trupeer blocks
headless sign-in - then, in headless mode, the tests continue with no window.

The HTML report **opens in your browser automatically** when the run finishes -
results, traces, and screenshots, no extra step. To reopen the last report later:

```bash
npm run report         # or: npx playwright show-report
```

(Auto-open is skipped on CI; set `PWTEST_OPEN=never` to skip it locally too.)

### Regression-aware "run memory" report

A custom reporter ([`reporters/run-memory.js`](reporters/run-memory.js)) writes a
second, companion report that Playwright's own report cannot: **what changed since
the last run**. Every run is remembered on disk (`run-memory/history/`), and the
next run is compared against it, classifying each test as **regression** (was
passing, now failing), **fixed**, **new**, **still-failing** (recurring), or
**stable**. It opens automatically alongside the standard report, with a
`Changes since last run` tab and an orange badge when something regressed.

This is the same run-over-run memory the [`qa-system/`](../qa-system/) is built
around, brought directly into the E2E suite. Output lives in `run-memory/` and is
gitignored (a run artifact, like `playwright-report/`); the first run is a baseline
with nothing to compare against.

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

Sign-in runs once, in a **setup project** (`tests/auth.setup.js`) that the test
project declares as a dependency. It produces a saved session
(`.auth/user.json`, gitignored) that every test reuses, so tests start already
signed in and no credentials appear in any test body.

Two modes, chosen by `AUTH_MODE`:

- **`password` (clone-and-run):** the setup logs in through the sign-in form
  using `TRUPEER_EMAIL` / `TRUPEER_PASSWORD`, then saves the session. A reviewer
  sets those two env vars and runs `npx playwright test` - nothing else. This is
  the intended path for someone cloning the repo.
- **`manual` (SSO fallback):** for accounts behind Google SSO or a magic link,
  which cannot be driven from a test. Run `npm run auth` once - a browser opens,
  you sign in by hand, press Enter, and the session is saved. Then
  `npx playwright test` reuses it. The setup step verifies the saved session
  exists and fails with a clear message if it does not.

Credentials are read only from `.env` (gitignored). To let someone else run the
suite, share the **test account's** credentials with them out of band (they put
them in their own `.env`); never commit them.

## Selector strategy

No test file contains a selector. Every element lives in a page object under
`src/pages/` and is declared as an **ordered list of candidate strategies**:

```js
this.modifyScriptButton = this.flexible('Modify Script with AI button', [
  (p) => p.getByRole('button', { name: /modify script with ai/i }),   // accessible role
  (p) => p.getByRole('button', { name: /modify.*script|ai.*script/i }), // looser role
  (p) => p.getByText(/modify script with ai/i),                       // visible text
]);
```

`FlexibleLocator.resolve()` returns the first candidate that is attached to the
DOM. Trupeer ships no stable `data-testid` attributes, so a single CSS selector
would make the suite fail on cosmetic refactors - noise that trains people to
ignore red builds. With this layering, the suite only breaks when *every*
strategy stops matching, which usually means something real changed.

`npm run discover` prints which locators currently resolve against the live app,
so a drifted selector shows up as a one-line `MISS` instead of a mid-suite
failure.

## Waiting

There are no `waitForTimeout(5000)`-style sleeps standing in for readiness.
Waits are on observable conditions:

- `waitForAppReady()` - DOM ready, then network idle, then spinner hidden.
- `waitForLoaded()` - the script panel is visible (it hydrates last).
- `waitForScriptToChange()` - polls the script panel until the text both
  **differs from the baseline** and **has stopped changing for two consecutive
  polls**. The AI response streams in token by token; asserting on a
  half-written script is the single most likely source of flake in this suite.

The one bounded `waitForTimeout` is in the empty-prompt negative test, where the
assertion is that nothing happens - proving a negative needs a settling window.

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
to canvas, so verifying them honestly would need visual diffing - a claim of
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
  that a plausible, different script came back - string matching cannot verify
  "more concise". Whether the output honoured the prompt's *intent* is Part 3.
- **Selectors are best-effort until run against the live app.** Run
  `npm run discover` first; anything reported as `MISS` needs a candidate
  strategy added to the relevant page object.
