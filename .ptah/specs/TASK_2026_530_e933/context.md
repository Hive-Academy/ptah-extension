# Context — degradation-audit fails on tracked-but-deleted files

Filed 2026-09-22 after it blocked two sessions' commits in the shared main
checkout. Diagnosed by the TASK_2026_523 session, confirmed independently, and
filed here at its request so it could be written up properly rather than thinly
between batches.

## The failure

`tools/degradation-audit/check-degradation.ts` enumerates git-tracked paths and
opens each one **without checking that it exists on disk**. A file that is
tracked at HEAD but absent from the working tree throws:

```
degradation-audit FAILED: ENOENT: no such file or directory, open
'...libs/frontend/chat-ui/src/lib/molecules/setup-plugins/plugin-browser-modal.component.ts'
```

That fails the `degradation-audit:lint` target, which fails
`nx affected --target=lint`, which fails the husky pre-commit hook.

## Why it matters more than it looks

The blast radius is the whole checkout, not the offending file:

- **Every session committing in that checkout is blocked**, not just the one
  that deleted the file. Observed: a marketplace refactor deleted three
  components as intended, and an unrelated TASK_2026_523 batch commit failed
  twice as a result.
- **60 of 60 other lint tasks passed.** Only this one failed, so the signal
  points at the deleted file rather than at the tool.
- **The error names the deleted file, not the tool's assumption**, so the
  natural reading is "someone broke a file" rather than "the audit cannot
  tolerate an in-progress deletion".
- Every normal mid-refactor state triggers it: an unstaged `rm`, a half-finished
  rename, a partially staged refactor.

The pressure it creates is the real cost. A blocked session's cheapest exit is
`--no-verify`, which bypasses every other gate too. Both sessions here declined
on the grounds that authorizing a gate bypass is a user's decision rather than
an agent's — but that is a judgement call the tool should not be forcing.

## Fix

A one-line existence check before opening: skip tracked paths that are not
present on disk. A deleted file has no content to audit, so skipping is the
correct semantic and not a suppression.

## Test case

1. Delete a tracked file. Do not stage the deletion.
2. Try to commit anything at all, anywhere in the repo.

Before: the pre-commit hook fails with ENOENT naming the deleted file.
After: the audit skips it and the commit proceeds on its own merits.

## Out of scope

Whether the audit should *report* tracked-but-missing files as a finding. It
should not — that is `git status`'s job, and conflating "this file has a
degradation" with "this file is mid-deletion" is how the current bug reads to a
user. Skip silently.
