# Batches - TASK_2026_440_834c

Total tasks: 24 | Batches: 7 | Complete: 7/7

Worktree: `D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention` (branch
`feat/task-440-memory-retention`). Every path below is absolute. Requirements source: `verdict.md`
section A + `context.md` (no task-description.md). Plan: `implementation-plan.md` (approved at Gate 2,
2026-09-14).

## Execution order and parallelism

```
Wave 1:  Batch 1 (persistence)          ||  Batch 2 (shared DTO + settings keys)
Wave 2:  Batch 3 (memory-curator retention core)             needs 1, 2
Wave 3:  Batch 4 (diagnostics contract) ||  Batch 5 (cron job, both hosts)   needs 3
Wave 4:  Batch 6 (frontend storage panel)                    needs 4 (may overlap Batch 5)
Wave 5:  Batch 7 (verification + A1/A2 copy-based timing)    needs 5, 6
```

No batch edits a `project.json`, so no `npx nx reset` is needed. Do NOT run `nx reset` while a parallel
batch is running in this worktree.

## Deviations from the architect's grouping hint (with evidence)

1. **The required `storage` field on `MemoryDiagnosticsResult` moves out of the shared-DTO batch into
   Batch 4, together with the handler one-liner.** Evidence: `memory-rpc.handlers.ts:504-580` builds the
   `MemoryDiagnosticsResult` object literal field by field; it is the only producer
   (`rpc-curator-diagnostics.types.ts:126` consumers: the handler, `rpc.types.ts:1616`, and
   `memory-diagnostics-rpc.service.ts:26`). Adding a required field in hint group 2 would leave
   `@ptah-extension/rpc-handlers` failing `typecheck` from that commit until hint group 5. Batch 2 therefore
   adds only the two new DTO interfaces (purely additive).
2. **The `db:reset` rotation (`persistence-rpc.handlers.ts`) joins Batch 1.** It depends only on
   `KEEP_BY_KIND` being exported, is part of Component 3, and is file-disjoint from every other batch.
   Hint group 5 therefore dissolves: its memory-diagnostics one-liner is in Batch 4.
3. **Hint group 3 is split into Batch 3 (retention core) and Batch 4 (diagnostics wiring).** Group 3 was
   ~20 files. The split keeps each batch one sitting and lets the cron-host batch (5) run in parallel with
   diagnostics (4): Batch 5 needs only the service token and report types from Batch 3.
4. `start-thoth-cron.ts` / `start-thoth-cron.spec.ts` and CLI `thoth-runtime.ts` / `thoth-runtime.spec.ts`
   are touched by Component 3 (keep literal) and Component 8. Both edits are in Batch 5 only, as instructed.

## Plan validation

Status: PASSED WITH RISKS

Verified on disk (2026-09-14, this worktree):

- Highest migration is 42 (`migrations/index.ts:322`); the seven ratchet specs assert `toBe(42)` at the
  exact lines the plan names.
- `KEEP_BY_KIND` at `backup.service.ts:106`, exported at `:485`, absent from the barrel
  (`persistence-sqlite/src/index.ts:28-34`). Literal rotations at `migration-runner.ts:99`,
  `start-thoth-cron.ts:324`, `cli-engine thoth-runtime.ts:391`. `db:reset` backup at
  `persistence-rpc.handlers.ts:433` with no rotate.
- `incremental_vacuum(100)` at `start-thoth-cron.ts:345`, asserted by `start-thoth-cron.spec.ts:158`.
- `purgeOlderThan` callers: store `:648`, store spec `:305-321`, five `jest.fn(() => 0)` mocks — matches the
  plan. **Two extra doc mentions the plan missed**: `observation-queue.store.spec.ts:418` and
  `observation-queue.store.rekey.spec.ts:7` (added to Task 3.4).
- `observation_queue` columns (`0016_observation_queue.ts:17-33`) include every column the quarantine
  byte sum reads; no later migration alters the table (only 0039 deletes rows).
- `thoth-runtime` already imports `@ptah-extension/memory-curator` (`boot-thoth-runtime.ts:19`,
  `types.ts:5`) and `SKILL_SYNTHESIS_TOKENS` (`start-thoth-cron.ts:17-20`); `FOREGROUND_ACTIVITY_TRACKER`
  exists (`skill-synthesis/src/lib/di/tokens.ts:117`). CLI host already imports from
  `@ptah-extension/thoth-runtime` (`cli-engine thoth-runtime.ts:24`) and `MEMORY_TOKENS` (`:13`).
- `memory-curator` already imports `@ptah-extension/shared` (e.g. `indexing-control.service.ts`).
- `new MemoryDiagnosticsService(` is constructed only in `diagnostics.service.spec.ts` (6 sites); the
  constructor change is contained.
- The only non-host caller of `registerMemoryCuratorServices` is
  `apps/ptah-electron/src/integration/wizard-seed.integration.spec.ts:227`, which also calls
  `registerPersistenceSqliteServices`, so the new `SQLITE_PAGE_RECLAIMER` dependency resolves there.
- Frontend fixtures in `memory-diagnostics-state.service.spec.ts:42-52` and
  `memory-diagnostics-rpc.service.spec.ts:36` are untyped literals, so the new required field does not
  break their compile.
- All 8 projects have `test`, `lint`, `typecheck` targets. Project names: `@ptah-extension/persistence-sqlite`,
  `@ptah-extension/memory-curator`, `@ptah-extension/thoth-runtime`, `@ptah-extension/cli-engine`,
  `@ptah-extension/rpc-handlers`, `@ptah-extension/platform-core`, `@ptah-extension/shared`,
  `@ptah-extension/memory-curator-ui`.
- The A1/A2 source snapshot exists: `C:\Users\abdal\.ptah\state\ptah.pre-migration-20260909T230600Z.sqlite`,
  1,178,537,984 bytes, mtime 2026-09-10 02:06. Temp volume has ~369 GB free.

Assumptions:

- A1 (`incremental_vacuum(2048)` step <= ~100 ms on a 1.28 GB file) — unverified; checked in Task 7.2 on a
  temp COPY. Adaptive halving (Task 3.3) bounds it.
- A2 (500-row processed DELETE batch <= ~60 ms) — unverified; checked in Task 7.2 on a temp COPY. Adaptive
  halving (Task 3.3) bounds it.
- A3 (`json_each(?)` identical under `better-sqlite3` and `node:sqlite`) — verified by Task 3.2 / 3.5 specs,
  which must run under whichever opener loads and must fail, not skip, when neither loads.
- A4 (phase 2 adds the age rule as a step of `MemoryRetentionService.run`) — nothing in this task depends on
  it; no step abstraction is built.
- A6 (added after Batch 3; the Batch 3 reviewer found no fix needed now, see its check 4) — processed
  `observation_queue` rows with `session_id = ''` are few or none on real data. The plan's keyset walk starts at `session_id > ''`, so such rows are never purged (unprocessed ones
  are still quarantined through the drain index; `enqueue` refuses empty ids today,
  `observation-queue.store.ts:339`). Unverified; the Batch 3 reviewer judges it, and Task 7.2 counts them on
  the temp COPY.
- A5 (added by team-leader) — the pre-migration snapshot keeps its current bytes until Task 7.2 copies it.
  Branch code with rotation-to-1 only rotates `ptah.pre-migration-*` next to the DB it opens; dev runs use
  `ptah-dev.*`. Task 7.2 records the snapshot's size and mtime before and after the copy.

| Risk | Severity | Mitigation |
| --- | --- | --- |
| R-TL1 Required `storage` field breaks `rpc-handlers` typecheck between commits if it lands before the handler | HIGH | Field lands in Batch 4 with the handler line (Deviation 1); Batch 2 is additive only |
| R-TL2 Stale `purgeOlderThan` mentions outside the plan's list leave the grep check red | LOW | Task 3.4 includes `observation-queue.store.spec.ts:418` and `observation-queue.store.rekey.spec.ts:7` |
| R-TL3 `memory-curator-tab.component.spec.ts:16-31` stubs the diagnostics state without `storage`; if the accordion renders there, `storage()` is `undefined()` | MEDIUM | Task 6.2 adds `storage: signal(null).asReadonly()` to that stub |
| R-TL4 Timing check touches the live DB or the original snapshot; or runs the migration runner with a BackupService, which would back up and rotate next to the copy | HIGH | Task 7.2: copy into a fresh temp dir under a non-`ptah` file name, apply missing migrations directly from `MIGRATIONS` (no `SqliteMigrationRunner` + `BackupService`), verify source size/mtime unchanged, delete temp dir |
| R-TL5 Parallel batches share one worktree; one batch's in-flight edits can transiently fail the other's test run | LOW | Team-leader re-runs each batch's verification command after both parallel batches return, before commit |
| R-TL7 `platform-core` `file-settings-manager.bench.spec.ts` ("per-write cost flat across 1000 set() calls", 30 s Jest timeout) times out when another project's Jest runs alongside it. Pre-existing: the file was last changed in `f80fa299c`, and Batch 3's platform-core diff is comment-only. Intermittent: the executor saw it fail twice at default parallelism; the team-leader re-run at default parallelism passed | LOW | If it fails, re-run the same `run-many` with `--parallel=1` and record both runs. Task 7.1 uses `--parallel=1` for the 8-project test run |
| R-TL6 Same-second pre-migration/reset backups share a filename (`compactIso()` strips ms, `backup.service.ts:97-103,229-237`); a failed attempt's cleanup — worker (`integrity-worker-protocol.ts:609-620,626,655`) AND host `discardArtifact` (`backup.service.ts:314,327,335,355`) — deletes the earlier validated file; keep=1 makes it the only copy | HIGH | Task 1.4: collision-proof names + never discard a destination this attempt did not create, on both sides |
| R1 Main-thread I/O janks on slow disks | MEDIUM | Gates + adaptive halving (Task 3.3); if A1/A2 fail on the copy, Batch 7 returns lowered defaults to Batch 3's files before merge; writes never move to a worker |
| R2 Boot catch-up fires the hourly slot at start | MEDIUM | 10-min boot-deferral gate (Task 3.3), pinned by service spec and host reachability specs |
| R3 First upgrade copies 1.28 GB pre-migration backup | LOW | Existing out-of-process behaviour; rotation to 1 (Task 1.3) deletes the older copy right after |
| R4 WAL growth from vacuum relocations | LOW | `checkpointPassive()` after reclaim (Tasks 1.2, 3.3) |
| R5 Electron and CLI hosts both tick | LOW | JobRunner slot claim + `BEGIN IMMEDIATE`; `database-busy` → `partial` (Tasks 3.2, 3.3) |
| R6 Stuck-row delete races `markProcessed` | LOW | Harmless (0 rows updated); DELETE re-checks `processed_at IS NULL` (Task 3.2) |
| R7 Purge keys on `processed_at`, not `captured_at` | LOW | Pinned by the integration spec's P-old-captured-new-processed rows (Task 3.5) |
| R8 Processed bytes is an estimate | LOW | Named `processedBytesEstimate` (Task 2.1) and labelled in UI (Task 6.1) |

