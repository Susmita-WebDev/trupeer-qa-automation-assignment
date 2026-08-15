# Part 1 - Bug Report

> **This file is a scaffold, not a submission.** Every bug below is a template to
> be replaced with something you actually reproduced. Delete any entry you did
> not observe yourself - an invented bug is worse than a short report.

## Environment

| | |
| :--- | :--- |
| **Application** | Trupeer.ai - https://app.trupeer.ai |
| **Build / date tested** | *(date of your session)* |
| **Browser** | *(e.g. Chrome 131.0.6778.86, 64-bit)* |
| **OS** | Windows 11 Home Single Language 24H2 |
| **Screen** | *(e.g. 1920×1080, 100% scale)* |
| **Account** | Free tier, *(N)* videos used |
| **Network** | *(e.g. home broadband, ~100 Mbps)* |

## Severity definitions

| Severity | Meaning |
| :--- | :--- |
| **Critical** | Data loss, or a core flow is completely blocked with no workaround. |
| **High** | A core flow is broken or badly degraded; workaround is painful or non-obvious. |
| **Medium** | A feature misbehaves but the user can complete the task another way. |
| **Low** | Cosmetic, or an edge case with minimal user impact. |

## Summary

| # | Title | Area | Severity |
| :--- | :--- | :--- | :--- |
| 1 | *(title)* | *(recording / editor / AI script / auth)* | *(severity)* |
| 2 | | | |
| 3 | | | |
| 4 | | | |
| 5 | | | |

---

## BUG-1 - *(one-line title: what breaks, where)*

**Severity:** *(Critical / High / Medium / Low)*
**Area:** *(e.g. Video editor → Modify Script with AI)*
**Reproducibility:** *(Always / Intermittent - N of M attempts)*

### Steps to reproduce

1. *(Start from a named state - "Sign in at app.trupeer.ai", not "open the app")*
2. *(One action per step. Include the exact text you typed and the exact button you clicked.)*
3.
4.

### Expected

*(What should happen, and why you believe that - the product's own UI copy, a
tooltip, or standard behaviour for this kind of control.)*

### Actual

*(What happened instead. Quote error text verbatim. Note whether anything
appeared in the browser console or the network tab - a 500 on a specific
endpoint turns a vague report into an actionable one.)*

### Impact

*(Who is affected and what it costs them. This is what drives the severity, so
state it rather than leaving it implied.)*

### Evidence

*(Screenshot / screen recording / console output / failing request. Put files in
`part1/evidence/` and link them: `![](evidence/bug-1-console.png)`)*

### Notes

*(Anything that narrows it down: only on first load, only after a page refresh,
only with scripts over N characters, recovers after a reload, etc.)*

---

## BUG-2 - *(title)*

**Severity:**
**Area:**
**Reproducibility:**

### Steps to reproduce

1.

### Expected

### Actual

### Impact

### Evidence

---

## BUG-3 - *(title)*

**Severity:**
**Area:**
**Reproducibility:**

### Steps to reproduce

1.

### Expected

### Actual

### Impact

### Evidence

---

## BUG-4 - *(title)*

**Severity:**
**Area:**
**Reproducibility:**

### Steps to reproduce

1.

### Expected

### Actual

### Impact

### Evidence

---

## Observations that are not bugs

*(Optional but worth keeping - friction points, confusing copy, or things you
expected to exist and did not. Labelled honestly as observations rather than
padded into the bug list.)*

---

## Blockers encountered during automation

*(The assignment explicitly asks for this. If "Modify Script with AI" rate-limited
you, timed out, or errored while you were building Part 2 or 3, record it here
with the same rigour as a bug, and note how the tests were adapted - e.g. the
extended `AI_RESPONSE_TIMEOUT_MS`, or the settle-detection in
`EditorPage.waitForScriptToChange`.)*
