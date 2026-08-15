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
| 1 | Editor requests `video/fonts/manifest.json`, which returns 404 Not Found | Video editor / asset loading | Low |
| 2 | "Modify Script with AI" accepts a whitespace-only prompt and rewrites the script | Editor / Modify Script with AI | Low / Medium |
| 3 | "Modify Script with AI" has no content moderation (profanity / harmful content) | Editor / Modify Script with AI | Medium |
| 4 | | | |
| 5 | | | |

---

## BUG-1 - Editor requests `video/fonts/manifest.json`, which returns 404 Not Found

**Severity:** Low
**Area:** Video editor / asset loading
**Reproducibility:** *(fill in: appears to be Always - it is a static request on the editor page)*

### Steps to reproduce

1. Sign in at app.trupeer.ai and open a video in the editor
   (`app.trupeer.ai/content/<id>/video/edit`).
2. Open DevTools (F12) and go to the **Network** tab. Filter to All or Fetch/XHR.
3. Observe the request to `.../content/<id>/video/fonts/manifest.json`.

### Expected

Every resource the application requests should either exist and return 200, or
not be requested at all. A page should not fire a request for an asset the server
does not serve.

### Actual

`GET https://app.trupeer.ai/content/<id>/video/fonts/manifest.json` returns
**404 Not Found**. The request is highlighted as failed in the Network tab.

### Impact

Low. The individual font files (geist, cousine) appear to load normally and the
editor is usable, so this does not visibly break functionality. But it is a real
broken request: a wasted round trip on every editor load, noise in the product's
own error monitoring, and a symptom of a misconfigured font or asset path. If the
manifest were actually required, font styling could silently fall back without a
clear failure.

### Evidence

Screenshots in [`evidence/manifest-404/`](evidence/manifest-404/): the Network
tab 404 (`network-404.png`) and the Console 404 (`console-404.png`).

- Request URL: `https://app.trupeer.ai/content/<id>/video/fonts/manifest.json`
- Request Method: GET
- Status Code: 404 Not Found

### Notes

Check the **Console** tab for a matching error message, and confirm whether the
fonts still render correctly despite the 404 (they appear to). Replace `<id>`
with your actual content id when you attach the screenshot.

---

## BUG-2 - "Modify Script with AI" accepts a whitespace-only prompt and rewrites the script

**Severity:** Low / Medium
**Area:** Video editor / Modify Script with AI ("Rewrite with AI")
**Reproducibility:** Always (observed)

### Steps to reproduce

1. Sign in at app.trupeer.ai and open a video in the editor.
2. Open the "Modify Script with AI" / "Rewrite with AI" box.
3. Type only spaces into the prompt field (no actual instruction). The character
   counter shows the spaces as valid input (for example "16/300").
4. Click **Rewrite script**.

### Expected

A prompt that contains only whitespace has no instruction in it, so it should be
treated as empty and rejected: the input should be trimmed, and with no real text
the **Rewrite script** button should be disabled, or a validation message should
ask for an instruction. Standard behaviour is to not send an empty request to the
AI.

### Actual

The whitespace-only prompt is accepted. The character counter counts the spaces
as valid characters (16/300) and the **Rewrite script** button stays enabled.
Clicking it sends the request and the AI rewrites the entire script anyway, then
shows the "Keep changes / Discard changes" bar. The app does not trim whitespace
or validate that the prompt contains an actual instruction.

### Impact

Low / Medium. From the user's side, no validation message or warning is shown at
all: the app silently accepts the blank instruction and jumps straight to the
Keep changes / Discard changes bar, as if a normal prompt had been given. The
user gets an unpredictable rewrite with no instruction given, which is confusing,
and it spends a real (paid) AI call on a meaningless request. It is not data
loss, since the change can be reverted with Discard, but it is a genuine
input-validation gap on the product's core AI feature. This is exactly the
empty-prompt negative case the assignment highlights.

### Evidence