Edge cases:

- Unprocessed row inside the 14-day grace — never touched; Task 3.5 (U-grace rows).
- Row captured long ago, processed yesterday — retained; Task 3.5.
- `processed_at` must never be written by retention — Tasks 3.2 (statement-text spec) and 3.5 (snapshot compare).
- `auto_vacuum != 2` — reclaim skipped with `auto-vacuum-not-incremental`; Tasks 1.2, 3.3.
- Invalid pragma integer (0, 1.5, NaN, 1e9) — refused/clamped with no SQL; Task 1.2.
- Closed connection / disposed container — zeros / `persistence-unavailable` / `retention-service-unavailable`; Tasks 1.2, 3.3, 5.1.
- DB without `sqlite_stat1` — no bare `SCAN observation_queue`; Task 3.2 plan assertions.
- Concurrent `run` — `already-running`; flag cleared in `finally` even on failure; Task 3.3, 3.5.
- Budget stop / mid-run failure — earlier batches stay committed, `backlog_remaining = 1`, next tick due; Task 3.5.
- `backup('reset')` returns `null` — no rotate; Task 1.3.
- Double `startThothCron` / `activateThoth` — handler registered once, upsert twice; Task 5.2, 5.3.
- `oneshot` CLI tier — registers nothing; Task 5.3.
- Foreground tracker not registered — `() => Infinity`; Task 5.1.
- `null` storage DTO / `null` fields in UI — "No storage data yet" / "—"; Task 6.1.

---

## Batch 1: Persistence — migration 0043, page reclaimer, keep table, reset rotation — COMPLETE (commits 6c335b73a, 6a2190a64)

- Task 1.4 revision 1, re-reviewed by Claude (`code-logic-review-batch-1-task-1.4-r1.md`): APPROVED, 0 blocking,
  0 serious, 1 moderate, 1 minor. B1, S1, M1, M2 closed; R6b applied (`persistence-sqlite/CLAUDE.md:76`).
  Committed as `6a2190a64` with only the 7 persistence-sqlite files.
- FOLLOW-UP before merge (recorded, not applied; docs only): name the second loud residual in the
  `persistence-sqlite/CLAUDE.md` residuals paragraph and the `backup.service.ts:21-27` docblock: on a
  filesystem without hard-link support in the backups directory (or `EXDEV`), every backup reports
  not-taken / critical degradation permanently. Carried by Batch 7 as Task 7.3. The minor finding
  (race-loss returns `dest` without a size check) is recorded; no action, since it is validated by
  construction.

- Reopened 2026-09-14: cross-family review `code-logic-review-batch-1-codex.md` returned APPROVED WITH
  FIXES with one SERIOUS finding (backup filename collision → failed attempt deletes a validated backup).
  Batch 1's keep=1 escalates it from "lose one of three" to "lose the only pre-migration copy", so it is
  fixed inside Batch 1 as Task 1.4 (R-TL6). The first review's claim that `compactIso()` is strictly
  increasing is wrong (milliseconds are stripped, `backup.service.ts:97-103`).

- Review: code-logic-reviewer APPROVED 8/10 (`code-logic-review-batch-1.md`). Minor findings:
  (a) `persistence-sqlite/CLAUDE.md` says every call site rotates only after a non-null backup, but the
  daily cron call sites rotate unconditionally — carried into Task 5.2; (b) `reclaimStep` reads 4 page
  pragmas before discovering `auto_vacuum != 2` — recorded, no action (cheap, matches precedent).

- Recommended executor: backend-developer (sub-agent)
- Fallback executor: a fresh backend-developer instance with only the unfinished tasks
- Execution mode: sequential (tasks 1.1-1.3 share `persistence-sqlite/src/index.ts` and `di/*`)
- Parallel with: Batch 2 (file-disjoint: this batch never edits `libs/shared` or `libs/backend/platform-core`)
- Rationale: migration ratchet, DI token + registration, barrel and a real-SQLite spec across one lib; a
  shared barrel rules out lanes.
- Tasks: 3 | Depends on: none

### Task 1.1: Migration 0043 (ledger + run record) and ratchet bump — COMPLETE

