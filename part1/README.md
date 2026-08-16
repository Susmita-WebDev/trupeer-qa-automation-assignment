# Part 1 - Exploratory Testing & Bug Reporting

A short, hands-on exploration of `app.trupeer.ai` as a real user would - sign up,
record a video with a script, use the editor and the AI features - and the issues
that surfaced, with reproducible evidence.

## Contents

| File | What it is |
| :--- | :--- |
| [`bugs.md`](bugs.md) | The bug report: functional issues found while using the product, each with steps to reproduce, expected vs. actual, severity, and evidence. Includes non-bug observations and product suggestions. |
| [`evidence/`](evidence/) | A folder per finding, with the screenshots referenced from `bugs.md`. Each has its own short README showing the images inline. |
| [`security-review.md`](security-review.md) | **Beyond the ask.** A passive, non-destructive security review (response headers, client-bundle secret scan). Kept separate from the functional report. |
| [`test-charter.md`](test-charter.md) | The exploratory testing charter: what was in scope, the areas covered, and how the session was structured. |

## The headline findings

- **BUG-1** - "Modify Script with AI" applies no content moderation to prompts or output (trust & safety).
- **BUG-2** - a whitespace-only prompt is accepted and spends an AI call rewriting the script (input validation).
- **BUG-3** - the free-tier limit is bypassable: email verification is satisfied by disposable inboxes (business-logic / anti-abuse).

Plus a Low asset-hygiene bug, two verified developer-level observations (an
app-level error on editor load, ungraceful degradation when a third-party script
is blocked), and product suggestions.

The security review adds header-hygiene findings (a CSP that does not restrict
scripts, framework disclosure) and, importantly, a set of **passed** checks - no
secrets leaked, no source maps exposed, captcha enforced - because what you checked
and got right is part of the report too.

## How the findings connect to the rest of the submission

- The functional bugs shaped the Part 2 tests (e.g. the whitespace-prompt bug
  became a negative test) and the Part 3 rubric (content quality, coherence).
- The security header checks are codified as reusable probes in
  [`qa-system/src/checks/security.js`](../qa-system/src/checks/security.js).
