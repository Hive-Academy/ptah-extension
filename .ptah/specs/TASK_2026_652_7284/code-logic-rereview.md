# Code Logic Re-review — Batch 16 (commit 678f0d632)

**Score:** 8/10
**Verdict:** APPROVED WITH FIXES (only Minor items; none block merge)
**Review family:** antigravity (implementer: codex)

Both specs pass: store 16/16, merge 5/5.

## Fix status

| ID                                       | Status | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L1 lock missing at release               | Closed | The store releases through `withFileLock` (`harness-proposal-store.service.ts:66`). Its `release()` uses `rmSync(path,{force:true})` inside try/catch (`file-lock.ts:216-221`), so a missing lock cannot throw. Test "completes a save when its lock disappears before release" deletes the lock during `rename`. The save completes and a restarted store reads it back (spec, added in diff).                                                                   |
| L2 store's own stale recovery removed    | Closed | `acquireLock` is deleted. The store only calls `serializeByKey` (`:63`) and `withFileLock` (`:66-85`). The store adds no new race. The harness-sync race stays as FU-1: `breakIfStale` check-then-`rmSync` (`file-lock.ts:200-203`) and release by path (`:218`).                                                                                                                                                                                                 |
| L3 prune survives bad files              | Closed | Each file has its own try/catch (`:166-190`). `SyntaxError` and schema-invalid records fall to the `!valid` branch. That branch deletes the file if its mtime is older than the cutoff (`:183-185`). Other errors (for example EACCES) are logged and the loop continues (`:186-189`). A failed `readdir` returns without throwing (`:152-158`). The test covers an old corrupt file (deleted), a recent corrupt file (kept) and an expired valid file (deleted). |
| L4 sessionId validated and trimmed first | Closed | `HarnessSessionIdSchema.parse` is the first statement in `save` (`:59`) and in `get` (`:90`). It runs before `requireRoot`, the hash (`:108`) and any filesystem access. The same trimmed id goes to the hash, the stored record (`:71`) and the read comparison (`:128`). The test checks that `' a '` and `'a'` resolve to one file, and that invalid ids create no directory.                                                                                  |
| L5 wait longer than stale                | Closed | `PROPOSAL_LOCK_STALE_MS = 10_000` and `PROPOSAL_LOCK_WAIT_MS = 12_000` (`:21-23`). Both are passed to `withFileLock` (`:82-85`).                                                                                                                                                                                                                                                                                                                                  |
| L7 explicit undefined keeps stored value | Closed | `withoutUndefined` is applied to persona, prompt, claudeMd, `enabledAgents` and `enabledTools` (`merge-harness-config-updates.ts:3-9` and following). It copies, so inputs are not mutated. A null cannot reach storage: `save` calls `HarnessProposalSchema.parse` (`:79`), which validates `configUpdates` with `HarnessConfigUpdatesSchema`. A failure throws before `write` (`:80`). Explicit `undefined` also disappears in the JSON round trip.             |

## Held-lock test

The test "rejects when another process holds the lock past the deadline" mocks `Date.now` to advance 1 s per call. It proves the timeout path only in part:

- The lock payload is `at = now+60s`, so it looks live until the mocked clock passes `real+70s`. `acquireFileLock` calls `Date.now` several times per loop, so the 12 s deadline is hit after about 4 iterations. At that point the clock is roughly 12 s ahead and well short of the 70 s needed to make the lock stale. The test therefore reaches `FileLockTimeoutError` for the right reason and asserts that no record is written.
- It does not prove the 12 s versus 10 s ordering (L5). Nothing asserts `WAIT > STALE`. Nothing exercises a lock that goes stale while the caller waits.
- The future `at` and the mocked clock are an artifact. The real wall time is 825 ms.
- The "recovers an expired lock" test uses `at = now-11s`, which is over the 10 s stale threshold, so it genuinely exercises recovery.

## New findings

1. **Minor — `harness-proposal-store.service.spec.ts` (held-lock test).** The test does not assert that the wait exceeds the stale window. Failure scenario: someone sets wait below stale and every spec still passes. Minimal fix: export the two constants, or add a test with a lock whose `at` is 9 s old that is recovered within one call.
2. **Minor — `harness-proposal-store.service.ts:63-85`.** Callers now see `ZodError` (invalid sessionId) and `FileLockTimeoutError` instead of the old `HarnessProposalLockError`. The class doc comment lists both (`:40-45`), but I did not check the handler or RPC layer for code that matches on the removed error type. The worst case is a generic error message at the RPC edge. Minimal fix: grep the handlers for `HarnessProposalLockError` and map `FileLockTimeoutError` to a user-facing retry message. The error-mapping side of the handlers was outside this commit and I did not read the handler files.
3. **Minor — `file-lock.ts:263` plus `:66-85`.** `withFileLock` waits up to 12 s while holding the in-process queue entry from `serializeByKey`. Failure scenario: a cross-process holder with a live lock blocks every in-process save for the same session for 12 s, and this may exceed the RPC timeout. This is unlikely, since the critical section is a single read and write. No fix is needed in this batch.

## Decisions

- **Held-lock test is accepted as proof of timeout rejection, not of L5.** Options: demand a real-clock test, or accept it with a note. I accepted it because the mocked clock does not hide a bug. It only compresses sleep time, and the lock payload is parsed from real JSON. Reversible: add the 9 s-old-lock test from finding 1.
- **FU-1 (harness-sync stale-lock race) is out of scope.** The store introduces nothing new. It now inherits the same behaviour as the other `withFileLock` callers.
- **I did not re-review the handler specs or frontend consumers.** They are outside this commit.
