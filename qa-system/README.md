# QA System: a suite with memory and judgment

This is the layer that ties Parts 1 to 3 together and makes the submission stand
out. A normal suite answers "did the assertions pass today". This one answers
"what changed since last time, is it a fix or a regression, and why".

The full rationale, research, and phased plan are in the repo-root
[`PLAN.md`](../PLAN.md). This README is how to run it.

## What it does

- **Remembers every run.** Each run writes a JSON snapshot plus its evidence
  (Playwright trace, screenshots, console, network). Nothing is overwritten.
- **Classifies change.** Comparing this run to the last, every check is one of:
  `stable`, `regression`, `fixed`, `still-broken`, `suspicious-pass`, `new-bug`.
- **Explains regressions.** When a check flips from pass to fail, it diffs the
  last-passing evidence against the current evidence (new console errors, HTTP
  status changes, vanished requests, missing selectors, timing) and asks the
  strong model for the most likely cause, anchored to that evidence.
- **Guards against fake fixes.** A previously-failing check that now passes is
  only reported as `fixed` if its assertion still exercised its target. If the
  element it looked for vanished, the green is `suspicious-pass` and goes to
  review, not celebration.
- **Routes models by cost.** Judgment and triage go to the strong model
  (Claude); screenshot and layout work go to a cheap vision model (Gemini Flash,
  about 20x cheaper per image). A missing key disables that route and logs it.
- **Produces a self-contained HTML report** with screenshots, opened
  automatically, regressions first.

## Architecture

```
part2 page objects ─┐
                    ├─► checks/ ──► runner ──► snapshot ─┐
security (HTTP)  ───┘                                    │
                                                         ▼
        previous snapshot ──► ledger/classify ──► comparison
                                                         │
                       triage/ (regression cause) ◄──────┤
                       triage/ (fix intent)       ◄──────┤
                                                         ▼
                                          report/ (HTML) ──► auto-open
                                                         │
                                          ledger/ (persist memory)
```

| Module | Responsibility |
| :--- | :--- |
| `src/ledger/` | The memory: classification (pure), persistence, run comparison. |
| `src/evidence/` | Evidence bundle type and the pure diff that feeds triage. |
| `src/checks/` | Check framework and the concrete functional / performance / visual / security checks. |
| `src/triage/` | Strong-model regression root-cause and fix-intent judgment. |
| `src/models/` | Provider router: strong (Claude) and vision (Gemini) behind one interface. |
| `src/report/` | Self-contained HTML report and auto-open. |
| `src/run.js` | The orchestrator. |

## Setup

```bash
# Part 2 first: it owns the Trupeer credentials and the saved browser session.
cd ../part2 && npm install && npx playwright install chromium
cp .env.example .env && npm run auth

cd ../qa-system
npm install
cp .env.example .env      # add ANTHROPIC_API_KEY, and GEMINI_API_KEY when you have it
```

## Running

```bash
npm run demo        # proves the pipeline with synthetic data, no app or keys needed
npm run run         # a full run against the live app (needs the Part 2 session)
npm run security    # just the read-only security probes against the public URL
```

A full `npm run run` executes, in order: functional checks, performance,
visual (pixel baseline + cheap-model layout sanity), AI script validation
(reusing Part 3's prompts and rubric), read-only security probes, and an opt-in
cross-browser smoke. It then compares against the last run, explains any
regression, updates the ledger, and writes and opens the report.

`npm run security` is fully self-contained and needs no login, no browser, and
no key. It is the quickest way to see the system do real work.

`npm run demo` is the fastest way to see what the system does: it builds a
previous run and a current run containing a regression, a genuine fix, a
suspicious pass and a new bug, then runs the real classification, evidence diff,
ledger update and report generation, and writes an HTML report. A committed
example is at [`sample/sample-report.html`](sample/sample-report.html).

## Environment variables

Trupeer credentials come from `part2/.env`. `qa-system/.env` adds:

| Variable | Required | Purpose |
| :--- | :--- | :--- |
| `ANTHROPIC_API_KEY` | for triage / judging | Strong model. Ledger and report run without it. |
| `STRONG_MODEL` | no | Defaults to `claude-opus-5`. |
| `GEMINI_API_KEY` | for cheap vision | Optional. Falls back to the strong model when absent. |
| `VISION_MODEL` | no | Defaults to `gemini-2.5-flash`. |
| `TARGET_URL` | no | Public URL for security probes. Defaults to `https://app.trupeer.ai`. |
| `OPEN_REPORT` | no | `1` to auto-open the report. |
| `HEADED` | no | `1` to watch the browser. |
| `AI_PROMPTS` | no | Comma-separated Part 3 prompt ids to validate. Defaults to `concise`. |
| `CROSS_BROWSER` | no | `1`, or `firefox,webkit`, to run the cross-browser smoke. Off by default. |

## The memory on disk

- `state/ledger.json` - the persistent list of known bugs and their history.
  Committed, so the product's bug history is readable as text and diffed in PRs.
- `runs/` - per-run snapshots, traces, screenshots and generated reports.
  Gitignored (they are large and reproducible); `runs/reports/latest.html` is
  always the most recent report.
- `baselines/` - committed visual baselines for screenshot regression.

## Safety and ethics of the security checks

Every security probe is **read-only and runs against our own account**. It
inspects response headers, cookie flags, and client-delivered assets for
misconfigurations, following the OWASP Web Security Testing Guide. It does not
inject payloads that persist data, does not brute force, does not load-test, and
never touches another tenant. Findings are reported for remediation, not
exploited.
