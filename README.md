# Trupeer.ai — QA Engineer Assignment

Submission for the Trupeer QA Engineer assignment. Three parts, each in its own folder:

| Part | Folder | What it is |
| :--- | :--- | :--- |
| 1 | [`part1/`](part1/) | Exploratory testing session + bug report |
| 2 | [`part2/`](part2/) | Playwright E2E suite (Page Object Model) |
| 3 | [`part3/`](part3/) | LLM-as-judge validation harness for "Modify Script with AI" |

## Prerequisites

- Node.js 20+
- A Trupeer account with **one recorded video that has a generated script** (record with the mic enabled)
- An Anthropic API key (Part 3 only)

## Quick start

```bash
# Part 2 — E2E suite
cd part2
npm install
npx playwright install chromium
cp .env.example .env      # fill in credentials
npm run auth              # one-time: capture a logged-in session
npx playwright test

# Part 3 — AI-augmented validation
cd ../part3
npm install
cp .env.example .env      # fill in credentials + ANTHROPIC_API_KEY
npm run validate
```

Full setup details, environment variables, and troubleshooting live in each part's own README:
[`part2/README.md`](part2/README.md) and [`part3/README.md`](part3/README.md).

## Design notes

**Credentials are never committed.** Everything sensitive is read from environment
variables via `.env` files, which are gitignored. `.env.example` documents each variable.

**Authentication is captured once, reused everywhere.** Trupeer's sign-in may go through
a third-party identity provider, which is slow and brittle to drive on every test. Both
Part 2 and Part 3 log in once and persist the browser storage state to
`part2/.auth/user.json`, then reuse it. See [`part2/README.md`](part2/README.md#authentication)
for the two supported auth modes.

**Selectors are centralised.** Every selector lives in a page object under
`part2/src/pages/`; no test file contains a CSS or XPath string. Each locator is defined
as an ordered list of candidate strategies (role → test id → text), so a single markup
change usually does not break the suite. See
[`part2/src/utils/locators.js`](part2/src/utils/locators.js).

**Part 3 reuses Part 2.** The validation harness imports Part 2's page objects rather
than re-implementing the login and editor flows.