- Files:
  - CREATE `D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\backend\persistence-sqlite\src\lib\migrations\0043_memory_retention.ts`
  - CREATE `D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\backend\persistence-sqlite\src\lib\migrations\0043_memory_retention.spec.ts`
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\backend\persistence-sqlite\src\lib\migrations\index.ts`
  - MODIFY (42 → 43) the ratchet specs in the same folder: `0028_gateway_conversation_workspace_root.spec.ts:77`,
    `0030_skill_event_metrics.spec.ts:32`, `0038_gateway_message_turn_state.spec.ts:85`,
    `0039_reap_orphaned_queue_rows.spec.ts:59`, `0040_skill_candidate_workspace_root.spec.ts:72`,
    `0041_skill_md_migration_state.spec.ts:56`, `0042_db_integrity_check_state.spec.ts:64`
- Plan reference: implementation-plan.md:161-236
- Pattern to follow: `migrations/0042_db_integrity_check_state.ts:266-276` (single-row CHECK) and its spec
- Quality requirements: static SQL only (no `${`), `IF NOT EXISTS`, no index or scan on `observation_queue`,
  exact DDL from the plan.
- Validation notes: do not edit migration 0039's historical comments (forward-only rule).
- Implementation details: registry entry `{ version: 43, name: '0043_memory_retention', sql }`; spec asserts
  highest version, no `${`, idempotent double apply, `id = 2` rejected, UNIQUE `(session_id, kind, reason)`.

### Task 1.2: `SqlitePageReclaimer` + DI token + barrel — COMPLETE

- Files:
  - CREATE `D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\backend\persistence-sqlite\src\lib\sqlite-page-reclaimer.ts`
  - CREATE `D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\backend\persistence-sqlite\src\lib\sqlite-page-reclaimer.spec.ts`
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\backend\persistence-sqlite\src\lib\di\tokens.ts`
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\backend\persistence-sqlite\src\lib\di\register.ts`
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\backend\persistence-sqlite\src\index.ts`
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\backend\persistence-sqlite\CLAUDE.md`
- Depends on: Task 1.1
- Plan reference: implementation-plan.md:238-279
- Pattern to follow: page-stat pragmas at `sqlite-connection.service.ts:573-592`; token style `di/tokens.ts:1-9`;
  real-SQLite opener with `node:sqlite` fallback `memory-curator/src/lib/observation-queue.store.spec.ts:44-80`
- Quality requirements: never throws; no `VACUUM` statement text (spec asserts); `maxPages` validated as a
  finite integer 1..65,536 before any SQL; runs only when `auto_vacuum = 2` and not `inTransaction`;
  `pragma()` steps to completion.
- Validation notes: DI-reach assertion that `registerPersistenceSqliteServices` registers
  `SQLITE_PAGE_RECLAIMER` lives in this spec (plan Component 11 item 3). The spec must fail, not skip, if no
  SQLite opener loads.
- Implementation details: token `PERSISTENCE_TOKENS.SQLITE_PAGE_RECLAIMER = Symbol.for('PtahSqlitePageReclaimer')`,
  singleton; exports class + `SqlitePageStats`; methods `readPageStats`, `reclaimStep(maxPages)`,
  `checkpointPassive`.

### Task 1.3: `KEEP_BY_KIND` as the one keep table + reset rotation — COMPLETE

- Files:
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\backend\persistence-sqlite\src\lib\backup.service.ts`
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\backend\persistence-sqlite\src\lib\backup.service.spec.ts`
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\backend\persistence-sqlite\src\lib\migration-runner.ts`
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\backend\persistence-sqlite\src\lib\migration-runner.spec.ts`
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\backend\persistence-sqlite\src\index.ts` (export `KEEP_BY_KIND`)
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\backend\rpc-handlers\src\lib\handlers\persistence-rpc.handlers.ts`
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\backend\rpc-handlers\src\lib\handlers\persistence-rpc.handlers.spec.ts`
- Depends on: Task 1.2 (shared barrel)
- Plan reference: implementation-plan.md:281-319
- Pattern to follow: runner D2 rule (rotate only after a non-null backup) `migration-runner.ts:87-100`,
  `migration-runner.spec.ts:170-192,244`
- Quality requirements: `{ 'pre-migration': 1, daily: 7, reset: 2 }`; `migration-runner.ts:99` reads
  `KEEP_BY_KIND['pre-migration']`; reset handler rotates `('reset', KEEP_BY_KIND.reset)` only after a
  non-null backup, inside the existing try/catch.
- Validation notes: do NOT touch `start-thoth-cron.ts` or CLI `thoth-runtime.ts` here (Batch 5 owns them).
  The keep=0 test at `backup.service.spec.ts:663-676` must stop naming `reset` as unbounded.
- Implementation details: docblock update at `backup.service.ts:105`; new spec asserts newest 2 reset
  backups kept; handler spec asserts `rotate('reset', 2)` after success and no call on `null`.

### Task 1.4: Backup destinations cannot collide, and a failed attempt never deletes a file it did not create — COMPLETE (revision 1: atomic publish, commit 6a2190a64)

- Recommended executor: CLI lane x1 (orchestrator direction "lanes first") | Fallback: backend-developer
- Reviewer: code-logic-reviewer from a DIFFERENT model family than the executor
- Files (all in `libs/backend/persistence-sqlite`; file-disjoint from Batch 3):
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\backend\persistence-sqlite\src\lib\backup.service.ts`
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\backend\persistence-sqlite\src\lib\backup.service.spec.ts`
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\backend\persistence-sqlite\src\lib\integrity\integrity-worker-protocol.ts`
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\backend\persistence-sqlite\src\lib\integrity\integrity-worker-protocol.spec.ts`
  - MODIFY if its fixtures need the new name shape: `...\src\lib\integrity\integrity-worker-backup.integration.spec.ts`
- Evidence (team-leader verified on disk):
  - `compactIso()` strips ms (`backup.service.ts:97-103`); `destPath()` uses it for pre-migration/reset and
    `YYYY-MM-DD` for daily (`:229-237`).
  - Worker sets `artifactExists = true` before `source.backup()` and removes `destPath` on a throw (`:655`)
    and on a `corrupt` verdict (`:626`) without knowing whether the file pre-existed.
  - The HOST also deletes `dest` via `discardArtifact` on no reply / early exit / budget expiry (`:314`),
    `corrupt` (`:327`), `unavailable` (`:335`) and a thrown error (`:355`). A worker-only guard does NOT
    close the finding.
  - `inFlight` is per worker process only; two host processes (Electron + CLI) share one DB directory.
  - A null backup reports a `critical` degradation (`backup.service.ts:368-375`).
- Required fix (invariants are the acceptance):
  - I1: pre-migration and reset destinations are unique per attempt:
    `<prefix><YYYYMMDDTHHMMSSmmmZ>-<8 lowercase hex from crypto.randomBytes(4)>.sqlite`.
    Daily keeps its `YYYY-MM-DD` day-granular name (keep 7 = 7 days).
  - I2: the host checks the destination BEFORE dispatching the worker:
    - daily already exists for today: return that existing path, log `info`, spawn no worker, report no
      degradation (a same-day daily already exists). Document this change: a same-day re-run used to
      overwrite.
    - pre-migration/reset already exists: do not dispatch, do not discard, report not-taken.
  - I3: the worker checks `fs.existsSync(destPath)` before any write. If it exists, the worker returns an
    `unavailable` response whose `detail` is an exported constant (e.g. `BACKUP_DESTINATION_EXISTS`). It
    calls neither `source.backup()` nor `removeBackupArtifact`. The catch path and the `corrupt` path
    remove only a destination this attempt created.
  - I4: when the host receives that `BACKUP_DESTINATION_EXISTS` detail, it does NOT call
    `discardArtifact`. This closes the cross-process race between the host check and the worker check.
  - I5: rotation is unchanged in behaviour. It still sorts newest-first and still excludes `-wal`/`-shm`.
    It must work with mixed old names (`...T120000Z.sqlite`) and new names across different seconds.
    Document the one known quirk: an old-format file sorts newer than a new-format file from the SAME second.
  - I6: update the prose that states the old guarantees: the `backup.service.ts` module header (`:21-43`),
    the `rotate()` / `discardArtifact` docs, and the `integrity-worker-protocol.ts` destination comment
    (`:224`). No `V2` path, no flag, no kept old naming function.
- Regression specs (acceptance, must execute, not skip):
  - worker: a pre-existing valid file at `destPath` gives the `BACKUP_DESTINATION_EXISTS` response, file bytes
    and mtime are unchanged, `source.backup` is never called. A failure on a fresh destination still cleans up
    (existing tests stay green).
  - host: two pre-migration (and two reset) `destPath`s computed within the same millisecond differ (mock
    `Date` and/or random); name regex updated from `:196`.
  - host: a pre-existing file at the computed pre-migration destination (force the collision through the
    random/Date seam) is left byte-identical, no worker dispatched, returns null.
  - host: a daily file for today exists, so it returns that path, the worker factory is not invoked, and no
    degradation is reported.
  - host: worker replies `BACKUP_DESTINATION_EXISTS`, so `discardArtifact` is not called and the file survives.
  - rotation: mixed old/new names across different seconds keep the newest N; sidecars are excluded.
- Verification: `npx nx run-many -t typecheck test lint -p @ptah-extension/persistence-sqlite`. The header
  must report **1 project**. Do not run `nx reset` (Batch 3 is running in this worktree).
- Revision 1 (2026-09-14): the Claude code-logic-reviewer returned NEEDS_REVISION, 6/10
  (`code-logic-review-batch-1-task-1.4.md`): 1 blocking, 1 serious, 2 moderate. **Root cause is partly this
  task's own spec:** I2's "return the existing daily path" trusted any file at the final name, but the
  old worker wrote the copy directly at the final name, so a hard-killed attempt leaves a partial file there.
  - B1 (blocking): same-day daily reuse returns a partial/corrupt crash leftover as success.
  - S1 (serious): two processes pass both `existsSync` checks for the fixed daily name and write the same file.
  - M1: the null-response branch (`backup.service.ts:328-337`) discards a final path this attempt may not own.
  - M2: `CLAUDE.md:52` and the report claim "validated" without code backing it.
- Revised design (team-leader validated the orchestrator's "atomic publish" proposal against the code; it
  REPLACES I2–I4's existence-check approach; I1, I5 stay):
  - R1 Staging: the HOST computes `stagingPath = <destPath>.<8 lowercase hex>.tmp` (same directory) and
    sends it in `BackupRequest` next to `destPath`. The worker applies `validateBackupDestination` +
    `resolveRealBackupDestination` to BOTH paths. The worker creates the staging file exclusively (`'wx'`,
    EEXIST → fail with no cleanup), closes it, then runs `source.backup(stagingPath)`,
    `restrictBackupFile(stagingPath)` and `validateCopy(stagingPath)`, all on the staging file.
  - R2 Publish: only on verdict `ok` (NOT `unavailable`, NOT `corrupt`). After the validation handle is
    closed and the staging `-wal`/`-shm` sidecars are removed, run `fs.linkSync(stagingPath, destPath)`
    (atomic, never overwrites; EEXIST if the destination exists), then unlink the staging file.
    - EEXIST: respond `BACKUP_DESTINATION_EXISTS`, remove only the staging file + sidecars; the destination
      is untouched.
    - Any other link error (e.g. a filesystem without hard links): remove staging, respond `unavailable`
      with a detail naming the atomic-publish failure. It is NOT silently replaced by an overwriting rename
      or copy (residual risk recorded: backups on a filesystem without hard-link support now report
      not-taken instead of writing non-atomically).
  - R3 Ownership: every cleanup path in worker AND host removes only `stagingPath` + its sidecars. No code
    path unlinks `destPath` for a failed attempt (null response, early exit, budget expiry, corrupt,
    unavailable, throw). This closes review M1.
  - R4 Daily reuse (fixes B1): keep the pre-dispatch `existsSync(dest)` → return the existing path, with no
    degradation. It is now true because only `ok`-validated copies are ever published at a final name. On
    `BACKUP_DESTINATION_EXISTS` for `daily` (lost race, fixes S1), return the winner's `destPath` with no
    degradation. For pre-migration/reset, keep not-taken without discard. Record residual risk: a partial
    daily left at a final name by the OLD code earlier the same upgrade day is trusted once.
  - R5 Stale staging sweep: `rotate(kind, keep)` also removes files matching
    `<prefix>*.<8 hex>.tmp` (and `-wal`/`-shm`) whose mtime is older than `2 × BACKUP_WORKER_BUDGET_MS`.
    Never a younger one: another process may be mid-copy. The `.sqlite` suffix filter already keeps staging
    files out of keep slots.
  - R6b (carried from Batch 5.2): in `persistence-sqlite/CLAUDE.md`, scope the "rotate only after a
    non-null `backup()`" rule to the migration-runner and `db:reset` call sites; the daily cron call sites
    rotate unconditionally.
  - R6 Docs: correct the `backup.service.ts` header, `rotate`/`discardArtifact` docs, the protocol comments
    and `persistence-sqlite/CLAUDE.md:52` to the real guarantee ("only validated copies are published at
    a final name; publish is an atomic no-overwrite hard link").
- Revision 1 regression specs (acceptance):
  - a crash-leftover staging file (young) is ignored by rotation and not swept; an old one (and its
    sidecars) is swept;
  - the worker never publishes on `corrupt` or `unavailable`, and the staging file is gone afterwards;
  - publish when the destination already exists (a valid file, simulating the winner) gives
    `BACKUP_DESTINATION_EXISTS`, the winner's bytes are unchanged, the loser's staging is removed; the host
    returns the destination path for `daily` and null without discard for pre-migration;
  - a null response / early exit after the worker created staging: the host removes staging only, and a
    pre-existing file at `destPath` survives byte-identical;
  - a successful backup leaves exactly one file at `destPath` (mode 0600 on POSIX), no staging and no
    staging sidecars;
  - on Windows (this machine), a real `fs.linkSync` publish + unlink staging in a temp dir, then EEXIST on
    a second link — with the real `node:fs`, not a double.

### Batch 1 verification

- Every listed artifact exists and contains real work.
- `npx nx run-many -t typecheck test lint -p @ptah-extension/persistence-sqlite @ptah-extension/rpc-handlers`
  passes; header must report **2 projects**.
- The reclaimer spec and 0043 spec show executed (not skipped) tests.
- Reviewer: code-logic-reviewer (migration DDL, pragma injection guard, rotation deleting user backups).

---

## Batch 2: Shared DTO interfaces + retention settings keys — COMPLETE (commit 969401b7c)

- Review: code-style-reviewer (cross-family review of CLI-lane output) APPROVED 9/10
  (`code-style-review-batch-2.md`). Minor finding: no comment at the four `memory.retention.*` defaults
  saying they must equal the `memory-retention-config.ts` fallbacks — carried into Task 3.3.

- Recommended executor: CLI lane x1 (both tasks in one lane; exact text is in the plan)
- Fallback executor: backend-developer (sub-agent)
- Execution mode: sequential inside the lane (2 small tasks, 2 files)
- Parallel with: Batch 1 (file-disjoint)
- Rationale: purely additive, fully specified by the plan (DTO text verbatim, four keys with defaults),
  two files no other batch in Wave 1 touches — a self-contained prompt is enough.
- Tasks: 2 | Depends on: none

### Task 2.1: Add `MemoryRetentionRunDto` and `MemoryStorageHealthDto` — COMPLETE

- File: `D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\shared\src\lib\types\rpc\rpc-curator-diagnostics.types.ts`
- Plan reference: implementation-plan.md:656-702
- Pattern to follow: existing `MemoryDbHealthDto` in the same file
- Quality requirements: interfaces copied exactly from the plan, exported through the existing barrel path
  (confirm `MemoryDbHealthDto`'s export route and mirror it).
- Validation notes: **do NOT add `storage` to `MemoryDiagnosticsResult` in this batch** (Deviation 1 /
  R-TL1). That field lands in Task 4.1 with the handler.
- Implementation details: two `export interface` declarations, all fields `readonly`, `readErrors?` optional.

### Task 2.2: Register the four `memory.retention.*` settings keys — COMPLETE

- File: `D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\backend\platform-core\src\file-settings-keys.ts`
- Plan reference: implementation-plan.md:565-580
- Pattern to follow: memory block in `FILE_BASED_SETTINGS_KEYS` (`:333-342`) and `FILE_BASED_SETTINGS_DEFAULTS` (`:586-590`)
- Quality requirements: keys `memory.retention.enabled` (true), `memory.retention.processedDays` (7),
  `memory.retention.stuckDays` (14), `memory.retention.batchSize` (500) in BOTH the key set and the defaults.
- Validation notes: Task 3.3 adds a parity spec against these defaults; values must match exactly.
- Implementation details: additive entries with a short comment naming `MemoryRetentionService`.

### Batch 2 verification

- `npx nx run-many -t typecheck test lint -p @ptah-extension/shared @ptah-extension/platform-core`
  passes; header must report **2 projects**.
- `git diff` shows no `storage` field on `MemoryDiagnosticsResult`.
- Reviewer: code-style-reviewer (additive contract + settings registry consistency).

---

## Batch 3: memory-curator retention core — COMPLETE (commit 3f2ab4f4f)

- Fix re-review (the same cross-family reviewer), `code-logic-review-batch-3-fixes.md`: APPROVED. M1, M2
  and m1 are closed with exact assertions; no new finding; memory-curator 546 passed, 0 lint errors.
  Committed memory-curator plus the platform-core comment only. The Task 1.4 persistence-sqlite changes
  stayed unstaged.

- Cross-family review (codex lane), `code-logic-review-batch-3.md`: 8.2/10, APPROVED WITH FIXES, 0 blocking,
  0 serious, 2 moderate, 1 minor. There is no commit until the fixes are re-reviewed.
  - M1 (Task 3.5): add a DEFAULT-window run at `NOW+25h`: exactly 50 purged + 40 quarantined, ledger total
    340, the two `tool-use` keys for `u-0`/`u-1` accumulate, the `user-prompt` keys are unchanged.
  - M2 (Tasks 3.3 + 3.5): prove the combined row cap across purge→quarantine, the ledger prune after a
    row-budget stop (and that reclaim still runs), and `reclaim-stalled` termination (one call, partial,
    backlog, no spin).
  - m1 (Task 3.3): compute `freedBytes` only when both page-stat samples are valid; keep the prior average
    otherwise; add a degraded-first-sample regression test.
  - A6: the reviewer found no fix required now (history shows every production writer guarded empty ids).
    Task 7.2 still counts on the copy; a nonzero count means a fix before merge.
- Fix executor: backend-developer (Claude). Fix re-review: codex lane. The reviewer that raised M1/M2/m1
  confirms they are closed, and the fixer and reviewer are from different families.

- Team-leader verification (2026-09-14):
  - `npx nx run-many -t typecheck test lint -p @ptah-extension/memory-curator @ptah-extension/platform-core`
    at default parallelism, skip-nx-cache: 2 projects, PASS. memory-curator: 542 passed, 59 skipped in 2
    older native-gated suites. platform-core: 576 passed. Lint: 0 errors.
  - Thoth-runtime + cli-engine typecheck: 2 projects, PASS.
  - Per-file Jest results: service 27, store 20, integration 4, register 2, all passed, 0 pending.
  - Grep: `purgeOlderThan` only in `0039`. No VACUUM, no `processed_at =`, no CREATE INDEX, and no
    cron/skill/agent-sdk/rpc imports in the retention sources.
- Deviations judged:
  1. The `MEMORY_RETENTION_LIMITS` token is ACCEPTED. tsyringe resolves every constructor parameter from
     `design:paramtypes`, so an interface-typed limits parameter (even with a default value) resolves as
     `Object` and throws; di-lint also requires a registered token. This follows the
     `EMBEDDER_WORKER_IDLE_MS` precedent.
  2. The `retention-sqlite.test-support.ts` shared opener is ACCEPTED. It follows the
     `queue-db.test-support.ts` precedent. The missing `*.test-support.ts` exclude in `tsconfig.lib.json`
     is recorded for a later task.
  3. Checking `persistence-unavailable` before `not-due` is ACCEPTED; neither writes.
  4. The stuck DELETE is planned on `idx_obs_queue_drain` instead of rowid lookups: ACCEPTED, because it
     is a bounded SEARCH, not a SCAN.
  5. A purge batch visits at most `limit` sessions: ACCEPTED. The service loop ends on `exhausted`, not on
     `deleted === 0` (`memory-retention.service.ts:336-337`).
  6. Row-budget still runs the prune and reclaim, plus the `reclaim-budget` / `reclaim-stalled` partials:
     ACCEPTED, but the reviewer must confirm.
  7. Run 3 widens to 8/15 days: the plan's numbers do contradict each other. At `NOW+25h`, P-new
     (`NOW-6d`) and U-grace (`NOW-13d`) do become eligible under 7/14. Run 2 still proves `not-due` at
     defaults, and run 3 still proves an already-clean table is unchanged. It no longer proves that the
     default windows move with the clock. The reviewer decides whether a default-window run over those
     rows (expect exactly 50 purged + 40 quarantined, earlier ledger rows untouched) is required.
  8. The `page_count` drop includes pointer-map pages: ACCEPTED, but the reviewer must confirm the maths.
- Open for the reviewer: A6 (`session_id = ''` processed rows are never reached by the walk).

- Recommended executor: backend-developer (sub-agent)
- Fallback executor: a fresh backend-developer instance with only the unfinished tasks
- Execution mode: sequential
- Rationale: store → service → DI → purge removal → integration spec is one dependency chain in one lib,
  with shared `di/*` and barrel; correctness hinges on SQL plans and the never-mark-processed invariant.
- Tasks: 5 | Depends on: Batch 1 (migration 0043, reclaimer token), Batch 2 (settings defaults, `MemoryStorageHealthDto`)
- Review files: Batch 1 and 2 reviews are archived as `code-logic-review-batch-1.md` /
  `code-style-review-batch-2.md`. The Batch 3 reviewer writes a fresh `code-logic-review.md`; team-leader
  archives it as `code-logic-review-batch-3.md` before the next round.

### Task 3.1: Retention types + config (settings clamp, budget constants) — COMPLETE

- Files:
  - CREATE `D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\backend\memory-curator\src\lib\retention\memory-retention.types.ts`
  - CREATE `D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\backend\memory-curator\src\lib\retention\memory-retention-config.ts`
- Plan reference: implementation-plan.md:436-443, 477-491, 513-516
- Pattern to follow: `memory-curator/src/lib/triggers/memory-trigger-config.ts` (`readMemoryTriggers`)
- Quality requirements: `MEMORY_RETENTION_KEYS`; clamps (processedDays 1–365, stuckDays 7–365, batchSize
  50–5,000); non-finite → default; constants object injectable into the service (the integration spec
  overrides `RETENTION_MAX_ROWS_PER_RUN` to 250).
- Implementation details: `RetentionSkipReason` union exactly as the plan; report union; constants table values.

### Task 3.2: `ObservationRetentionStore` + spec — COMPLETE

- Files:
  - CREATE `D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\backend\memory-curator\src\lib\retention\observation-retention.store.ts`
  - CREATE `D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\backend\memory-curator\src\lib\retention\observation-retention.store.spec.ts`
- Depends on: Task 3.1
- Plan reference: implementation-plan.md:321-431
- Pattern to follow: statement cache by db identity `observation-queue.store.ts:287-299,477-488`;
  `BEGIN IMMEDIATE` idiom `:625-637`; opener `observation-queue.store.spec.ts:44-80,549-600`; busy code
  matching `persistence-sqlite/src/lib/sqlite-errors.ts`
- Quality requirements: SQL verbatim from the plan (session-keyset walk with `INDEXED BY`, `json_each(@ids)`
  bound JSON, upsert with WHERE, DELETE re-checking `processed_at IS NULL`); one transaction per batch
  method, no internal loops; `RetentionStepError` with `database-busy` | `sql-error`; `readLiveStorage`
  never throws (null fields + `readErrors`).
- Validation notes: A3 — spec runs on whichever opener loads and FAILS if none loads. Plan assertions on a
  fresh DB with no `ANALYZE`: every SELECT uses a covering index or rowid; no bare `SCAN observation_queue`.
  Statement-text assertion: nothing sets `processed_at`.
- Implementation details: methods `purgeProcessedBatch`, `quarantineStuckBatch`, `pruneLedger`,
  `readLiveStorage`, `countTotalRows`, `readState`, `writeRun`, `writeSkip`.

### Task 3.3: `MemoryRetentionService` facade + DI registration + barrel + unit spec — COMPLETE

- Files:
  - CREATE `D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\backend\memory-curator\src\lib\retention\memory-retention.service.ts`
  - CREATE `D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\backend\memory-curator\src\lib\retention\memory-retention.service.spec.ts`
  - CREATE `D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\backend\memory-curator\src\lib\di\register.spec.ts`
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\backend\memory-curator\src\lib\di\tokens.ts`
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\backend\memory-curator\src\lib\di\register.ts`
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\backend\memory-curator\src\index.ts`
- Depends on: Task 3.2
- Plan reference: implementation-plan.md:433-541
- Pattern to follow: single-flight flag `SqliteIntegrityService.dispatching`; `startedAt` in constructor
  `skill-synthesis/src/lib/queue/skill-drain.service.ts:618`; yield idiom
  `agent-sdk/.../session-history-reader.service.ts:63-64`; registration beside `MEMORY_DECAY_JOB` `register.ts:129-133`
- Quality requirements: 8 gates in order (`not-due` writes nothing); run steps purge → quarantine → ledger
  prune → reclaim + `checkpointPassive` → record; adaptive halving >120 ms (batch floor 50, step floor 256);
  row cap 50,000, wall 60 s, reclaim cap 32,768 pages; outcome mapping completed/partial/failed; `run` never
  rejects, flag cleared in `finally`; `storageHealth()` never throws and returns `MemoryStorageHealthDto`
  (from `@ptah-extension/shared`) with `nextDueAt` rule; error text sanitized of absolute paths.
- Validation notes: no import of `cron-scheduler`, `skill-synthesis`, `agent-sdk`, `rpc-handlers`. Settings
  parity spec imports `FILE_BASED_SETTINGS_DEFAULTS` and compares with config fallbacks (Batch 2).
  `register.spec.ts` (reachability, Component 11 item 3): `isRegistered` true for
  `MEMORY_RETENTION_SERVICE` and `OBSERVATION_RETENTION_STORE` after `registerMemoryCuratorServices`.
- Carried from Batch 2 review (minor): add a one-line comment above the four `memory.retention.*` entries
  in BOTH blocks of
  `D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\backend\platform-core\src\file-settings-keys.ts`
  (`:334-337`, `:591-594`) stating the defaults must equal the `memory-retention-config.ts` fallbacks and
  are pinned by `memory-retention.service.spec.ts`. Comment only; no value change.
- Implementation details: tokens `OBSERVATION_RETENTION_STORE = Symbol.for('PtahObservationRetentionStore')`,
  `MEMORY_RETENTION_SERVICE = Symbol.for('PtahMemoryRetentionService')`, both singleton; 5 injected deps;
  barrel exports class, report types, `MEMORY_RETENTION_KEYS`, and the tokens via `MEMORY_TOKENS`.

### Task 3.4: Delete `purgeOlderThan` / `PURGE_SQL` and every mention — COMPLETE

- Files:
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\backend\memory-curator\src\lib\observation-queue.store.ts` (delete `:155`, `:648-654`; rewrite docs `:25-29`, `:322`, `:587`)
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\backend\memory-curator\src\lib\observation-queue.store.spec.ts` (remove test `:305-321`; rewrite comment `:418`)
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\backend\memory-curator\src\lib\observation-queue.store.rekey.spec.ts` (comment `:7`) — not in the plan's list; R-TL2
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\backend\memory-curator\src\lib\memory-search.service.spec.ts` (`:129`)
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\backend\memory-curator\src\lib\triggers\memory-trigger.boot-defer.spec.ts` (`:174`)
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\backend\memory-curator\src\lib\triggers\memory-trigger.boot-scan-budget.spec.ts` (`:172`)
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\backend\memory-curator\src\lib\triggers\memory-trigger.integration.spec.ts` (`:141`)
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\backend\memory-curator\src\lib\triggers\memory-trigger.service.spec.ts` (`:310`)
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\backend\memory-curator\CLAUDE.md` (retention entries; correct the false "`memory-decay.job.ts` — registered with cron-scheduler" line)
- Depends on: Task 3.3
- Plan reference: implementation-plan.md:543-563
- Quality requirements: no orphan method, no commented-out code.
- Validation notes: `purgeOlderThan` may remain ONLY in `migrations/0039_reap_orphaned_queue_rows.ts:32,61`
  (forward-only history).

### Task 3.5: Integration spec — real SQLite, fake clock (reachability: rows leave the table) — COMPLETE

- File: CREATE `D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\backend\memory-curator\src\lib\retention\memory-retention.integration.spec.ts`
- Depends on: Tasks 3.2, 3.3
- Plan reference: implementation-plan.md:802-842
- Pattern to follow: opener `observation-queue.store.spec.ts:44-80,549-600` (adapter adds `pragma(sql,{simple})` and `transaction`)
- Quality requirements (acceptance, not optional): temp-file DB (never `~/.ptah`); `auto_vacuum = INCREMENTAL`
  before schema; migrations 0016 + 0043; real store, real `SqlitePageReclaimer`, real service; seed P-old
  1,200 / P-new 50 / P-old-captured-new-processed 10 / U-grace 40 / U-stuck 300 (2 sessions x 2 kinds),
  `batchSize = 100`; every run-1 assertion in the plan (incl. 4 ledger rows summing 300, `processed_at`
  snapshot unchanged, `page_count` drop equals `pagesReclaimed`, `last_completed_at === NOW`,
  `pendingRows === 40`); run 2 `not-due`; run 3 idempotent; budget test (cap 250 → `partial`, next hour due
  and finishes); failure test (third batch throws → `failed`, batches 1-2 committed, `last_error`
  persisted, next run not `already-running`).
- Validation notes: FAILS (no `it.skip`) when no opener loads; R7 pinned here.

### Batch 3 verification

- Every listed artifact exists and contains real work.
- `npx nx run-many -t typecheck test lint -p @ptah-extension/memory-curator @ptah-extension/platform-core`
  passes; header must report **2 projects** (platform-core is included because of the Task 3.3 comment).
- Regression: `npx nx run-many -t typecheck -p @ptah-extension/thoth-runtime @ptah-extension/cli-engine`
  passes; header must report **2 projects**.
- Jest output lists `memory-retention.integration.spec.ts`, `observation-retention.store.spec.ts`,
  `memory-retention.service.spec.ts`, `di/register.spec.ts` with 0 skipped tests.
- Grep `purgeOlderThan` across `libs/` and `apps/` matches only `0039_reap_orphaned_queue_rows.ts`.
- Reviewer: code-logic-reviewer (SQL plans, never-mark-processed invariant, budgets, failure paths).

---

## Batch 4: Diagnostics contract — storage in `memory:diagnostics` — COMPLETE (commit e26f40fb4; includes Task 4.3 rounds 1-2, final re-review APPROVED)

- Task 4.3 re-review (`code-logic-review-batch-4-fixes.md`): APPROVED WITH FIXES. S1 and M1 closed. New
  moderate: the `not measured above 5000 pending rows` token is also pushed when the pending read failed,
  which is a false message. Round 2 (same executor lane): push the token only when `pendingRows` is known
  and above the bound, plus a failing-read regression spec. The same Claude reviewer re-checks it.

- Routing (2026-09-14, lanes first): CLI lane from a different family than the Batch 5 lane; reviewer from a
  different family than this executor; fallback backend-developer. No dependency on Task 1.4
  (`persistence-sqlite` is not touched or needed). Runs in parallel with Batch 5 (file-disjoint).
- Team-leader verification (Batches 4 + 5 together, `--parallel=1`):
  `npx nx run-many -t typecheck test lint --parallel=1 -p @ptah-extension/memory-curator @ptah-extension/rpc-handlers @ptah-extension/shared @ptah-extension/thoth-runtime @ptah-extension/cli-engine`
  covered 5 projects and PASSED:
  - shared 1,398 passed; memory-curator 547 passed / 59 skipped (older native-gated suites);
    rpc-handlers 2,993 / 33 skipped; thoth-runtime and cli-engine 87 + 178 passed; 0 lint errors.
  - `npx nx run-many -t typecheck -p @ptah-extension/memory-curator-ui`: 1 project, PASS.
  - Handler diff is +1 line. No `incremental_vacuum(100)` and no literal rotate counts remain in
    production code. The Electron retention registration sits in the same guarded block as the drain and
    integrity jobs.
- Review (Claude, cross-family), `code-logic-review-batch-4.md`: APPROVED WITH FIXES, 6/10, 0 blocking,
  1 serious, 1 moderate.
  - S1: `PENDING_BYTES_SQL` (`observation-retention.store.ts:99-104`, committed in Batch 3) sums five payload
    columns over ALL pending rows. `idx_obs_queue_drain` does not cover them, so cost grows with the
    backlog, and Batch 4 made it run on every 30 s diagnostics poll on the main thread.
  - M1: no guard or recorded invariant around `storageHealth()` at `diagnostics.service.ts:61`.
- Task 4.3 (fix, COMPLETE in e26f40fb4), executed by the Batch 4 lane and re-reviewed by the same Claude reviewer.
  Design (team-leader validated the orchestrator's pick of the reviewer's option c):
  - A named store constant `PENDING_BYTES_MAX_ROWS = 5_000` (the plan's measured 26 ms case).
    `readLiveStorage` runs `PENDING_BYTES_SQL` only when the pending read succeeded AND
    `pendingRows <= PENDING_BYTES_MAX_ROWS`. Otherwise `pendingBytes = null` and a stable readErrors
    entry `pendingBytes: not measured above 5000 pending rows` is pushed (no `warn` log: a policy skip,
    not a failure).
  - `pendingRows`, `oldestPendingAt`, `stuckEligibleRows` stay live and index-only.
  - Docblock timing note beside `PENDING_BYTES_SQL`.
  - A real-SQLite store spec: 5,001 pending rows issue no byte-sum statement, give `pendingBytes`
    null plus the token, and leave the other three fields correct. At exactly 5,000 the byte sum runs
    and is correct.
  - M1: a local `try/catch` around `storageHealth()` in `getSnapshot` would need a fallback DTO, which
    means a second copy of the shape. Record the invariant instead, as a one-line comment at the call
    site that names the never-throws contract and the spec pinning it.
  - It lands IN THE BATCH 4 COMMIT: the unbounded read only became a per-poll cost with Batch 4's wiring,
    so the commit that introduces the poll path also bounds it.
- Batch 5 reviewer must also check (team-leader read of the diff):
  - `createMemoryRetentionHandler` resolves `CRON_POWER_MONITOR` outside the try. A missing or disposed
    power monitor gives a thrown run (a `failed` row) rather than a skip. Is that the intended failure
    channel?
  - `foregroundActivityReader` calls `tracker.start()` on hosts where the skill drain is disabled.
    Confirm `start()` is idempotent and side-effect-safe there.

- Recommended executor: backend-developer (sub-agent)
- Fallback executor: CLI lane x1 with the self-contained Task 4.1-4.2 prompt
- Execution mode: sequential
- Parallel with: Batch 5 (file-disjoint: this batch never edits `libs/backend/thoth-runtime`,
  `libs/backend/cli-engine`, or `memory-curator/src/index.ts` / `di/*`)
- Rationale: small cross-lib contract change whose required field and its only producer must land together.
- Tasks: 2 | Depends on: Batch 3

### Task 4.1: Required `storage` field on the wire + handler pass-through — COMPLETE

- Files:
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\shared\src\lib\types\rpc\rpc-curator-diagnostics.types.ts` (`MemoryDiagnosticsResult` gains `readonly storage: MemoryStorageHealthDto;`)
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\backend\rpc-handlers\src\lib\handlers\memory-rpc.handlers.ts` (add exactly `storage: snapshot.storage,`)
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\backend\rpc-handlers\src\lib\handlers\memory-rpc.handlers.spec.ts` (fixtures `:120`, `:593`, `:633` gain `storage`; assert returned unchanged)
- Depends on: Task 4.2 (snapshot must carry `storage` for the handler to typecheck) — implement 4.2 first
- Plan reference: implementation-plan.md:654-732
- Validation notes: R-TL1. No new RPC method, no `rpc.types.ts` method-map or `ALLOWED_METHOD_PREFIXES` change.
  `memory-rpc.handlers.ts` grows by one line.

### Task 4.2: `MemoryDiagnosticsService` sets `storage` — COMPLETE

- Files:
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\backend\memory-curator\src\lib\diagnostics.types.ts` (`storage: MemoryStorageHealthDto` typed from shared)
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\backend\memory-curator\src\lib\diagnostics.service.ts` (inject `MEMORY_TOKENS.MEMORY_RETENTION_SERVICE`; `storage: this.retention.storageHealth()`)
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\backend\memory-curator\src\lib\diagnostics.service.spec.ts` (all 6 `new MemoryDiagnosticsService(` sites; `storage` present and passed through)
- Plan reference: implementation-plan.md:710-731
- Quality requirements: diagnostics poll issues no unfiltered `COUNT(*) FROM observation_queue` (the spec
  asserts via the SQL the retention store issues; covered by Task 3.2/3.3 — confirm it is asserted).

### Batch 4 verification

- `npx nx run-many -t typecheck test lint -p @ptah-extension/memory-curator @ptah-extension/rpc-handlers @ptah-extension/shared`
  passes; header must report **3 projects**.
- Regression: `npx nx run-many -t typecheck -p @ptah-extension/memory-curator-ui` passes; header **1 project**.
- Reviewer: code-style-reviewer (contract shape, one-line handler growth, no second mapping).

---

## Batch 5: `@ptah/memory-retention` cron job in both hosts + keep-literal call sites — COMPLETE (commit 993261e7b)

- The cross-family review (`code-logic-review-batch-5.md`) raised a moderate: the CLI specs did not prove
  repeated-start idempotency. The fix added a stateful-registry double-activation test, spec only.
  Re-review `code-logic-review-batch-5-fixes.md`: APPROVED, moderate CLOSED. Team-leader checks: 2a (power
  monitor resolved outside the try → `failed` run row) follows the established failure channel, no defect;
  2b `tracker.start()` is idempotent and safe, no defect. Committed thoth-runtime plus the CLI
  `thoth-runtime{,.spec}.ts` only.
- Follow-up recorded (out of scope, not a defect): `apps/ptah-tui/src/components/thoth/MemoryPanel.tsx`
  consumes `MemoryDiagnosticsResult` and compiles with the new `storage` field, but does not render it.
  Surfacing storage in the TUI is a later-phase enhancement.

- Routing (2026-09-14, lanes first): CLI lane from a different family than the Batch 4 lane; reviewer from a
  different family than this executor; fallback backend-developer.
- Dependency on Task 1.4: none in behaviour. `IBackupService.backup(kind)` / `rotate(kind, keep)` keep
  their signatures under atomic publish; Batch 5 only swaps the `rotate('daily', 7)` literal for
  `KEEP_BY_KIND.daily` (already committed in 6c335b73a), and its specs mock `IBackupService`. Typecheck
  compiles `persistence-sqlite` source through path mappings, so a failure pointing into that folder is
  reported as "possibly in-flight Task 1.4", not fixed here.
- File conflict removed: the Batch 1 review carry (scope the `persistence-sqlite/CLAUDE.md` "rotate only
  after a non-null backup" line) is MOVED OUT of Task 5.2, because the Task 1.4 lane is rewriting that file
  now. It is now carried by Task 1.4 (R6 prose pass or its re-review fixes).

- Recommended executor: backend-developer (sub-agent)
- Fallback executor: a fresh backend-developer instance with only the unfinished tasks
- Execution mode: sequential
- Parallel with: Batch 4 (file-disjoint), and may overlap Batch 6
- Rationale: two host seams that must stay in step, sharing one job spec and handler factory; the host
  reachability specs are the core acceptance and need judgment about stub containers.
- Tasks: 3 | Depends on: Batch 3 (service token + report types), Batch 1 (`KEEP_BY_KIND` export)

### Task 5.1: Job spec + handler factory — COMPLETE

- Files:
  - CREATE `D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\backend\thoth-runtime\src\lib\memory-retention-job.ts`
  - CREATE `D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\backend\thoth-runtime\src\lib\memory-retention-job.spec.ts`
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\backend\thoth-runtime\src\index.ts`
- Plan reference: implementation-plan.md:582-619
- Pattern to follow: `skill-drain-jobs.ts:13-40`; per-run power monitor resolve `start-thoth-cron.ts:66-75`;
  resolve-failure skip `:178-194`; `job-runner.ts:212-232` (throw → `markFailed`)
- Quality requirements: `jobId '@ptah/memory-retention'`, `name 'Memory Retention'`, `handlerName 'memory:retention'`,
  `cronExpr '17 * * * *'`, `timezone 'UTC'`; handler resolves service in try (→ `skipped`,
  `retention-service-unavailable`), power monitor per run, optional foreground tracker (`start()` then
  `msSinceLastActivity`, else `Infinity`); report mapping incl. throw on `failed` with a reason token only.

### Task 5.2: Electron host registration + reachability spec — COMPLETE

- Files:
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\backend\thoth-runtime\src\lib\start-thoth-cron.ts`
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\backend\thoth-runtime\src\lib\start-thoth-cron.spec.ts`
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\backend\thoth-runtime\CLAUDE.md`
- Depends on: Task 5.1
- Plan reference: implementation-plan.md:620-629, 780-791; Component 3 call site 281-319
- Quality requirements: guarded `registerMemoryRetentionJob(...)` after the integrity block (`:409-427`), own
  try/catch, `isRegistered` early return, `handlerRegistry.has` guard, `withActivityEmit(emit, 'memory:retention', ...)`,
  unconditional upsert; DELETE the `incremental_vacuum(100)` try block (`:344-353`), keep `optimize`;
  `rotate('daily', KEEP_BY_KIND.daily)` at `:324`.
- Validation notes (reachability acceptance): token imported from `@ptah-extension/memory-curator`, never
  re-declared; exact upsert object; handler invoked with a fake ctx reaches `service.run` with `ctx.signal`;
  double start registers once / upserts twice; no token → no retention upsert, other jobs unaffected; backup
  handler no longer calls `incremental_vacuum(100)` (update `start-thoth-cron.spec.ts:158`) but still `optimize`;
  `rotate('daily', 7)` still asserted.
- MOVED to Task 1.4 (do NOT edit in Batch 5; the Task 1.4 lane owns the file now). Carried from Batch 1 review (minor):
  `D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\backend\persistence-sqlite\CLAUDE.md`.
  Its line "Call sites pass `KEEP_BY_KIND[kind]`, never a literal, and rotate only after a non-null
  `backup()`" overstates the rule: the daily cron call sites rotate unconditionally
  (`backup.service.ts:449-452`). Scope the non-null rule to the migration-runner and `db:reset` call
  sites. Batch 4 and Batch 6 do not touch this file.

### Task 5.3: CLI host registration + reachability spec — COMPLETE

- Files:
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\backend\cli-engine\src\lib\bootstrap\thoth-runtime.ts`
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\backend\cli-engine\src\lib\bootstrap\thoth-runtime.spec.ts`
- Depends on: Task 5.1
- Plan reference: implementation-plan.md:630-633, 792-796
- Quality requirements: `registerMemoryRetentionJob(container, logger)` called after `registerSkillDrainJobs`
  (`:324`), same guards, spec + factory imported from `@ptah-extension/thoth-runtime`, no activity emitter,
  `warn` on registration failure; `rotate('daily', KEEP_BY_KIND.daily)` at `:391`.
- Validation notes (reachability acceptance): `runtime` tier upserts `@ptah/memory-retention` and registers
  `memory:retention` once; handler reaches `service.run`; `oneshot` tier registers nothing; `rotate('daily', 7)`
  still asserted.

### Batch 5 verification

- `npx nx run-many -t typecheck test lint -p @ptah-extension/thoth-runtime @ptah-extension/cli-engine`
  passes; header must report **2 projects**.
- Grep: no `incremental_vacuum(100)` in `libs/`; no `rotate('daily', 7)` / `rotate('pre-migration', 3)` literal
  in production code.
- Reviewer: code-logic-reviewer (reach proof, failure channel, per-run resolves, idempotent registration).

---

## Batch 6: Frontend storage + retention panel — COMPLETE (commit 979fbf013)

- Executor: Ollama Cloud lane. Style review (Claude, cross-family) `code-style-review-batch-6.md`: first pass
  APPROVED WITH FIXES (2 serious: the `now` input was not wired, count formatting depended on the locale;
  2 minor). Re-check APPROVED, all 4 closed.
- Team-leader verification: `npx nx run-many -t typecheck test lint --parallel=1 -p @ptah-extension/memory-curator-ui`
  covered 1 project and PASSED, 183 tests. ESLint on the 4 changed source files gave 0 problems; the 27
  project warnings are elsewhere. No `[innerHTML]`, OnPush, `aria-label="Storage and retention"`.
- Follow-up recorded (non-blocking, outside scope): `formatSnapshot` in
  `memory-diagnostics-accordion.component.ts:335` uses an unpinned `toLocaleString()`.

- Recommended executor: frontend-developer (sub-agent)
- Fallback executor: CLI lane x1 with the self-contained Task 6.1-6.2 prompt
- Execution mode: sequential
- Parallel with: Batch 5 (file-disjoint; this batch edits only `libs/frontend/memory-curator-ui`)
- Rationale: Angular OnPush presentational component + one state signal; frontend conventions apply.
- Tasks: 2 | Depends on: Batch 4 (`MemoryDiagnosticsResult.storage` must exist)

### Task 6.1: `StorageHealthPanelComponent` + spec — COMPLETE

- Files:
  - CREATE `D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\frontend\memory-curator-ui\src\lib\components\diagnostics\storage-health-panel.component.ts`
  - CREATE `D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\frontend\memory-curator-ui\src\lib\components\diagnostics\storage-health-panel.component.spec.ts`
- Plan reference: implementation-plan.md:734-775
- Pattern to follow: `db-health-panel.component.ts:44` (`NativeCardComponent`, OnPush, signal input)
- Quality requirements: selector `ptah-storage-health-panel`; `input<MemoryStorageHealthDto | null>(null)`;
  every field listed in the plan; processed figures labelled "as of last retention run" / estimate (R8);
  `aria-label="Storage and retention"`, heading, outcome as text + badge; local pure byte and relative-time
  formatters; `null` → "No storage data yet", null field → "—"; no settings writes.
- Validation notes: spec covers nulls, `partial` with reason, `failed` with error, byte formatting.

### Task 6.2: State signal + accordion mount + fixtures — COMPLETE

- Files:
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\frontend\memory-curator-ui\src\lib\services\memory-diagnostics-state.service.ts`
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\frontend\memory-curator-ui\src\lib\services\memory-diagnostics-state.service.spec.ts` (exists; assert `storage` set on refresh)
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\frontend\memory-curator-ui\src\lib\services\memory-diagnostics-rpc.service.spec.ts` (fixtures gain `storage`)
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\frontend\memory-curator-ui\src\lib\components\diagnostics\memory-diagnostics-accordion.component.ts` (mount after `<ptah-db-health-panel>` at `:172`)
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\frontend\memory-curator-ui\src\lib\components\diagnostics\memory-diagnostics-accordion.component.spec.ts` (panel mounted)
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\frontend\memory-curator-ui\src\lib\components\memory-curator-tab.component.spec.ts` (stub gains `storage: signal(null).asReadonly()`) — R-TL3
- Depends on: Task 6.1
- Plan reference: implementation-plan.md:738-741, 754, 764-775
- Quality requirements: `_storage = signal<MemoryStorageHealthDto | null>(null)`, public readonly `storage`,
  set in `refresh()` next to `_dbHealth` (`:33,71`); frontend imports only `@ptah-extension/shared`.

### Batch 6 verification

- `npx nx run-many -t typecheck test lint -p @ptah-extension/memory-curator-ui` passes; header must report **1 project**.
- Reviewer: code-style-reviewer (Angular OnPush/signals conventions, a11y labels). Visual review is
  optional (Electron-only tab, additive panel).

---

## Batch 7: Verification — full suite, reachability, A1/A2 copy-based timing — COMPLETE (commits ac275917f, ad16d9498; test-report.md in the task-docs commit)

- Routing (2026-09-14):
  - Tasks 7.1 and 7.2: senior-tester sub-agent (NOT a lane). Task 7.2 reads from the user's home data
    directory `C:\Users\abdal\.ptah\state\`, which holds the only pre-migration rollback copy and the live
    DB. A mistake there cannot be undone. The sub-agent runs under the harness permission system; an
    auto-mode CLI lane does not. A sandboxed lane may also be unable to read outside the worktree, which
    would make the check unrunnable. Reviewer of `test-report.md`: a codex lane (cross-family) that checks
    the evidence, not the data.
  - Task 7.3: CLI lane (docs only), reviewer from a different family. Runs in parallel with 7.1/7.2
    (file-disjoint: 7.1/7.2 edit no source).
- Fallback executor: backend-developer running the same commands and procedure
- Execution mode: 7.1 then 7.2 sequential (one agent); 7.3 parallel
- Rationale: proves the acceptance criteria end to end and measures A1/A2 on real data shape; writes
  `test-report.md`. Produces no production code; a failed A1/A2 becomes a fix request against Batch 3's
  `memory-retention-config.ts` defaults (R1), not a worker move.
- Tasks: 2 | Depends on: Batches 5 and 6

### Task 7.1: Full suite + reachability confirmation — COMPLETE

- File: CREATE `D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\.ptah\specs\TASK_2026_440_834c\test-report.md`
- Commands (all must pass; each header must report **8 projects**):
  - `npx nx run-many -t test --parallel=1 -p @ptah-extension/persistence-sqlite @ptah-extension/memory-curator @ptah-extension/thoth-runtime @ptah-extension/cli-engine @ptah-extension/rpc-handlers @ptah-extension/shared @ptah-extension/platform-core @ptah-extension/memory-curator-ui` (`--parallel=1` because of R-TL7)
  - `npx nx run-many -t typecheck -p` (same 8)
  - `npx nx run-many -t lint -p` (same 8)
- Reachability acceptance (record test names and pass counts, 0 skipped): `start-thoth-cron.spec.ts`
  `describe('memory retention job')`; CLI `thoth-runtime.spec.ts` runtime-tier retention tests;
  `memory-curator/src/lib/di/register.spec.ts`; `sqlite-page-reclaimer.spec.ts` DI assertion;
  `memory-retention.integration.spec.ts` (all three tests).
- Mutation sanity: NOT performed in Batch 7. Editing host sources while the Task 7.3 lane works in the same
  worktree risks a stray edit reaching a commit. The reviewers already recorded mutation-sensitivity
  analysis for these specs (`code-logic-review-batch-5-fixes.md`, `code-logic-review-batch-3-fixes.md`,
  `code-logic-review-batch-1-task-1.4-r1.md`); cite it in `test-report.md`.

### Task 7.2: A1/A2 timing on a temp COPY of the pre-migration snapshot — COMPLETE (run 1 superseded for A1 by Task 7.4)

- Procedure (R-TL4 — every step mandatory):
  1. Record size and mtime of `C:\Users\abdal\.ptah\state\ptah.pre-migration-20260909T230600Z.sqlite`
     (expected 1,178,537,984 bytes, 2026-09-10 02:06). Never open, write, rename or delete it; never open
     `C:\Users\abdal\.ptah\state\ptah.sqlite`.
  2. Create a fresh dir with a fail-if-exists mkdir under `%TEMP%` (e.g.
     `C:\Users\abdal\AppData\Local\Temp\ptah-task-440-timing-<random>`), and copy the snapshot into it under a
     non-`ptah` name (e.g. `timing-copy.sqlite`) so no `ptah.pre-migration-*` rotation glob can match.
  3. Open ONLY the copy (better-sqlite3 if its ABI loads under Node, else `node:sqlite`). Record
     `PRAGMA auto_vacuum`, `page_size`, `page_count`, `freelist_count` and `MAX(version)` from
     `schema_migrations`. Add the retention tables by executing ONLY the migration 0043 SQL
     (`MIGRATIONS.find(m => m.version === 43).sql`, `IF NOT EXISTS`). Do NOT construct
     `SqliteMigrationRunner` or `SqliteBackupService` (they would back up and rotate). Do not set `PTAH_DB_PATH` to anything under
     `C:\Users\abdal\.ptah`.
  4. Drive the real `ObservationRetentionStore`, `SqlitePageReclaimer` and `MemoryRetentionService` (gates
     opened: `startedAt` > 10 min ago, not on battery, foreground `Infinity`) through a harness that is NOT
     committed (a temporary `*.timing.local.spec.ts` or script, deleted afterwards; `git status` must not list
     it). Log per-batch durations for purge batches of 500 (A2) and per-step durations for
     `reclaimStep(2048)` after the purge has freed pages (A1). Capture p50 / p95 / max, and whether adaptive
     halving triggered.
  5. On the COPY only (A6), BEFORE deleting it: count
     `SELECT COUNT(*) FROM observation_queue WHERE session_id = '' AND processed_at IS NOT NULL` before and
     after the purge measurements, and report both. A nonzero after-count means a fix before merge.
  5b. Close the copy, re-check the original snapshot's size and mtime (must be unchanged), then delete the
     temp dir.
  6. Record in `test-report.md`: environment (opener, SQLite version, disk), counts, p50/p95/max per metric,
     and PASS/FAIL against A1 (<= ~100 ms/step) and A2 (<= ~60 ms/batch), with every call <= 120 ms as the
     hard design bound. On FAIL, recommend lowered defaults for `memory-retention-config.ts` (and
     `file-settings-keys.ts` batchSize default parity).

### Task 7.2 result (run 1) — FAILED on A1; re-measure required (Task 7.4)

- `test-report.md` run 1: 7.1 PASS (8/8 test, typecheck, lint; reachability 0 skipped). A2 PASS (350
  batches, p50 7 / p95 50 / max 66 ms). A6: 0 empty-session processed rows, so no fix. Safety OK
  (snapshot unchanged, temp dir and harness deleted).
- **A1 FAIL**: `reclaimStep(2048)`, 113 steps, p50 588 / p95 1,227 / max 1,687 ms (about 0.29 ms/page p50,
  0.82 ms/page max).
- Team-leader findings before any constant change:
  1. **The harness did not use production connection pragmas.** Production opens with
     `journal_mode = WAL`, `synchronous = NORMAL`, `temp_store = MEMORY`, `mmap_size = 268435456`,
     `busy_timeout = 5000` (`sqlite-connection.service.ts:85-92`). The report records none of them;
     `node:sqlite` defaults are a rollback journal with `synchronous = FULL`. Each `reclaimStep` is its own
     transaction, and in DELETE-journal/FULL mode it pays journal writes plus several fsyncs per step, while
     WAL/NORMAL defers fsync to checkpoint. Run 1 very likely overstates production A1 by a large factor.
     It may also have overstated A2. It is not valid evidence for picking a constant.
  2. **Halving is per run, so the initial step must itself be safe.** `step` is a local in
     `reclaimPages` (`memory-retention.service.ts:~463`), reset to `limits.reclaimPagesPerStep` on every
     hourly run, and halved only AFTER a slow step. The first step of every run always costs the full
     initial size, so the initial value (not the floor) must meet the 120 ms bound.
  3. CORRECTED by Task 7.4: `better-sqlite3` does NOT work in plain Node here. The repository binary is built for
     Electron's ABI (NODE_MODULE_VERSION 143 vs Node's 137): `require` succeeds but `new Database` fails. Run 1's
     "loaded fine outside Jest" note was a `require`-only check. No agent-side cross-check with the production
     binding is possible without rebuilding `node_modules`, which was correctly not done.
- Decision: NO constant change until a re-measurement under production pragmas (Task 7.4). Then Task 7.5
  sets the constants from that data by a fixed rule, which avoids a change-then-remeasure loop.

### Task 7.4: Re-measure A1 (and A2) under production pragmas across step sizes — COMPLETE (A1: PASS at initial=256, floor=64)

- Result (`test-report.md` "## Task 7.4"):
  - Pragmas were read back as WAL / NORMAL / INCREMENTAL on every connection. Safety proofs complete.
  - A1 sweep (node:sqlite, production pragmas): 2048 p95 1,172 / max 1,181 FAIL; 1024 FAIL; 512 p95 151
    FAIL; 256 p50 20 / p95 44 / max 44 PASS; 128 max 13; 64 max 7.
  - Service run, default 2048: 16 steps, max exactly 120 ms, no halving (the condition is `> 120`), zero
    margin.
  - Service run, override 256/64: 128 steps, mostly 1–7 ms with periodic 25–43 ms spikes (WAL checkpoint),
    no halving, faster wall time.
  - Both runs ended on the row cap and the page cap.
- Team-leader judgement: 256 is ACCEPTED. The sweep's descending order on one file makes the large sizes
  partly cold-cache, a confound the tester named. The 256 service run on its own fresh copy (max 43 ms
  over 128 steps, including checkpoint spikes) independently gives about 2.8× margin under the 120 ms bound
  for the first, unhalved step of a run.
- R-TL8 (A2 checkpoint spike), decision RECORD AS RESIDUAL, no mitigation:
  - One of 350 purge batches took 487 ms, consistent with an automatic WAL checkpoint landing inside that
    transaction.
  - Reasons not to mitigate:
    (a) The autocheckpoint belongs to the shared connection. Any writer can trigger it, including the
        250 ms capture flushes, so it is not specific to retention.
    (b) An explicit `checkpointPassive()` every N purge batches moves the same fsync onto the main thread
        rather than removing it, and proving it helps needs another copy-based measurement loop.
    (c) Retention runs only after 5 minutes without foreground activity and never on battery, so a rare
        sub-second stall lands while the user is not interacting.
    (d) The adaptive halving that such a batch triggers shrinks later batches' WAL volume for the rest of
        the run.
  - Closing step: the manual Electron field check (R-TL9) reads the per-batch debug durations on real
    hardware.
- R-TL9 (M2 unmeasured, the production binding): OPEN. All A1/A2 data is from node:sqlite 3.51.3.
  Closing step for the user, since it needs the user's Electron app rather than an agent:
  - Copy `C:\Users\abdal\.ptah\state\ptah.pre-migration-20260909T230600Z.sqlite` to a temp folder under a
    name not starting with `ptah`.
  - Launch the Electron dev build with `PTAH_DB_PATH` pointing at that copy and debug logging on, and leave
    it idle for more than 10 minutes.
  - Confirm: no retention work in the first 10 minutes; the `retention purge batch` and `retention reclaim
    step` debug `durationMs` values stay at or below about 120 ms (a rare checkpoint outlier aside); the
    copy shrinks across idle hourly ticks; the Memory diagnostics panel shows the run.
  - This item goes in the Mode 3 summary.

- Executor: senior-tester sub-agent (the same R-TL4 safety reason as 7.2). Procedure: the Task 7.2 rules
  plus production pragmas, a step-size sweep, a better-sqlite3 cross-check, and a service run with a
  debug-capturing logger.
- Selection rule for Task 7.5 (applied to the WAL/NORMAL `node:sqlite` sweep; the better-sqlite3 run must
  not contradict it):
  - `RETENTION_RECLAIM_PAGES_PER_STEP` = the LARGEST of {2048, 1024, 512, 256, 128, 64} whose max ≤ 120 ms
    and p95 ≤ 100 ms.
  - `RETENTION_MIN_RECLAIM_PAGES_PER_STEP` = max(16, that value / 4).
  - If even 64 fails, return a BLOCKER to the architect (R1: the main-thread reclaim design is not viable).

### Task 7.5: Set reclaim step constants from Task 7.4 data — COMPLETE (commit ad16d9498)

- The orchestrator reviewed the 17-line diff line by line against `reclaimPages` (`memory-retention.service.ts:465,490-492`):
  APPROVED. 128 steps of about 5 ms each fit the 60 s budget, and the pin test fails on a silent revert.
- R-TL10 (recorded flake, pre-existing): `memory-curator` `triggers/boot-scan-runner.spec.ts` "aborts mid-scan
  when AbortSignal triggers" timed out once under load during the Task 7.5 gate, then passed on rerun (Nx marked it
  flaky). The file is not touched by this task; it passed again at HEAD in the Mode 3 run (19/19).

## Completion (Mode 3, 2026-09-14)

- Commits verified in `git log` (all ancestors of HEAD), each with only its batch's files: 6c335b73a, 969401b7c,
  3f2ab4f4f, 6a2190a64, 993261e7b, e26f40fb4, 979fbf013, ac275917f, ad16d9498.
- Reachability specs at HEAD:
  - thoth-runtime: `start-thoth-cron.spec.ts` 30 passed, `memory-retention-job.spec.ts` 9 passed.
  - cli-engine: 179/179 passed (includes the runtime, repeated-start and oneshot retention tests).
  - memory-curator: `di/register.spec.ts` 2, `memory-retention.integration.spec.ts` 5,
    `memory-retention.service.spec.ts` 31, `observation-retention.store.spec.ts` 23, all passed.
  - persistence-sqlite: `sqlite-page-reclaimer.spec.ts` 18, `0043_memory_retention.spec.ts` 11 passed;
    `backup.service.spec.ts` 40 and `integrity-worker-protocol.spec.ts` 45 passed, with 3 POSIX-only tests pending.
- Invariant greps at HEAD: `purgeOlderThan` only in migration 0039's historical comments; no `incremental_vacuum(100)`.
- Residuals left open: R-TL8 (rare WAL-checkpoint stall inside a purge batch), R-TL9 (production better-sqlite3 binding
  unmeasured; manual Electron field check), R-TL7 and R-TL10 (load-sensitive pre-existing spec flakes), A1/A2 numbers
  from node:sqlite only, the old-code partial daily backup trusted once on upgrade day, and hard-link-less filesystems
  (loud failure).
- Gate 3 (whole-branch logic review by antigravity, the only family that wrote no code on the branch),
  `code-logic-review-branch.md`: APPROVED WITH FIXES, 9.2/10, 0 blocking, 0 serious, 1 moderate, 3 minor.
  - Cleared cross-batch: no write transaction across an `await`; bounded diagnostics poll; backup and
    retention safe under WAL with `quick_check` before publish; dual-host slot claim; boot deferral; the
    upgrade migration took 9 ms.
  - Moderate FIXED in `e27212537`: the panel showed a past `nextDueAt` (backlog run, set to
    `lastFinishedAt`) as "N min ago". It now renders "at the next idle hourly check" unless
    `nextDueAt > now`; a spec covers past and future. The orchestrator reviewed the 2-file diff line by
    line: APPROVED. Team-leader re-ran `@ptah-extension/memory-curator-ui` typecheck, test and lint:
    1 project, 184 passed, 0 errors.
  - Minor: power monitor resolved outside the try. No change; the Batch 5 re-review already judged it
    consistent with the skill-drain failure channel.
  - Minors: R-TL8 and the hard-link limit, already recorded residuals.
  - Review factual slip, no action: it gives the staging sweep threshold as 10 min; the code uses
    2 × `BACKUP_WORKER_BUDGET_MS` = 40 min.
- Follow-ups to file: surface `storage` in the TUI `apps/ptah-tui/src/components/thoth/MemoryPanel.tsx`; pin the
  locale in `formatSnapshot` (`memory-diagnostics-accordion.component.ts:335`); add a `*.test-support.ts` exclude to
  `libs/backend/memory-curator/tsconfig.lib.json`.

- Values: `RETENTION_RECLAIM_PAGES_PER_STEP = 256` (1 MB at 4 KB pages), `RETENTION_MIN_RECLAIM_PAGES_PER_STEP = 64`.
  The per-run cap stays 32,768. No A2 mitigation (R-TL8 residual).

- Executor: CLI lane (codex). Reviewer: a different family. Files:
  `libs\backend\memory-curator\src\lib\retention\memory-retention-config.ts`, `memory-retention.service.spec.ts`
  (the halving sequence at `:468-473`), `libs\backend\memory-curator\CLAUDE.md` (the "reclaim step (floor
  256)" text), and the constants' doc comments. The per-run cap stays 32,768 pages. It is committed
  separately; the Batch 7 `test-report.md` is committed only after A1 passes.

### Task 7.3: Name the hard-link residual in backup docs (Batch 1 r1 review, moderate) — COMPLETE (commit ac275917f)

- Files: `D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\backend\persistence-sqlite\CLAUDE.md`
  (residuals paragraph) and `...\libs\backend\persistence-sqlite\src\lib\backup.service.ts` (docblock `:21-27`).
- One sentence each: without hard-link support in the backups directory,
  atomic publish fails, so every backup reports not-taken / critical degradation, permanently and
  loudly. There is no copy or rename fallback by design.
- Executor: any developer lane (docs only). Committed separately from `test-report.md`.

### Batch 7 verification

- `test-report.md` exists with the three 8-project runs, reachability evidence, and A1/A2 measurements.
- Original snapshot size/mtime unchanged; temp dir removed; no harness file in `git status`.
- The Batch 7 test commit contains only `test-report.md`. The Task 7.3 docs commit contains only its 2
  persistence-sqlite files.
