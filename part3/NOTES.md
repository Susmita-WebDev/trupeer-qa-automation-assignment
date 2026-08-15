# Confidence, CI gating, and judge–human disagreement

## What threshold would I gate CI on?

Not a single number, because "confidence" and "correctness" are different things.
The harness reports three outcomes, and only one of them fails the build:

- **FAIL** - at least one criterion failed with confidence ≥ **0.75**. Blocks CI.
- **NEEDS REVIEW** - every failure is low-confidence, or everything passed but
  the judge hedged. Does not block; goes to a human queue.
- **PASS** - all four criteria passed with confidence ≥ 0.75.

The rule that matters is the second one: **a low-confidence failure is never
silently converted into a pass.** That is the failure mode that makes an LLM
judge decorative - it goes green, everyone stops reading it, and it catches
nothing.

I would not gate a merge on this suite at all until I had run it ~50 times
against known-good and deliberately-broken outputs and measured its agreement
with human labels. Before that, it runs nightly and reports; it does not block.
Once I had that data, I would gate on the criteria with the highest measured
agreement (in my expectation, *meaningfully different* and *preserves core
information*, both of which are close to mechanical) and keep the more
subjective ones - *reflects intent* - advisory.

There is also a cheaper first line of defence that should gate before any LLM
does: deterministic checks. Output is non-empty, output is not byte-identical to
the input, output is not 10× the input length. Those catch the crashes and the
no-ops, cost nothing, and never flake. The judge is for the class of bug that
only a reader can see.

## What if the judge disagrees with a human reviewer?

Treat every disagreement as a **bug in the rubric until proven otherwise**, and
log it as a labelled example. Concretely:

1. Every judgement already carries `evidence` and `reasoning`, so a reviewer can
   see *why* the judge ruled as it did rather than arguing with a bare verdict.
2. Disagreements go into a small labelled set - the script pair, the prompt, the
   human verdict, the judge verdict. That set becomes the regression suite *for
   the judge*.
3. Diagnose which of three things went wrong:
   - **Ambiguous criterion.** Two careful people would also disagree. Fix the
     rubric wording, re-run the labelled set.
   - **Missing context.** The judge did not know something the human did (e.g.
     the product's house style). Put it in the system prompt.
   - **Genuine judge error.** Raise effort, or accept the error rate and keep
     that criterion advisory.
4. Track agreement per criterion over time. A criterion that sits below ~90%
   agreement with humans has no business gating a build.

The asymmetry matters: a **false FAIL** costs a developer ten minutes and mild
irritation; a **false PASS** ships a broken feature. So when tuning, I would
accept a higher false-failure rate to keep false passes near zero - which is
exactly what routing uncertain calls to NEEDS REVIEW rather than PASS does.

One caveat I would state plainly to the team: the judge and the feature under
test are both LLMs, and they share failure modes. Both may find the same
plausible-sounding-but-wrong output acceptable. That is a real ceiling on what
this technique can catch, and it is an argument for keeping periodic human
spot-checks in the loop permanently, not just during calibration.