Before and after screenshots in [`evidence/empty-prompt/`](evidence/empty-prompt/):
- `before.png` - the Rewrite with AI box with only whitespace typed, counter at
  16/300, Rewrite script button enabled.
- `after.png` - the script fully rewritten, with the Keep changes / Discard
  changes bar shown.

### Notes

The Part 2 negative test should assert this exact case: a whitespace-only prompt
should be rejected, not processed. See `part2/tests/05-modify-script-negative.spec.js`.

---

## BUG-3 - "Modify Script with AI" has no content moderation (generates profanity and harmful content on request)

**Severity:** Medium
**Area:** Video editor / Modify Script with AI
**Reproducibility:** Always (observed)

### Steps to reproduce

1. Sign in at app.trupeer.ai and open a video in the editor.
2. Open "Modify Script with AI" / "Rewrite with AI".
3. Ask it to rewrite the script inserting inappropriate content: profanity, and
   harmful / self-harm-themed wording (for example renaming the product to a
   self-harm-themed name).
4. Submit and observe the rewritten script.

### Expected

An AI content-generation feature in a commercial product should apply content
moderation. It should refuse or filter clearly harmful output such as profanity,
hate speech, and self-harm content, and warn the user rather than producing it,
especially because the generated video carries a "Made with Trupeer.ai" watermark
and can be published and shared.

### Actual

The feature complied with the requests. It generated and displayed a script
containing profanity and self-harm-themed content, with no filtering, no warning,
and no refusal. The unmoderated text was rendered directly into the editor and
narration.

### Impact

Medium. The lack of moderation is a brand, safety, and trust risk: harmful
content generated by Trupeer's own AI is embedded in shareable videos that carry
Trupeer branding. Self-harm content in particular is a sensitive category that
most AI providers filter by policy. This exposes the product to reputational and
potential policy or compliance issues.

### Evidence

Screenshot in [`evidence/content-moderation/`](evidence/content-moderation/)
(`rewrite-unmoderated.png`). *(The screenshot contains the flagged content by
nature; it is the evidence of the gap. Keep it with the private submission. The
report itself deliberately describes the content clinically rather than
reproducing it.)*

### Notes

One demonstration is sufficient evidence of the moderation gap; there is no need
to generate further or more severe harmful content to prove it. A reasonable fix
is to run AI outputs (and prompts) through a content-moderation filter and refuse
or flag disallowed categories.

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

Minor things noticed while using the product, kept separate from the bug list on
purpose. These are not counted as defects.

- **OBS-1: Transcript rendered a spoken proper noun inconsistently.** While
  recording the demo video I said the name "antester" (single t). The generated
  script rendered it as "anttester" / "Anttester" (double t) throughout. This may
  be down to my pronunciation rather than a fault in the product, so it is logged
  as an observation, not a bug. Still worth noting: for a tool whose core output
  is an accurate transcript, proper-noun accuracy is a reasonable quality bar.
  *Impact:* low. The transcript is easily hand-corrected in the editor.

- **OBS-2 (security / anti-abuse): Email verification is defeated by disposable /
  temporary email addresses.** Sign-up does send a verification email, but
  disposable temp-mail services receive that email fine, so verification does not
  actually prevent abuse. **Confirmed:** I verified and used multiple accounts
  this way, each getting its own fresh 3-video allowance, for effectively
  unlimited free videos. Why it matters: the free tier's 3-video limit is the
  boundary the free/paid model depends on, and it can be bypassed with zero cost.

  **How to reproduce (confirmed):**
  1. In another tab, open a disposable email service (for example temp-mail.org,
     mailinator.com, or 10minutemail.com) and copy the temporary address it gives.
  2. On app.trupeer.ai, sign up with that temporary address.
  3. Trupeer sends a verification email. Open the disposable inbox, click the
     verification link (the disposable service receives it without issue), and the
     account becomes active.
  4. Confirm you can fully use the account (reach the dashboard, record videos).
  5. Repeat with a second address (or a second Google account, an incognito
     window, or a different browser) to get another fresh 3-video allowance. These
     are the same low-effort vectors a real abuser would try; a single second
     account is enough proof, no virtual machine needed.

  **Severity (confirmed): Low / Medium.** Verification exists but is satisfied by
  disposable inboxes, so it does not stop the abuse. This is a confirmed,
  reproducible free-tier bypass. It does not break functionality, so it is
  reported as a security / business-logic finding rather than a functional bug:
  sign-up itself works as designed, but the anti-abuse control around it is
  ineffective.

