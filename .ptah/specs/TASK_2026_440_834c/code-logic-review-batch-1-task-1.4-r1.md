# Code Logic Review — `TASK_2026_440_834c`, Batch 1 Task 1.4, Revision 1

## Summary

| Metric              | Value                                |
| ------------------- | ------------------------------------ |
| Overall score        | 9/10                                  |
| Assessment            | APPROVED                              |
| Blocking issues       | 0                                      |
| Serious issues        | 0                                      |
| Moderate issues       | 1                                      |
| Minor issues          | 1                                      |

Scope reviewed: uncommitted diff under `libs/backend/persistence-sqlite` — `backup.service.ts` (+spec), `integrity/integrity-worker-protocol.ts` (+spec), `integrity/integrity-worker-backup.integration.spec.ts`, `src/index.ts`, `CLAUDE.md`. Files under `memory-curator`, `shared`, `rpc-handlers`, `thoth-runtime`, `cli-engine` were not opened — out of scope, owned by parallel Batch 4/5 reviews. `npx nx run-many -t test -p @ptah-extension/persistence-sqlite --parallel=1` was run: 29 suites / 393 tests passed, 9 native suites skipped (pre-existing `better-sqlite3` ABI mismatch, unrelated). No source was modified.

Revision 1 replaces the R0 existence-check design with a genuinely atomic publish: the worker copies into an exclusively-created (`openSync(..., 'wx')`) random staging file, validates it, then publishes with a no-overwrite `fs.linkSync(staging, dest)`. Collision detection is now the filesystem's own `EEXIST`, not two independent `existsSync` snapshots. This closes every finding from the prior review (B1/blocking, S1/serious, and both moderates). One new moderate observation and one minor documentation gap are noted below; neither blocks approval.

## Finding-by-finding

### B1 — Daily reuse can no longer trust a new crash-leftover partial — CLOSED

A file can only ever occupy a final name (`destPath`) via `linkSync(stagingPath, destPath)` at `integrity-worker-protocol.ts:709`, which runs only after `validation.verdict === 'ok'` (the `'corrupt'` and `'unavailable'` branches both `return` before reaching it — `:679-696`). There is no other write path to `destPath` anywhere in `performBackup`; `source.backup()` targets `request.stagingPath` exclusively (`:675`). A hard-killed worker therefore leaves, at worst, an orphaned staging file (`<dest>.<hex>.tmp`) — never a final — so the host's pre-dispatch `fs.existsSync(dest)` reuse check at `backup.service.ts:295` can only ever observe either nothing or a genuinely validated, atomically-published final.

The regression test `publishes one validated final and removes staging plus sidecars` (`integrity-worker-protocol.spec.ts:429-459`) pins the happy path with real `node:fs`, and the `it.each` pair at `:504-528` (`corrupt`/`unavailable`) pins that neither verdict ever leaves anything at `dest`. `backup.service.spec.ts:436-463` (`returns the daily winner without degradation when atomic publish loses the race`) confirms the host-side reuse path returns the actual winner bytes, not a placeholder.

Residual, correctly scoped and disclosed: a `daily` final written by the pre-Revision-1 direct-write code, mid-crash, on the exact calendar day of the upgrade, is structurally indistinguishable from a validated final and is trusted once. `backup.service.ts:26-27` and `CLAUDE.md:56-61` both name this exactly. This is a one-time, narrow, honestly-documented compatibility window, not the general silent-corruption hole the R0 review found — acceptable.

### S1 — The daily-name race is atomic across processes — CLOSED

Two processes racing the first `daily` backup of a day: both may pass the host's `existsSync` pre-check and both may successfully `openSync(stagingPath, 'wx')` (staging paths differ — each carries its own random hex, `backup.service.ts:329`), so both proceed to copy and validate independently. The race is decided at `linkSync(staging, dest)` (`integrity-worker-protocol.ts:709`): exactly one `linkSync` call can succeed at a given `dest` (`EEXIST` on the second, matched by `isAlreadyExistsError` at `:521-528`), and the loser's cleanup (`:711`) touches only its own `stagingPath` — the winner's `dest` is never read, opened, or unlinked by the loser.

