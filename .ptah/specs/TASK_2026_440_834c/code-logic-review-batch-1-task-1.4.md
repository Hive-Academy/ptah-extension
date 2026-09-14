# Code Logic Review — `TASK_2026_440_834c` (Batch 1, Task 1.4 fix)

## Summary

| Metric              | Value                                |
| ------------------- | ------------------------------------ |
| Overall score        | 6/10                                  |
| Assessment            | NEEDS_REVISION                        |
| Blocking issues       | 1                                      |
| Serious issues        | 1                                      |
| Moderate issues       | 2                                      |
| Failure modes found   | 3                                      |

Scope reviewed: uncommitted diff of `libs/backend/persistence-sqlite/src/lib/backup.service.ts` (+spec), `libs/backend/persistence-sqlite/src/lib/integrity/integrity-worker-protocol.ts` (+spec), `src/index.ts`, `CLAUDE.md`. Files under `libs/backend/memory-curator` were not opened (out of scope, owned by a parallel Batch 3 review). `npx nx run-many -t test -p @ptah-extension/persistence-sqlite` was run: 29 suites / 383 tests passed, 9 native suites skipped (pre-existing ABI mismatch, unrelated to this change).

The fix correctly closes the original R-TL6 hole (same-millisecond `pre-migration`/`reset` collisions deleting a validated sibling backup) and correctly narrows cleanup ownership on both host and worker. It introduces one new, unvalidated trust boundary for the `daily` kind that the task's own acceptance report and `CLAUDE.md` mischaracterize as "returns the existing **validated** path."

## Five logic questions

### 1. How does this fail silently?

- `backup.service.ts:284-290` — for `kind === 'daily'`, the host's only test before declaring success is `fs.existsSync(dest)`. There is no re-run of `PRAGMA quick_check`, no size sanity check, nothing. A file at that path that is zero bytes, truncated mid-copy, or byte-garbage from a hard-killed prior attempt is returned as a normal backup path with an `info`-level log and **zero** degradation report (`h.reports).toHaveLength(0)` is asserted as the expected behaviour at `backup.service.spec.ts:461-478`). The caller (migration runner, cron, reset handler) cannot tell this apart from a real validated backup. This is a genuine silent-failure path that the fix newly introduces (see Failure Mode 1 below).
- `CLAUDE.md:52` and the batch report's I2 both assert "Daily same-day re-runs return the existing **validated** path" — that word is not backed by any code in this diff. The documentation itself is the silent failure: a future reader trusts that word and does not add the missing check.

### 2. What user action produces unexpected behaviour?

- Two processes that share the database directory (the documented Electron+CLI scenario the new prose at `backup.service.ts:23-24` calls out by name) each call `backup('daily')` for the first time on a given day within a small window of each other. Both host-side `existsSync(dest)` checks (`backup.service.ts:284`) can observe "absent" before either has written anything, so both proceed to dispatch a worker for the *same* `destPath`. See Failure Mode 2.
- An operator (or automated recovery) that force-kills a host mid-backup (SIGKILL, OOM-kill, container eviction) on the first `daily` attempt of the day leaves a partial file at the deterministic daily path with no chance for any of `performBackup`'s `catch`/`finally` or the host's `catch` block to run (both require the process to still be executing JS). Every subsequent `daily` call that day — including from a different, healthy process — reuses that partial file as "success." See Failure Mode 1.

### 3. What input data produces a wrong answer?

- A `daily` destination file that exists but is not a valid SQLite database (0 bytes, half-written pages, or content from an unrelated stale run) produces the wrong answer "backup succeeded, path = X" instead of "no backup was taken." Nothing downstream re-opens or checksums `dest` before trusting it.

### 4. What happens when a dependency fails?

- Worker crash / early exit / budget expiry: `backup.service.ts:328-337` unconditionally discards the destination and reports `not-taken` — correct, matches I2/I4, and is exercised by `integrity-worker-protocol.spec.ts:429` (partial file after a thrown `source.backup`) and the null-response branch in `backup.service.spec.ts`.
- Worker reports `BACKUP_DESTINATION_EXISTS`: host skips discard (`backup.service.ts:349-355`), pinned by `backup.service.spec.ts:397-419` which asserts the colliding file is byte-identical afterward. Correct.
- A theoretical case not exercised by any spec: the worker sends `BACKUP_DESTINATION_EXISTS` and the IPC reply is then lost because the worker process exits abnormally immediately after responding (a real but rare race in any out-of-process protocol). `DbWorkerRunner`'s `run()` would then report a `null` response, and `backup.service.ts:332` unconditionally calls `discardArtifact(dest, kind)` — deleting a file this attempt never created and that belongs to whichever process actually owns it. This is the same class of bug R-TL6 fixed for the same-second case, now reopened at the IPC-loss boundary. Low likelihood, not covered by any regression test. (Moderate — see below.)

