# Context — pre-write offset guard doesn't restore on guard-2 branch

## Origin

`TASK_2026_173` Batch 9 register, item 13 of 17. Raised in `batch-8c-verification.md` §3. This is one
of the three items the Batch 9 dispatch names as "you will be tempted to fix — the file-not-fix rule
binds hardest here" (`restoreAfterFailedApply` is already imported and the restore point is already
captured; it is a single call). **Deliberately not fixed here.**

## Finding (from the register)

> The pre-write offset guard does not restore, so its "Nothing was changed" message is accurate about
> the tool's own actions but not about the file. 8C reached the guard under an adversarial concurrent
> write (the TOCTOU window internal to one `applyHunks` call) and found the guard-2 branch returns
> directly without calling `restoreAfterFailedApply`, on the reasoning that `--check` is a dry run and
> nothing needs undoing. That reasoning holds for the service's own writes and **does not** hold for an
> external write landing in that exact window — which the guard provably can now observe. Guard 3's
> branch calls `restoreAfterFailedApply` unconditionally and its `read-tree`/bytes-rewrite erases
> concurrent sabotage as a side effect, so the two branches give different guarantees for the same class
> of message. **Not a corruption risk**: the tool never writes the user's selected hunk when this
> fires, and the leftover content is exactly what an external actor wrote.

## Why item 13 exists at all

Reaching guard 2 under this adversarial test is what exposed that its branch never calls
`restoreAfterFailedApply` — the finding and its discovery are the same event.

## Do NOT confuse this with the separate, CLOSED `--check` question

A related but distinct question — whether the `--check` dry-run step (guard 2's precondition) earns
its place at all, given it fails 0 of 28 tests when removed — was raised by 8A and **ruled RETAIN by
8C in `batch-8c-verification.md` §4**. That ruling is **CLOSED, not open**. `--check` is not
load-bearing for final-state correctness (guard 3 is a comprehensive backstop) but it eliminates the
window in which a real working-tree or index write exists in a transiently wrong state, observable by
a concurrently open editor or by Electron's own `.git/index` watcher. **Do not re-file that question,
and do not let a future reviewer delete `--check` as redundant.** This record is about guard 2's
_restore behaviour_, not its existence.

## Fix

Call `restoreAfterFailedApply` in the guard-2 branch too, using the `worktreeRestoreBytes` restore
point already captured earlier in the function — mirroring guard 3's unconditional call.

## Source

`TASK_2026_173/tasks.md` Task 9.3 register item 13; `TASK_2026_173/batch-9-dispatch.md` §4.2, §4.4;
`TASK_2026_173/batch-8c-verification.md` §3 (finding), §4 (the separate, closed `--check` ruling).
