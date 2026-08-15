# Part 3 - AI-Augmented Testing

An LLM judge embedded in the test infrastructure. Playwright drives Trupeer's
"Modify Script with AI" through several prompts; each rewrite is then graded by
an LLM against a structured rubric, and the run emits a pass/fail summary.

The problem this solves: "Make this more professional" has no correct answer to
string-match against. A conventional assertion can only check that *something*
came back. This harness checks whether what came back actually did what was
asked.

## Setup

```bash
# Part 2 first - Part 3 reuses its page objects and its saved session.
cd ../part2 && npm install && npx playwright install chromium
cp .env.example .env      # set the Trupeer credentials here

cd ../part3
npm install
cp .env.example .env      # add a GEMINI_API_KEY (free) or an ANTHROPIC_API_KEY
npm run validate
```

Part 3 signs into Trupeer itself if there is no saved session, so you do not have
to run Part 2 first - the two just share the same credentials in `part2/.env`.

## Environment variables

Trupeer credentials come from `part2/.env` (Part 3 loads it automatically).
`part3/.env` adds only the judge's configuration. The judge needs **at least one**
API key; it tries providers in order and uses the first that works, so if one
provider is unavailable it falls back to the other.

| Variable | Required | Purpose |
| :--- | :--- | :--- |
| `GEMINI_API_KEY` | one of the two | Free judge key: [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey). |
| `ANTHROPIC_API_KEY` | one of the two | Judge key (needs a small credit balance). |
| `JUDGE_PROVIDER` | no | Force `gemini` or `anthropic`. Otherwise the `anthropic` key is preferred, `gemini` is the fallback. |
| `GEMINI_MODEL` | no | Defaults to `gemini-2.5-flash`. |
| `JUDGE_MODEL` | no | `anthropic` model. Defaults to `claude-opus-5`. |
| `JUDGE_EFFORT` | no | `anthropic` only. `low`–`max`. Defaults to `high`. |
| `CONFIDENCE_THRESHOLD` | no | Below this, a verdict is advisory. Defaults to `0.75`. |
| `RESULTS_DIR` | no | Defaults to `results/`. |
| `HEADED` | no | `1` to watch the browser. |

## How it works

```
part2 page objects ──> capture.js ──> judge.js ──> report.js ──> results/
   (login, editor)      (Playwright)   (LLM judge)   (score)      (json + md)
```

| File | Role |
| :--- | :--- |
| `src/prompts.js` | The prompts under test, each with a plain-language *intent*. |
| `src/rubric.js` | The four criteria, as a Zod schema the judge must fill in. |
| `src/capture.js` | Drives Trupeer via Part 2's page objects. |
| `src/judge.js` | Calls the judge with structured outputs. |
| `src/report.js` | Turns verdicts into outcomes; writes console + JSON + Markdown. |
| `validate.js` | Orchestrates the run. |

## Rubric design

Four criteria, graded independently:

| Criterion | Catches |
| :--- | :--- |
| Reflects the prompt intent | The feature ignored what was asked. |
| Coherent and grammatical | The output is malformed or self-contradictory. |
| Preserves core information | An over-aggressive rewrite dropped real content. |
| Meaningfully different | A no-op: the original returned with two synonyms swapped. |

They are deliberately **orthogonal**. Intent-following can pass while
information-preservation fails (an over-eager summariser), and vice versa (a
faithful rewrite that ignored the instruction). Collapsing them into one "is this
good?" score would hide exactly the failures worth catching.

Every verdict requires **evidence** - a quote or concrete observation, whether it
passed or failed. A judge forced to cite something is meaningfully harder to talk
into a confident verdict it cannot support, and it makes every disagreement
auditable by a human afterwards.

The prompts vary in *kind*, not just wording: compression, tone shift, an
additive edit, translation, and an audience change. Four rephrasings of "make it
better" would all pass or all fail together and tell us nothing.

## Structured output

The judge's response is constrained to the rubric schema via `output_config.format`,
so there is no JSON parsing, no regex extraction, and no retry-on-malformed-output
loop. The shape is guaranteed by the API rather than hoped for.

```jsonc
{
  "reflectsIntent":  { "passed": true,  "confidence": 0.92, "evidence": "...", "reasoning": "..." },
  "coherent":        { "passed": true,  "confidence": 0.97, "evidence": "...", "reasoning": "..." },
  "preservesCoreInformation": { "passed": false, "confidence": 0.81, "evidence": "...", "reasoning": "..." },
  "meaningfullyDifferent":    { "passed": true,  "confidence": 0.88, "evidence": "...", "reasoning": "..." },
  "overallAssessment": "..."
}
```

## Outcomes

| Outcome | Meaning | Exit code effect |
| :--- | :--- | :--- |
| `PASS` | All criteria passed at or above the confidence threshold. | - |
| `FAIL` | At least one confident failure. | Exits 1. |
| `NEEDS REVIEW` | Only low-confidence failures, or a hedged pass. | - |
| `ERROR` | The rewrite or the grading could not complete. | - |

A low-confidence failure is never silently upgraded to a pass. The reasoning
behind the threshold and the CI gating policy is in [`NOTES.md`](NOTES.md).

## Output

`results/latest.json` and `results/latest.md` after every run, plus a
timestamped copy of each. The Markdown report includes the full original and
modified scripts per prompt, so a human reviewer can check the judge's work
without re-running anything.

A sample run is committed at [`results/`](results/).

## Honest limitations

- **Chained edits.** Trupeer rewrites the script in place and the free tier has
  no reliable revert. Each prompt is therefore graded against the script as it
  stood immediately *before* that prompt, not against the pristine original. The
  question asked of the judge - "did this edit do what was requested?" - stays
  valid, but the scripts drift over a run. The pristine version is recorded in
  the report so the drift is visible.
- **Shared failure modes.** The judge and the feature under test are both LLMs
  and may find the same plausible-but-wrong output acceptable. This is a real
  ceiling on the technique and an argument for permanent human spot-checks.
- **Not calibrated yet.** Agreement between this judge and human reviewers has
  not been measured. Until it is, these results inform; they do not gate.
- **Cost and time.** One run is five browser round trips against a live LLM
  feature plus five judge calls - a few minutes and a few cents. Fine nightly;
  too slow for a pre-commit hook.