### 5. What is missing that the requirements never mentioned?

- The task prompt itself asks the exact question the implementation does not answer: "can a corrupt/partial daily file left from a crashed run now block every later daily backup that day and be reported as success?" The answer is yes, and neither `batches.md`'s R-TL6 entry nor the I1-I6 invariants in the report state an explicit exception for this — the report instead asserts the reused path is "validated," which is inaccurate. This gap should have been called out as a known limitation, not documented as solved.
- No test exercises "existing daily file is corrupt" or "existing daily file is zero bytes" — every daily-reuse spec (`backup.service.spec.ts:461`) seeds the existing file with the harmless string `'validated-daily-backup'` and never opens it, so the suite cannot distinguish "reuse a good file" from "reuse anything at all."

## Failure modes

### 1. Daily backup silently "succeeds" by reusing a corrupt/partial leftover

- Trigger: a process is hard-killed (SIGKILL, OOM, container eviction, power loss) while its worker is mid-copy into `<dbDir>/backups/<name>-<today>.sqlite`, or `ensureBackupDirectory` created the destination but `source.backup()` had not started. No JS `catch`/`finally` runs (`integrity-worker-protocol.ts:634-670`, `backup.service.ts:370-376`), so the partial file is never removed.
- Symptom: every later `backup('daily')` call that same day, from any process, returns the partial file's path with an `info` log ("daily backup for today already exists") and **no** degradation event. Callers (migration runner, reset RPC, cron) treat this as a normal success and proceed.
- Evidence: `backup.service.ts:284-290` (existsSync-only check, no validation); `backup.service.spec.ts:461-478` (regression test seeds an unvalidated string and asserts success + zero reports); `CLAUDE.md:52` (claims "validated" without code backing it).
- Current handling: none — the file is trusted purely because it exists.
- Recommendation: either (a) re-run `quick_check` on the existing daily file before reusing it and fall back to a fresh backup (and `reportNotTaken`/degrade) when it fails, or (b) at minimum downgrade the documentation's claim and add a size/non-empty sanity check plus a `degraded`-severity report when reuse happens, so the gap is observable instead of silent.

### 2. Two hosts race to create the same first-of-day daily backup

