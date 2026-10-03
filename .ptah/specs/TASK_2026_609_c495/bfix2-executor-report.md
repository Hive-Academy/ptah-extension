# B-FIX-2 executor report — TASK_2026_609_c495 (Part B review, finding 2)

**Verdict**: DONE. Restore no longer unlinks `{ws}/.claude/agents/<slug>.md` once it has been published. All checks pass.

## Files

- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-609-subagent-setup\libs\backend\agent-generation\src\lib\services\user-layer\user-layer-seed-quarantine.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-609-subagent-setup\libs\backend\agent-generation\src\lib\services\user-layer\user-layer-seed-quarantine.spec.ts`

No other files were touched: not harness-sync, not skill-synthesis-ui, not shared types.

## Change

- `placeExclusive(tmp, dest)` no longer takes the `'remove-partial' | 'keep-dest'` parameter and never unlinks anything. It returns `ExclusivePlacement = 'placed' | 'exists' | { copyFailed: Error }`:
  - The `COPYFILE_EXCL` fallback failure (other than EEXIST) is now returned as `{ copyFailed }` instead of being thrown, so callers can tell "dest may be partial" apart from a link failure, where dest was never created. A link error other than EEXIST or "unsupported" still throws, as before.
  - The `'remove-partial'` branch (`unlink(dest)`, formerly ~:1059) is deleted.
- `copySnapshotToSource` now also receives `snapshot.file`:
  - The temporary snapshot is still verified **before** publication (unchanged).
  - Copy fallback failed: returns `conflict`, `path: dest`, with a reason that names the error, `dest` ("may hold an incomplete copy and was kept") and the complete snapshot path in history.
  - After publication, if `dest` does not hold the snapshot bytes: returns `conflict`, `path: dest`, with a reason saying dest was kept and naming the snapshot path. This replaces the old `removeOwnDest(dest)` plus `copy-failed` (formerly ~:900).
  - `exists` handling is unchanged (`compareExisting`, so `already-restored` or `conflict`).
- `removeOwnDest` (formerly ~:927) had no caller left and is deleted.
- Quarantine rollback `putBack` behaves as before. It never unlinks, and its warn message and `false` return are byte-for-byte the same text. It now maps `{ copyFailed }` to the same "may hold an incomplete copy" reason it previously built from the thrown error.
- The marker and journal readers are untouched. `QuarantineRestoreResult` and its shape are unchanged.

## Result state used

`'conflict'`, an existing member of `QuarantinedAgentRestoreOutcome` (`libs/shared/src/lib/types/rpc/rpc-skill-clone.types.ts:345-351`). No new state was added. `path` is the destination, and `reason` carries both paths.

## Spec cases (`user-layer-seed-quarantine.spec.ts`, `os.homedir()` mock kept)

- **Changed because the old expectation was the unsafe unlink**: `'a fallback copy that fails verification is removed, and the retry succeeds'` became `'B-2a: a fallback copy that fails verification is kept as a conflict, never unlinked'`. The old test expected `copy-failed`, dest removed, and the retry `restored`. Now it expects `conflict`, the reason naming the snapshot, dest kept with the `TRUNCAT` bytes, the history snapshot still `VIDEO`, no temp left, and a retry that reports `conflict` with dest unchanged.
- **New** `'B-2a: a replacement written at dest after the link survives, and Restore reports a conflict'`. The real link runs, then another writer unlinks dest and writes `EDITOR REPLACEMENT`. Expected: `conflict`, the replacement survives, the snapshot is intact, and no temp is left.
- **New** `'B-2a: link unsupported and the fallback copy fails: dest is not unlinked, history intact, conflict names both paths'`. Link fails with EPERM. The copy writes a partial `VID` and then throws EIO. Expected: `conflict`, the reason contains EIO, dest and the snapshot path, dest still `VID`, the snapshot `VIDEO`, and no temp left.
- No other Restore spec changed. The EEXIST race, the failed-link (EIO, dest never created, so `copy-failed` and the retry succeeds), the EPERM fallback success, and the rollback re-review #1 specs pass unchanged.

## Checks (tailed)

- `npx nx run-many -t typecheck,lint -p @ptah-extension/agent-generation`: lint OK, typecheck OK, "Successfully ran targets typecheck, lint" (cache 0/2, so both really ran).
- `npx nx test @ptah-extension/agent-generation --maxWorkers=2`: Test Suites 36 passed of 36; Tests 1251 passed, 1 skipped (pre-existing), 1252 total.
- `--testNamePattern="B-2a"`: 3 passed, which confirms the new and changed cases ran.
- The Nx Cloud 401 notice (org plan disabled) is unrelated to this change.

## Plan deviations

None. Note: the `exists` race after the dest check still returns `copy-failed` when dest disappears again before the comparison. That path never unlinks and was left as it was.

## Out-of-scope observations

None.
