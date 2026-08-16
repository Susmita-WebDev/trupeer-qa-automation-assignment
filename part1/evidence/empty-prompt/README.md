# Evidence: BUG-4 - whitespace-only prompt is accepted and rewrites the script

A prompt of only spaces (16/300 characters) is accepted, and the AI rewrites the
whole script instead of rejecting the empty instruction.

## Before - whitespace typed, Rewrite button enabled

![Rewrite with AI box with only whitespace typed, the counter reading 16/300, and the Rewrite script button enabled](before.png)

## After - the script is rewritten anyway

![The script fully rewritten, with the Keep changes / Discard changes bar shown](after.png)
