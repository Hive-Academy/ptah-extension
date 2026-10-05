# A-FIX-3 executor report — retirement fails closed on unreadable regular files

Source: batches.md `### A-FIX-3`; code-logic-rereview.md `### F1. Blocking`.

## Files

- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-609-subagent-setup\libs\backend\harness-sync\src\lib\targets\artifact-retirement.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-609-subagent-setup\libs\backend\harness-sync\src\lib\targets\artifact-retirement.spec.ts`

`content-hash.ts` was not touched, so source-discovery hashing (including the `unreadable` sentinel at `content-hash.ts:316`) is unchanged. `harness-reconciler.retire-local-edit.spec.ts` did not need changes. No new files.

## Change

The retirement-only coverage walk, `isFullyHashable`, now reads every regular file it meets. It calls the new private helper `isReadableFile`, which does a full `readFile` from `fs/promises` and discards the bytes. Any read failure makes the walk return `false`. When the walk returns `false`, `isProvablyUnchanged` also returns `false`, so `retireOwnedArtifact` keeps the detached tree as the snapshot (`removed-local-edit`) and never reaches the `rm` of the stamp directory.

A matching hash no longer counts as proof when the recorded digest and the re-hashed digest both carry the sentinel. Unreadable directories were already rejected by the `readdir` catch; that behaviour is unchanged and now has a test. The function doc comment explains the sentinel case. The `catch` carries the module's `degradation-audit: optional-capability` annotation.

Single-file retirements needed no change. `hashFile` returns `null` when the file cannot be read, and `null` never equals a recorded string hash.

Cost: one extra read per regular file, only during the retirement of a directory whose hash already matched.

## Spec cases (new `describe('F1 (re-review): unreadable entries are never proof')`)

Each test makes one path unreadable with a path-filtered `jest.spyOn(jest.requireActual('fs/promises'), 'readFile' | 'readdir')`. Every other path passes through to the real filesystem, which makes the tests deterministic on Windows. The spy pattern follows the existing precedent at `harness-reconciler.retire-local-edit.spec.ts:507-519`.

1. **Unreadable regular file, sentinel-bearing recorded hash ⇒ tree preserved.** `notes.md` is denied before the owned hash is taken, so that hash already contains the sentinel; the test asserts `hashFile(notes.md)` is `null`. It then retires the skill and checks:
   - the outcome is `removed-local-edit` and the original path is gone;
   - the snapshot still holds `notes.md`, `SKILL.md` and `refs/guide.md` with their original bytes.
2. **Unreadable directory ⇒ preserved.** `refs` is denied for `readdir`, and the hash skips it both times, so the hashes match. The test asserts `removed-local-edit` and that `refs/guide.md` is kept in the snapshot.

Mutation check: with the new `isReadableFile` line disabled, case 1 fails (`Tests: 1 failed, 21 passed`). The source was restored afterwards; the restore was verified with a grep.

## Checks

`npx nx run-many -t typecheck,lint -p @ptah-extension/harness-sync`:
```
√  nx run @ptah-extension/harness-sync:lint
√  nx run @ptah-extension/harness-sync:typecheck
Successfully ran targets typecheck, lint for project @ptah-extension/harness-sync
```

`npx nx test @ptah-extension/harness-sync --maxWorkers=2 --testPathPatterns=artifact-retirement`:
```
Test Suites: 1 passed, 1 total
Tests:       22 passed, 22 total
```

`npx nx test @ptah-extension/harness-sync --maxWorkers=2`:
```
Test Suites: 6 failed, 50 passed, 56 total
Tests:       18 failed, 527 passed, 545 total
```

All 18 failures are the known baseline, and there are no new failures:

| Spec | Failures |
| --- | --- |
| agent-consent | 2 |
| skill-consent | 7 |
| gitignore E23 | 5 |
| cancellation B8 | 2 |
| write-failure E21 | 1 |
| capability-policy C3 (also fails on main) | 1 |

None of the failing suites is `artifact-retirement` or `retire-local-edit`.

## Plan deviations

None.

## Out-of-scope observations

None.
