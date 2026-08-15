# QA Engineer Assignment

**Estimated time:** 2–3 days  
**Tools:** You're encouraged to use AI coding assistants (Claude Code, Copilot, Cursor, etc.) to accelerate your work. Part 3 also requires using LLM APIs as part of the test infrastructure itself — not just for writing code, but as a component in your tests. We care about the quality of the output and your ability to reason about what's being tested — not whether you typed every line by hand. That said, we will ask you to walk through your code and decisions in the follow-up interview.

---

## Before You Start

- **Account:** Create a free account on [Trupeer](https://app.trupeer.ai). Free accounts have a limit of 3 videos, so use them wisely — you only need one video for the automation parts. **Important:** When you record your video, make sure to record with your microphone enabled so that Trupeer generates a transcript/script. The automation parts depend on having a script to work with.  
- **LLM API access (Part 3):** You'll need access to any LLM API (Claude, GPT, Gemini, etc.). If you don't have an API key, Gemini and Claude both offer free API tiers that are sufficient for this assignment. Alternatively, you can use a local model via Ollama.  
- **Submit everything in a single GitHub repo** (or zip). Use folders to separate each part (e.g. `part1/`, `part2/`, `part3/`). Include a top-level README explaining how to run everything.

---

## Part 1 — Exploratory Testing & Bug Reporting (\~30 mins)

Spend 30 minutes using Trupeer as a real user would — sign up, record a short screen capture (with mic enabled), explore the editor, try different features.

**Submit (in `part1/`):**

- A bug report (`bugs.md` or `bugs.pdf`) with **3–5 issues** you found. For each bug include:  
  - Steps to reproduce  
  - Expected vs. actual behaviour  
  - Severity: Critical / High / Medium / Low  
  - Browser and OS info

---

## Part 2 — E2E Test Automation with Playwright/any other framework (\~4–6 hours)

Write a Playwright/any other framework test suite that covers these Trupeer flows. Your tests should use the account you created in Part 1 (which already has a video with a script).

1. **Login** — Verify the user can log in and lands on the dashboard.  
2. **Navigate to the editor** — Open an existing video and verify the editor page loads correctly with its key elements (timeline, preview, script panel).  
3. **Modify Script with AI** — Use the "Modify Script with AI" button on the video edit page: send a prompt (e.g. "Make this script more concise") and verify that a modified script is returned and displayed in the UI.  
4. **Editor interaction** — Pick any one other editor feature (e.g. zoom block, background change, trim) and verify it applies correctly.

**Requirements:**

- Page Object Model (or equivalent) to separate selectors from test logic.  
- At least one negative test (e.g. submitting an empty prompt to "Modify Script with AI", or an extremely long prompt).  
- Runnable with a single command (`npx playwright test`). Include a README with setup steps and any environment variables needed (e.g. login credentials should be read from env vars, not hardcoded).  
- Explicit waits over hard-coded sleeps. Meaningful assertion messages.

**Note:** If you encounter issues with the "Modify Script with AI" feature (rate limits, errors, etc.), document them as bugs in your Part 1 report and adapt your tests accordingly — testing how you handle unexpected blockers is part of the evaluation.

**Submit (in `part2/`):** The full Playwright project with `package.json`, config, and tests.

---

## Part 3 — AI-Augmented Testing (\~2–3 hours)

This is where we want to see how you think about AI as a testing tool — not just using AI to write code faster, but embedding LLM calls *into the test infrastructure itself*. You can (and should) reuse your Part 2 page objects, login flow, and utilities rather than rebuilding from scratch.

Trupeer's "Modify Script with AI" feature takes a user prompt and rewrites the video script accordingly. The output is non-deterministic — there's no single correct answer to assert against with a simple string match.

Build an end-to-end script that:

1. Uses Playwright to log in, navigate to a video's edit page, and capture the original script.  
2. Sends a variety of prompts to "Modify Script with AI" (e.g. "Make this more professional", "Add a call to action at the end", "Translate to Spanish") and captures each AI-modified output from the UI.  
3. For each prompt, calls an LLM API with the original script, the prompt, and the AI output, along with a structured validation rubric — e.g.:  
   - "Does the modified script reflect the intent of the user's prompt?"  
   - "Is the output coherent and grammatically correct?"  
   - "Does it preserve the core information from the original?"  
   - "Is it a meaningfully different output from the original, not just a trivial rewording?"  
4. Parses the LLM's structured JSON response (with per-criterion pass/fail and a confidence score) and outputs a clear results summary (pass/fail per prompt, overall score).

**Submit (in `part3/`):**

- The script, runnable with a single command (e.g. `npm run validate` or `npx ts-node validate.js`)  
- A README with setup instructions (env vars for credentials and LLM API key)  
- Output from a sample run showing results for at least 4 different prompts  
- A brief note (half a page max): What confidence threshold would you set before gating CI on this? How would you handle cases where the LLM judge disagrees with a human reviewer?

---

## Evaluation Criteria

| Area | Weight | What we're looking for |
| :---- | :---- | :---- |
| **Bug reporting** (Part 1\) | 20% | Clear repro steps, correct severity, functional over cosmetic |
| **E2E automation** (Part 2\) | 40% | Clean POM structure, reliable selectors, proper waits, easy to run |
| **AI-augmented testing** (Part 3\) | 40% | End-to-end working script, thoughtful rubric design, practical CI/confidence analysis |

---

## Do's and Don'ts

**Do:**

- Explore Trupeer like a real user before writing tests — understand the product first.  
- Document bugs with clear steps to reproduce, expected vs. actual behaviour.  
- Write tests that someone else can clone, install, and run without hand-holding.  
- Think beyond happy paths — network failures, permission denials, unusual inputs.  
- In Part 3, be honest about what worked and what didn't. A thoughtful write-up about a partially working approach is worth more than a polished demo that you can't explain.

**Don't:**

- Don't only report cosmetic glitches — prioritise functional issues.  
- Don't submit code you can't walk through and explain in the interview.  
- Don't skip repro steps in your bug report — an unreproducible bug isn't useful.  
- Don't over-engineer — we'd rather see 3 solid tests than 15 flaky ones.  
- Don't hardcode credentials in your test code — use environment variables.