- Trigger: Electron and CLI (or two CLI invocations) both call `backup('daily')` for the first time that day within the same small window, as the new prose at `backup.service.ts:23-24` explicitly says can happen ("Electron and CLI processes can share one database directory even though each process serializes its own calls" — serialization is per-process only).
- Symptom: both host `existsSync` checks (`backup.service.ts:284`) observe "absent" and both dispatch a worker for the identical `destPath`. Both workers' own `existsSync` checks (`integrity-worker-protocol.ts:615-617`) can also both observe "absent" if the second worker's check runs before the first worker's `source.backup()` has created the file (spawn + IPC round-trip time is on the order of tens of ms; `source.backup()` on a large DB is the ~27 s operation this whole subsystem is built around). Two `source.backup()` calls then write to the same path concurrently — either a corrupted interleaved file, or one process's completed, validated copy gets clobbered mid-flight by the other's write, and whichever validates second decides the file's fate for both.
- Evidence: `backup.service.ts:284-294` (host check), `integrity-worker-protocol.ts:611-621` (worker check — same TOCTOU shape as the host's, no lock/exclusive-create in between). No regression test simulates two concurrent dispatches against the same daily destination.
- Current handling: none beyond the two independent, non-atomic existence checks. The random-hex suffix that closes this exact hole for `pre-migration`/`reset` (I1) is deliberately absent from the daily name (`backup.service.ts:235-237`), so daily is the one kind still exposed to it.
- Recommendation: open the destination with an exclusive-create flag (`fs.constants.O_CREAT | O_EXCL`) inside the worker immediately before `source.backup()`, instead of `existsSync` + separate write, so the OS — not two racing checks — decides which attempt wins; the loser gets a real `BACKUP_DESTINATION_EXISTS` instead of racing the winner's bytes.

### 3. Silent deletion of another attempt's artifact on IPC-loss after a collision reply

- Trigger: worker detects `BACKUP_DESTINATION_EXISTS` and calls `respond(...)`, then the worker process exits or the IPC channel drops before the host's `DbWorkerRunner` finishes receiving/parsing that message.
- Symptom: `DbWorkerRunner` reports `outcome.response === null` (no distinguishable reply observed), and `backup.service.ts:328-337` unconditionally discards `dest` — deleting a file this attempt never created, in direct contradiction of the class-level guarantee at `backup.service.ts:21-24` ("Neither side may remove a destination that already existed").
- Evidence: `backup.service.ts:328-337` (null-response branch has no `BACKUP_DESTINATION_EXISTS` carve-out, unlike the `unavailable`-verdict branch at `:349-355`).
- Current handling: none; not covered by any spec (the null-response spec, if present, does not simulate an intervening real collision).
- Recommendation: low priority given the narrow race window, but worth a one-line note in the doc comment acknowledging the residual gap, or (better) having the worker `unlink` nothing and rely on the host's existing pre-dispatch check being re-run before any discard — i.e., re-check `existsSync(dest)` plus ownership markers before `discardArtifact` on a null response.

## Blocking issues

### Daily reuse treats an unvalidated file as a validated backup

- File: `backup.service.ts:284-290`
- Scenario: any crash, kill, or process exit between `ensureBackupDirectory` and `performBackup`'s own cleanup, on the first `daily` backup attempt of a given day, followed by any later `backup('daily')` call the same day (same or different process).
- Impact: the retention/backup subsystem — whose entire purpose is "a safety net for migrations and resets" per the file's own top-of-file doc comment — reports success while holding zero valid backups for that day, and does so without raising a degradation event a monitoring surface could catch. This is discovered, if ever, only at restore time, which is exactly the failure mode the class-level doc comment (`backup.service.ts:9-16`) says this design exists to prevent.
- Fix: validate the existing daily file (at minimum a `quick_check` round-trip through the same worker path, or a cheap non-zero-size/SQLite-header check) before returning it as success; on failure, discard it and fall through to a fresh backup attempt, reporting `not-taken`/degraded if that also fails.

## Serious issues

### Same-name race between two first-of-day daily backups

- File: `backup.service.ts:284-294`, `integrity-worker-protocol.ts:611-621`
- Scenario: two processes sharing a database directory both attempt the first `daily` backup of the day within the same narrow window (explicitly an in-scope scenario per this file's own new documentation).
- Impact: concurrent unguarded writes to the same destination file — data corruption of the eventual daily artifact, or non-deterministic loss of one process's completed, validated copy.
- Fix: exclusive-create (`O_EXCL`) the destination in the worker immediately before `source.backup()`, so collision detection is atomic rather than two separate `existsSync` snapshots with an unguarded window between them.

## Moderate and minor issues

- Moderate: `backup.service.ts:332` discards on any null-response outcome without excluding the case where the lost reply was actually a `BACKUP_DESTINATION_EXISTS` collision (Failure Mode 3). Narrow window, no test coverage either way.
- Moderate: `CLAUDE.md:52` and the batch report's I2 both describe the daily-reuse path as returning "the existing validated path" — this overstates what the code does and should be corrected regardless of whether Failure Mode 1 is fixed in this pass, so a future reader does not inherit the same false assumption.
- Minor: the rotation same-second old/new-format ordering quirk (`backup.service.ts:465-471`) is unchanged behaviour, correctly documented, and not a regression — noted only for completeness, no action needed.

## Data flow

1. `backup(kind)` enqueues onto `this.queue`, serializing calls within one process — OK, unchanged, not this task's concern.
2. `takeBackup(kind)` computes `dest` via `destPath(kind)` — OK for `pre-migration`/`reset` (collision-resistant per I1, confirmed by `backup.service.spec.ts:260` and the byte-identical-collision spec at `:431`). For `daily`, `dest` is deterministic per calendar day — gap noted above (Failure Mode 2).
3. Host `existsSync(dest)` gate — OK as a same-process/mostly-serialized guard; not atomic across processes (Failure Mode 2); no validation of an existing daily hit (Failure Mode 1).
4. Factory/dispatch — OK, `cleanupAllowed` correctly flips only once a request that could create a file is about to be sent (`backup.service.ts:319`), so a no-factory early return never triggers discard on nothing.
5. Worker `performBackup`: pre-existing-destination refusal (`integrity-worker-protocol.ts:611-613`) — OK, before anything is created, matches I3, pinned by `integrity-worker-protocol.spec.ts:394-424`. `artifactCreatedByAttempt` flips only after that refusal and before `source.backup()` — OK, gates corrupt/catch cleanup correctly (`:637-639,668-670`), pinned by `:429-451`.
6. Host verdict handling — `corrupt` always discards (OK, unchanged); `unavailable` discards unless `BACKUP_DESTINATION_EXISTS` (OK, I4, pinned by `:397-419`); `null` response always discards (gap, Failure Mode 3, low severity).
7. Rotation (`rotate()`) — unchanged newest-N-by-filename logic, `.sqlite` suffix filter preserved, sidecars excluded — OK, confirmed by the mixed-format regression test (`backup.service.spec.ts:812`-area) and existing sidecar-exclusion tests.
8. Migration runner's post-backup rotate call — not part of this diff (unchanged), and this review did not re-verify it since no lines in the reviewed files changed that call site; the report's I5 claim about it is a documentation statement, not new behaviour introduced here.

## Requirements fulfilment

| Requirement | Status | Gap |
| ----------- | ------------------------ | --------------- |
| I1 — collision-resistant non-daily names | COMPLETE | None found; confirmed by code and spec. |
| I2 — host pre-dispatch collision checks | PARTIAL | Daily-reuse path exists but reuses without validating, contrary to the "validated" claim. |
| I3 — worker refuses existing destinations, narrow cleanup ownership | COMPLETE | Confirmed by code and spec, including the corrupt/catch gating. |
| I4 — host preserves worker-reported collision artifacts | PARTIAL | Correct for the `unavailable`-verdict path; not extended to the null-response path (Failure Mode 3). |
| I5 — rotation remains filename-based, excludes sidecars | COMPLETE | Unchanged, confirmed by regression test. |
| I6 — prose updated to match new guarantees | PARTIAL | `CLAUDE.md:52` overstates daily-reuse validation. |

Implicit requirements not addressed: atomicity of "check destination absent, then create it" across two OS processes sharing one directory (the scenario the diff's own prose introduces as newly in-scope) is not achieved — only narrowed from "always" to "the daily kind, in a small window."

## Edge cases

| Case | Handled | How | Concern |
| ------ | ------- | ------------- | -------------- |
| Same-millisecond pre-migration/reset collision | YES | Random hex suffix + host/worker refusal | None found |
| Colliding pre-migration destination from another attempt | YES | Host and worker both refuse, no discard | None found |
| Daily backup already exists (valid) | YES | Returned without dispatch | None — correct optimization |
| Daily backup already exists (corrupt/partial from crash) | NO | Returned as success anyway | Blocking issue above |
| Two hosts race first daily backup of the day | NO | Two independent, non-atomic existsSync checks | Serious issue above |
| Worker killed mid-copy (budget/early exit) | YES | Host discards unconditionally on null response | Correct, but see Failure Mode 3 for one narrow sub-case |
| Corrupt verdict from worker | YES | Host discards, pinned by spec | None found |
| Mixed old/new rotation filenames | YES | Documented quirk, pinned by spec | None (pre-existing, documented) |

## Verdict

- Recommendation: REVISE
- Confidence: HIGH
- Top risk: a hard-killed process can leave a corrupt/partial `daily` backup file that every later same-day attempt — from any process — silently accepts as a validated success, with no degradation signal, directly contradicting this subsystem's stated purpose as a migration/reset safety net.
- What a robust implementation would add: (1) validate an existing daily file before reusing it, or explicitly document and monitor the trust gap; (2) make the daily destination's existence check atomic across processes (`O_EXCL` in the worker) instead of two independent `existsSync` snapshots; (3) correct `CLAUDE.md`'s "validated path" claim to match actual behaviour; (4) extend the null-response discard branch to not blindly remove artifacts it cannot prove it created.