Windows/NTFS semantics were verified: `real fs hard-link publish is no-overwrite and reports EEXIST on a second link` (`integrity-worker-protocol.spec.ts:578-591`) runs unconditionally (no `itPosix`/`itWindows` guard, unlike the two POSIX-only permission-mode specs at `:613,622,685`), and asserts the exact behaviour this fix depends on with the real `node:fs` on this platform.

Handle-lifecycle check requested in the prompt: the read-write validation connection (`openCopy`) is opened and closed entirely inside `validateCopy` (`:553-578`), including its `finally`-block `close()`, before `performBackup` ever reaches sidecar removal (`:698`) or the `linkSync` call (`:709`) — so the validation handle cannot hold a Windows sharing lock across the publish. Sidecar removal (`removeBackupSidecars`, `:530-539`) runs and is verified absent (`:699-706`) before the link, so no stray `-wal`/`-shm` file is a candidate for the hard link itself. The `source` (read-only) connection stays open until the outer `finally` (`:741-746`), but it references `dbPath`, not `stagingPath`/`destPath`, so it holds no lock relevant to the publish. `backup.service.spec.ts:436-463` and `integrity-worker-protocol.spec.ts:461-485` (`returns BACKUP_DESTINATION_EXISTS without changing the winner`) both assert winner bytes and mtime are untouched by a losing attempt.

### M1 — Null/early-exit cleanup never removes a final path — CLOSED

Every cleanup call site on both host and worker now takes a staging path exclusively. Host: `backup.service.ts:343` (null response), `:356` (corrupt), `:376` (unavailable, non-collision), `:396` (catch) — all pass `staging`, never `dest`; grepping the file, `discardArtifact` is never called with `dest`. Worker: every `removeBackupArtifact` call (`:671,680,694,704,711,721,736`) passes `request.stagingPath`. The regression `an early exit removes staging only and preserves a final won by another host` (`backup.service.spec.ts:616-635`) is the direct proof: it seeds a real winner file at `destPath`, kills the worker mid-write, and asserts the winner survives byte-for-byte while only staging disappears.