- **OBS-3 (performance): Fonts are preloaded but not used, producing repeated
  console warnings.** On the editor page the console logs several warnings of the
  form: "The resource `<...>.woff2` was preloaded using link preload but not used
  within a few seconds from the window's load event. Please make sure it has an
  appropriate `as` value and it is preloaded intentionally." Multiple
  `_next/static/media/*.woff2` fonts are preloaded but not used promptly. Why it
  matters: preloading assets that are not used wastes bandwidth and can delay more
  important resources; it is a font-optimization (Next.js) misconfiguration.
  *Impact:* low, performance/best-practice. This is a warning, not an error, and
  does not break functionality. It is in the same area as BUG-1 (the font
  `manifest.json` 404): together they suggest the app's font loading is not fully
  configured.

*(Add other genuine observations here as you find them. Keep them honest and
labelled as observations, not padded into the bug count.)*

---

## Suggestions

Product improvement ideas from using Trupeer as a real user. These are not bugs;
they are the kind of thing a thoughtful tester surfaces alongside the report.

- **After export, return the user to the Library, not the main page.** Exporting
  a video from the Library shows a brief "exporting" indicator for about a second
  and then redirects to the main page, away from the Library where the video and
  its export live. Returning to (or staying in) the Library would keep the user
  oriented and let them see the exported result immediately, instead of having to
  navigate back to find it. *(Worth verifying first: confirm the exported file
  actually appears in the Library. If it does not, this stops being a suggestion
  and becomes a real bug, because the export would be failing silently.)*
- **Add a way to cancel an in-progress export.** Once an export is triggered
  there is currently no option to stop it. A cancel control would let a user who
  exported the wrong video, or changed a setting, back out without waiting for it
  to finish.
- **Harden the free tier against multi-account abuse (layered).** See OBS-2.
  Blocking disposable email domains is a sensible first step, but on its own it
  will not stop a determined user: the same free allowance can be claimed again
  with a second Google account, an incognito window, a different browser, or a
  virtual machine. Meaningfully closing the gap needs layered controls, for
  example a per-IP or per-device account-creation rate limit, device
  fingerprinting, or requiring a verified phone number or payment method before
  higher usage. Each carries a tradeoff worth weighing: device fingerprinting
  touches user privacy and can false-positive on shared or corporate machines, so
  the right level depends on how much this abuse actually costs Trupeer. The
  honest framing is "raise the effort required to abuse the free tier," not "make
  it impossible."

- **Coordinate AI voice gender with the AI avatar.** The AI voice selection and
  the AI avatar selection are independent, so a user can end up with a male voice
  on a female avatar (or the reverse), which looks wrong in the generated video.
  When a voice gender is chosen, the avatar could default to a matching gender,
  and vice versa. Keep it a smart default, not a hard lock: some users may
  deliberately want a mismatched pairing, so the coordinated default should still
  be overridable. This is a defaulting / UX-polish improvement, not a defect,
  since both controls work correctly on their own.

*(Add other real ideas here as you find them. One or two specific, well-argued
suggestions are worth more than a long generic list.)*

---

## Blockers encountered during automation

*(The assignment explicitly asks for this. If "Modify Script with AI" rate-limited
you, timed out, or errored while you were building Part 2 or 3, record it here
with the same rigour as a bug, and note how the tests were adapted - e.g. the
extended `AI_RESPONSE_TIMEOUT_MS`, or the settle-detection in
`EditorPage.waitForScriptToChange`.)*
