# Plan: a QA system with memory and judgment

## Why this exists

The assignment can be passed with three folders of scripts. Most candidates will
submit exactly that, and most of it will be AI generated, so the scripts will
look similar. A test suite that only answers "did these assertions pass today"
is a commodity.

The thing worth building, and the thing a real product team actually wants, is a
system that **remembers what it saw last time and can reason about the
difference**. Not "test failed", but "this worked on the 12th, it does not work
now, here is the network response that changed, and here is why that is probably
the cause". That is the difference between a script and a colleague.

This document is the plan for that system. It is deliberately phased so the
high-value, low-risk parts ship first and the ambitious parts are clearly marked
as optional. It is not a licence to over-engineer.

## What I researched before writing this

I did four rounds of research and let the findings change the design. Two of them
mattered enough to reshape it:

1. **Evidence capture is already solved.** Playwright traces bundle the network
   log (HAR), console output, DOM snapshots, and per-step screenshots into one
   file. The "why did this regress" question is a *diff of stored trace
   artefacts*, not a new subsystem to build. This removed an entire component I
   was about to design.
   ([Playwright visual + trace tooling](https://bug0.com/knowledge-base/playwright-visual-regression-testing),
   [HAR / console capture for triage](https://blog.sucuri.net/2025/04/easy-guide-to-saving-har-files-and-console-logs-for-troubleshooting.html))

2. **Vision is roughly 20x cheaper on a small model.** Gemini 2.5 Flash image
   input is about `$0.15` per 1M tokens versus about `$3` for a Claude Sonnet
   tier, so "describe this screenshot" and "is this layout broken" belong on the
   cheap model, while semantic judgment and regression triage stay on the strong
   model.
   ([API pricing comparison](https://intuitionlabs.ai/articles/ai-api-pricing-comparison-grok-gemini-openai-claude),
   [Gemini Flash image pricing](https://pricepertoken.com/pricing-page/model/google-gemini-2.5-flash-image))

The rest of the research grounds the individual checks:

- **Common functional bug classes** to target first (functional, logical,
  state/persistence, performance, cross-browser), because the brief says
  prioritise functional over cosmetic.
  ([BrowserStack UI bugs](https://www.browserstack.com/guide/bugs-in-ui-testing),
  [bug taxonomy](https://bug0.com/knowledge-base/types-of-bugs-in-software-testing))
- **Root-cause workflow**: Console first, confirm the stack trace, then Network,
  then decide frontend vs backend. This is the exact order the triage logic
  should encode.
  ([frontend debugging guide](https://feature-sliced.design/blog/frontend-debugging-guide),
  [reading console errors](https://crosscheck.cloud/blogs/how-to-read-console-errors-like-pro/))
- **Non-destructive security checks** from the OWASP Web Security Testing Guide:
  security-header and CSP inspection, client-side secret exposure, cookie flags.
  These are read-only and safe to run against our own account.
  ([OWASP WSTG: CSP](https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/02-Configuration_and_Deployment_Management_Testing/12-Test_for_Content_Security_Policy),
  [OWASP WSTG: HTTP security headers](https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/02-Configuration_and_Deployment_Management_Testing/14-Test_Other_HTTP_Security_Header_Misconfigurations))
- **Visual regression** via Playwright's built-in `toHaveScreenshot` (pixelmatch,
  baseline committed to the repo, diff image on failure), with animations
  disabled and fixed viewports to kill flake.
  ([Playwright visual guide](https://www.browserstack.com/guide/visual-regression-testing-using-playwright))

## Design principles (the guardrails)

1. **Reuse, do not rebuild.** Playwright traces are the evidence store. The
   existing Part 2 page objects are the drivers. Part 3's judge pattern extends
   to triage. New code is glue, not infrastructure.
2. **Right model for the job.** A router picks the provider per task by cost and
   capability. No task pays flagship prices for work a cheap model does well.
3. **Non-destructive and authorised only.** Every security probe is read-only and
   runs against our own free-tier account. No fuzzing that writes data, no denial
   of service, no attempts against other tenants. We report misconfigurations; we
   do not exploit them.
4. **Judgment is logged, never hidden.** Every automated verdict carries evidence
   and a confidence score, so a human can audit and override it. This is the same
   discipline already in Part 3.
5. **Phased, not maximal.** Ship Phase 1 end to end before touching Phase 2. A
   working small system beats a half-wired large one.

## The core idea: a run ledger

Every run writes a **state snapshot**: for each check, a stable ID, the outcome,
and a pointer to its evidence (the Playwright trace, screenshot, console lines,
and any failed network calls). Runs are kept, not overwritten.

On the next run, the system loads the previous snapshot and compares check by
check. That comparison is where the intelligence lives:

| Previous | Current | Classification | What the system does |
| :--- | :--- | :--- | :--- |
| known bug (fail) | pass | **Fixed** | Confirm it is a real fix, not a check that silently stopped running. If the check's assertion still exercises the same behaviour, mark FIXED. |
| known bug (fail) | fail | **Still broken** | Re-attach current evidence; note if the failure signature changed. |
| pass | fail | **Regression** | The high-value event. Diff current evidence against the last passing evidence and produce a candidate root cause. |
| pass | pass | Stable | No action beyond recording. |
| (absent) | fail | **New bug** | Add to the ledger with a fresh ID. |

Two of these rows are the crux of what the user asked for.

### "Was it fixed, and was the fix intended?"

A green check is not proof of a fix. A check can go green because the feature was
repaired, or because the element it looked for was renamed and the assertion now
matches nothing, or because a fallback masked the problem. So FIXED requires two
things: the check passes now, **and** its assertion still meaningfully exercises
the original behaviour (the locator resolved, the value was actually read, the
DOM node was present). When a previously-failing check passes but its target went
missing, that is flagged as **"passed for a suspicious reason"** and sent to
human review rather than celebrated. "Intended vs unintended fix" is then a short
judgment call: the ledger stores the original expected behaviour, and the triage
model compares it against what the check now observes.

### "It worked before, why not now?" (the internal why)

This is the regression row, and it is the reason the ledger stores evidence and
not just pass/fail. When a check flips pass to fail, the system has two evidence
bundles: the last passing run and the current failing run. It diffs them along
axes that carry causal signal:

- **New console errors** present now and absent before (ReferenceError,
  TypeError, CORS, a failed chunk load).
- **Network deltas**: an endpoint that returned 200 before and 500 now, a request
  that used to fire and no longer does, a new 4xx, a large latency jump.
- **DOM / selector deltas**: an element that resolved before and is now absent
  (feature removed or renamed) versus present but non-functional (wired wrong).
- **Timing**: did the step that now times out previously complete quickly.

The triage runs the researched order: console first, then network, then DOM, then
timing, and emits a ranked hypothesis with the evidence line that supports it.
This is the "internal data of why" the user asked for. It is not magic; it is a
structured diff of two traces plus a model that reads the diff and writes the
most likely cause in one paragraph, with the raw evidence linked beneath it.

### Storage format

Plain JSON on disk, committed to the repo (small, diffable, reviewable in a PR,
no database to stand up). One `ledger.json` holds the persistent list of known
bugs and their history; each run writes a timestamped `run-<stamp>.json` snapshot
plus its trace and screenshot artefacts. The pristine simplicity is the point:
anyone can open the ledger and read the product's bug history as text.

## Model routing

A single `askModel(task, input)` layer chooses the provider. Providers sit behind
one interface so a key that is missing simply disables the tasks that need it,
and the rest of the system runs.

| Task | Model | Why |
| :--- | :--- | :--- |
| Script-rewrite judging (Part 3 rubric) | Claude (strong) | Semantic judgment; already built and calibrated here. |
| Regression root-cause triage | Claude (strong) | Reads a trace diff and reasons about cause. Correctness matters more than cost, and volume is low (only on regressions). |
| Screenshot description / "is this layout broken" | Gemini Flash (cheap vision) | About 20x cheaper per image; the task is perception, not deep reasoning. |
| Bulk classification (label a console error, tag a bug) | Gemini Flash / Flash-Lite | High volume, low difficulty. |
| Fix-intent classification | Claude (strong), low effort | Short judgment, but it gates the ledger, so accuracy matters. |

The honest tradeoff: adding Gemini adds a second key and a second SDK. That is
worth it for the vision cost saving and because the user explicitly wants screen
and image intelligence cheaply. If only one key is available, the router falls
back to the available provider and logs that it did so.

## Technical validation (what we assert)

Beyond the existing Part 2 flows:

- **State persistence**: does an edit survive a reload. This is the highest-value
  functional bug class for an editor, and it is silent when it breaks.
- **Console is clean**: no uncaught errors during a normal flow. A page that
  "works" while throwing in the console is a latent bug.
- **Network is healthy**: no unexpected 4xx/5xx on the happy path; core API calls
  actually fire.
- **Performance budget**: key interactions complete within a threshold; record
  the number so a future run can catch a slowdown as a regression.
- **Cross-browser smoke**: run the core path on Chromium plus one of WebKit or
  Firefox, because the brief calls out compatibility.

## Visual and graphics validation

- **Baseline screenshots** of the dashboard and editor via `toHaveScreenshot`,
  animations disabled, fixed viewport. A pixel diff over threshold is a candidate
  regression, reviewed as an image in the report.
- **Cheap-model layout sanity**: feed a full-page screenshot to Gemini Flash with
  a tight question set (is any text overlapping or clipped, is anything obviously
  misaligned, is any control off-screen). This catches the class of break that
  pixel diffing misses on first run, when there is no baseline yet.
- **Responsive spot checks** at a couple of viewport widths to catch elements
  that become unreachable rather than merely ugly.

## Advanced: non-destructive security and "silly mistakes"

All read-only, all against our own account, all reported rather than exploited.
Grounded in the OWASP WSTG.

- **Security headers**: presence and sanity of Content-Security-Policy (enforced
  vs report-only), Strict-Transport-Security, X-Content-Type-Options,
  X-Frame-Options / frame-ancestors, Referrer-Policy.
- **Cookie flags**: HttpOnly, Secure, SameSite on session cookies.
- **Client-side secret exposure**: scan loaded JS and network responses for
  patterns that look like leaked API keys, tokens, or private endpoints shipped
  to the browser.
- **Sensitive data in transit**: confirm auth flows are over HTTPS; flag any
  mixed content.
- **Common product "silly mistakes"**: verbose error messages that leak stack
  traces or internal paths, missing rate limiting visible to the client, debug
  flags left on, source maps served in production that expose internal code.

Explicit non-goals for safety and ethics: no SQL injection or XSS payloads that
persist data, no brute force, no load or denial-of-service testing, no access to
any account but our own. If a serious issue is found, it is documented privately
in the report and, in a real engagement, disclosed responsibly, not published.

## The HTML report

After every run, a self-contained HTML report is generated and opened
automatically. Sections:

1. **Executive summary**: pass / fail / regression / fixed / needs-review counts,
   and the overall health delta since the last run.
2. **Regressions** (top of the report, because they are the point): each with the
   candidate root cause, the before/after evidence, and the screenshots.
3. **Fixed since last run**: with the intended-vs-suspicious classification.
4. **Functional results**: every check, its assertion, and its evidence.
5. **Visual diffs**: expected / actual / diff images inline.
6. **Security findings**: severity, description, evidence, and remediation.
7. **AI script validation**: the Part 3 rubric results.
8. **Run metadata**: environment, model routing used, token spend, timings.

The report is a single HTML file with images embedded as data URIs, so it opens
anywhere with no server. It is opened locally after the run, and it is also
suitable for publishing as a shareable artifact. Screenshots are captured at
every meaningful step so each section can show, not just tell.

## Phased delivery

**Phase 1 - Priority (the memory).** The run ledger, the pass/fail/regression/
fixed classification, evidence capture via Playwright traces, and the HTML report
with screenshots. This alone is the differentiator: a suite that remembers.
Depends only on Part 2, which exists.

**Phase 2 - Technical and visual.** State-persistence and console/network health
checks, the performance budget, baseline visual regression, and the cheap-model
layout sanity pass. Introduces the Gemini vision route.

**Phase 3 - Advanced.** The security header / cookie / secret-exposure probes,
the "silly mistakes" scan, cross-browser smoke, and the full model router with
fix-intent classification.

Each phase is a branch, reviewed and merged before the next begins. If time runs
out, Phase 1 is a complete, standout submission on its own, and Phases 2 and 3
are honestly labelled as designed-but-not-yet-built in the write-up.

## What could go wrong, and the answer

- **The judge and the feature are both models and share blind spots.** Keep
  deterministic checks (non-empty, changed, not truncated, HTTP status) as the
  first gate, and keep periodic human spot-checks. The model is for the class of
  bug only a reader can see.
- **Flaky visual diffs.** Fixed viewport, disabled animations, masked dynamic
  regions, and a tuned threshold. Treat a diff as a candidate, not a verdict.
- **A green check that stopped exercising anything.** The FIXED classification
  explicitly guards against this by requiring the assertion to still resolve its
  target.
- **Scope creep.** The phase gates. Phase 1 is allowed to ship without Phases 2
  and 3.

## Git workflow for this work

Small branches, descriptive commits, reviewed merges, kept local. `main` holds
the reviewed baseline; each phase lands through its own `feat/*` branch with a
merge commit that records what shipped. No force pushes, no history rewriting on
`main`, and nothing is pushed to a remote without an explicit decision to do so.