The one narrow case from the R0 review — an IPC reply lost after the worker already resolved a collision — is now moot rather than fixed: a null-response host branch discards only `staging` (its own randomized path, never anyone else's), so there is nothing left for it to wrongly delete even in that scenario. Good side effect of the staging-path redesign.

### M2 — Documentation matches implemented validation and publication — CLOSED (see Minor note below)

`backup.service.ts:21-27,166-180,476-491`, `integrity-worker-protocol.ts:53-84,583-605`, and `CLAUDE.md:56-61,102-113` all describe the actual staging → validate → atomic-link sequence, the staging-only cleanup rule, and the two-layer (string + realpath) containment check applied to *both* `destPath` and `stagingPath` (`integrity-worker-protocol.ts:615-636`, confirmed by the request-narrowing cases at `integrity-worker-protocol.spec.ts:114-142` and by the `stagingPath` shape check at `performBackup:638-645`). No stale prose (e.g., no leftover claim that a single `existsSync` check is the collision guard) was found in either file.

One inaccuracy from the R0 doc ("Daily same-day re-runs reuse the validated daily artifact") is now literally true rather than aspirational, since only validated copies can occupy a final name. See the Minor finding below for one thing the new docs do not name.

### R4 — Daily and non-daily collision semantics — CONFIRMED

`backup.service.ts:295-305` (pre-dispatch, `existsSync`) and `:360-382` (post-dispatch, worker-reported collision) both route `daily` to "return the winner, no degradation" and every other kind to "report not-taken, return `null`". Neither discards a final. Matches the acceptance report's R4 claim exactly.

### R5 — Stale staging sweep without retention changes — CONFIRMED

`backup.service.ts:100` (`STAGING_SUFFIX` regex, matches only `.<8-hex>.tmp` and its `-wal`/`-shm` sidecars — cannot match a `.sqlite` final), `:494-522` (groups by staging root, sweeps only when every *present* member's `mtimeMs` is older than `2 * BACKUP_WORKER_BUDGET_MS`), `:524-529` (unchanged `.sqlite`-suffix, newest-first keep logic, entirely separate from the sweep). `ignores a young staging file without sweeping or counting it` and `sweeps an old staging file and its sidecars` (`backup.service.spec.ts:893-919`) both use real filesystem mtimes via `fs.utimesSync` and pin exactly this. A staging file cannot be swept while a legitimate worker (budget-capped at `BACKUP_WORKER_BUDGET_MS` = 20 min) is still within budget, since the sweep threshold is double that budget — no plausible in-flight attempt is old enough to be swept.

### R6 / R6b — Prose and retention-scoping — CONFIRMED

`CLAUDE.md:74-78` states the migration-runner/`db:reset` conditional-rotation rule and the daily-cron unconditional-rotation rule (needed so the stale-staging sweep still runs after a failed daily attempt) as two separate, correctly scoped sentences — this is exactly the fix the batches.md R6b entry asked for, and it does not overreach into the call-site files themselves (those are Batch 5's, correctly left untouched here).

## New findings

### Moderate: filesystems without hard-link support are a real limitation, not named as a residual

- File: `integrity-worker-protocol.ts:708-716` (no fallback on `linkSync` failure other than reporting `'unavailable'`); `backup.service.ts:21-27` and `CLAUDE.md:56-61` (the "residuals" paragraph names only the upgrade-day partial-daily case).
- Scenario: `~/.ptah` lives on a filesystem that does not support hard links across the relevant path (e.g., certain network mounts, some exFAT/FAT32 configurations, or a `backups/` directory that is itself a mount point on a different volume than the source — `EXDEV`). Every backup attempt of every kind then fails with `'unavailable'`/`critical` degradation forever, with no copy-and-rename fallback.
- Impact: not a correctness bug — failure is loud (`reportNotTaken`, `'critical'` degradation, pinned by `reports an atomic-publish failure without a rename or copy fallback`, `integrity-worker-protocol.spec.ts:552-576`) rather than silent, so this does not reopen any of the closed findings. It is, however, an operational limitation with no code-level named exception, unlike the upgrade-day residual which got an explicit callout.
- Recommendation: not blocking; consider adding one sentence to `CLAUDE.md`'s residuals paragraph naming "no backup on a filesystem without hard-link support within the backups directory" as the second known, loud-failure limitation, so an operator diagnosing a persistent `database.backup.not-taken` degradation on such a host does not have to read the source to learn the cause is filesystem-level and permanent, not transient.

### Minor: `bytesWritten` on a same-second daily race-loss path is not itself validated

- File: `backup.service.ts:360-368` (daily race-loss branch returns `dest` directly, no bytes/size check on the winner).
- Not a regression from R0 (R0 had the identical behavior for the plain pre-dispatch reuse case) and not a correctness gap given B1's closure — the winner is guaranteed atomically-published-and-validated by construction. Noted only because the returned `string | null` carries no size/verdict information a caller could use to double-check; existing callers already treat any non-null path as trusted, consistent with the rest of the file's contract. No action needed.

## Regression-durability check

Without reverting source (per instructions), the coupling between each new/changed assertion and the Revision 1 mechanism was checked directly:

- `does not clean a staging path when exclusive creation reports EEXIST` (`integrity-worker-protocol.spec.ts:487-502`) asserts `openSource`/`backup` were never called and the pre-seeded staging content is untouched — this exact assertion has no analog in an `existsSync`-based design (R0 had no staging file at all) and would fail immediately against R0's code, which does not accept a `stagingPath` field.
- `returns the daily winner without degradation when atomic publish loses the race` and `an early exit removes staging only and preserves a final won by another host` both seed a real winner file at `destPath` independently of the request under test and assert it survives byte-identical — under the R0 design (`discardArtifact(dest, kind)` on some paths) these would have deleted the seeded winner, so both specs are load-bearing regressions against exactly the class of bug this revision fixes.
- `real fs hard-link publish is no-overwrite and reports EEXIST on a second link` exercises the real OS primitive directly; it does not stub anything and cannot be satisfied by any non-atomic implementation.

None of the required Revision 1 specs is skipped, POSIX-gated, or over-mocked in a way that would let a revert to the R0 design pass silently.

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: none blocking. The one operational limitation (hard-link-unsupported filesystems) fails loudly and was already an implicit constraint of using `linkSync` at all — it is a known trade-off, not a bug, and the moderate finding above only asks that it be named in prose.
- What a robust implementation would add: the one-line residuals-doc addition noted above; otherwise this revision closes every finding from the prior pass with real, platform-appropriate test evidence.
