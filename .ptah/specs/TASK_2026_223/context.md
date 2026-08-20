# Context — untested `applyInFlight` guard for a mid-await glyph click

## Origin

`TASK_2026_173` Batch 9 register, item 17 of 17 (the last item). Raised in `batch-8b-report.md` §7.6.
Filed per NFR-9.

## Finding (from the register)

> A glyph click landing mid-`await` inside `runApply` is guarded but not tested. `applyInFlight` guards
> it structurally and the token binding covers the refresh-then-click ordering, but only that ordering
> has a test; the click-during-RPC ordering has none. An untested guard is exactly the shape both
> Batch 7's regression guard and 8A's guard 6 proved can be vacuous.

## Why this matters

Two separate prior incidents in `TASK_2026_173` (Batch 7's regression guard, and 8A's "guard 6")
demonstrated that a guard which looks structurally correct can still be vacuous — i.e. never actually
exercised by any test, so a refactor can silently break it without any test failing. This finding
applies that same lesson to `applyInFlight`.

## Fix

Add a coordinator test that fires a second `applyHunks` while the first RPC promise is still pending
and asserts exactly ONE `git:applyHunks` call reaches the wire (i.e. the second click is a structural
no-op, not merely coincidentally harmless).

## Source

`TASK_2026_173/tasks.md` Task 9.3 register item 17; `TASK_2026_173/batch-9-dispatch.md` §4;
`TASK_2026_173/batch-8b-report.md` §7.6.
