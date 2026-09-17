# Backend implementation — `TASK_2026_440_834c`, batch 3

**Tasks completed**: 3.1, 3.2, 3.3, 3.4, 3.5 (all done, none stubbed)

## Files

Worktree root: `D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention`

- CREATED `...\libs\backend\memory-curator\src\lib\retention\memory-retention.types.ts`: `RetentionSkipReason` (the plan's union), `RetentionStopReason`, `MemoryRetentionRunOptions`, skipped/run report union.
- CREATED `...\libs\backend\memory-curator\src\lib\retention\memory-retention-config.ts`: `MEMORY_RETENTION_KEYS`, `MEMORY_RETENTION_DEFAULTS`, clamp ranges, `readMemoryRetentionSettings`, the `RETENTION_*` constants, and the injectable `MEMORY_RETENTION_LIMITS` object.
- CREATED `...\libs\backend\memory-curator\src\lib\retention\observation-retention.store.ts`: every retention SQL statement, `RetentionStepError`, and the state and reading types.
- CREATED `...\libs\backend\memory-curator\src\lib\retention\observation-retention.store.spec.ts`: 20 tests on real SQLite.
- CREATED `...\libs\backend\memory-curator\src\lib\retention\memory-retention.service.ts`: the facade (gates, steps, budgets, record, `storageHealth`).
- CREATED `...\libs\backend\memory-curator\src\lib\retention\memory-retention.service.spec.ts`: 27 tests with a fake store, fake reclaimer and fake clock, plus the settings parity check.
- CREATED `...\libs\backend\memory-curator\src\lib\retention\memory-retention.integration.spec.ts`: 4 tests on real SQLite with a fake clock.
- CREATED `...\libs\backend\memory-curator\src\lib\retention\retention-sqlite.test-support.ts`: the shared opener, adapter, temp DB, seed and pragma helpers. This file is not in the plan (see deviation 2).
- CREATED `...\libs\backend\memory-curator\src\lib\di\register.spec.ts`: 2 DI reach tests against real SQLite.
- MODIFIED `...\libs\backend\memory-curator\src\lib\di\tokens.ts`: added `OBSERVATION_RETENTION_STORE`, `MEMORY_RETENTION_SERVICE` and `MEMORY_RETENTION_LIMITS`.
- MODIFIED `...\libs\backend\memory-curator\src\lib\di\register.ts`: the limits instance plus two singletons, registered before `MEMORY_CURATOR`.
- MODIFIED `...\libs\backend\memory-curator\src\index.ts`: exports the service class, report and option types, the keys, defaults and limits, and the limits and settings types. The tokens go out through `MEMORY_TOKENS`.
- MODIFIED `...\libs\backend\memory-curator\src\lib\observation-queue.store.ts`: `PURGE_SQL` and `purgeOlderThan` deleted; three doc comments rewritten.
- MODIFIED `...\libs\backend\memory-curator\src\lib\observation-queue.store.spec.ts`: the purge test is removed and the comment at the old line 418 is rewritten.
- MODIFIED `...\libs\backend\memory-curator\src\lib\observation-queue.store.rekey.spec.ts`: the line 7 comment is rewritten (R-TL2).
- MODIFIED `...\libs\backend\memory-curator\src\lib\memory-search.service.spec.ts`: mock line removed.
- MODIFIED `...\libs\backend\memory-curator\src\lib\triggers\memory-trigger.boot-defer.spec.ts`: mock line removed.
- MODIFIED `...\libs\backend\memory-curator\src\lib\triggers\memory-trigger.boot-scan-budget.spec.ts`: mock line removed.
- MODIFIED `...\libs\backend\memory-curator\src\lib\triggers\memory-trigger.integration.spec.ts`: mock line removed.
- MODIFIED `...\libs\backend\memory-curator\src\lib\triggers\memory-trigger.service.spec.ts`: mock line removed.
- MODIFIED `...\libs\backend\memory-curator\CLAUDE.md`:
  - Added retention to Public API, Internal Structure, a Guideline, and the Cross-Lib Rules.
  - Corrected the false line "`memory-decay.job.ts` — registered with cron-scheduler".
- MODIFIED `...\libs\backend\platform-core\src\file-settings-keys.ts`: a comment only, above the four `memory.retention.*` entries in both blocks. No value changed. This is the Batch 2 carry.

Nothing in `diagnostics.*`, `libs/shared`, `rpc-handlers`, `thoth-runtime`, `cli-engine`, `batches.md` or any `project.json` was touched.

## Per-task evidence

### 3.1 Types and config

- The four keys match the platform-core registry: defaults true / 7 / 14 / 500.
- Clamp ranges:
  - `processedDays`: 1–365.
  - `stuckDays`: 7–365.
  - `batchSize`: 50–5,000.
- A non-finite number, or a value of the wrong type, falls back to the default. Fractional values are truncated, then clamped.
- The limits object holds the plan's table:
  - row cap: 50,000;
  - wall budget: 60 s;
  - slow-call threshold: 120 ms;
  - batch floor: 50;
  - reclaim step: 2,048 pages, floor 256;
  - reclaim cap: 32,768 pages per run;
  - ledger: 90 days and 5,000 rows;
  - interval: 24 h;
  - boot deferral: 10 min;
  - foreground backoff: 5 min.
- The service spec checks clamps, fallbacks, and parity with `FILE_BASED_SETTINGS_DEFAULTS`.

### 3.2 `ObservationRetentionStore`

- The plan SQL is used as written: the session-keyset walk with `INDEXED BY idx_obs_queue_session`, the stuck select with `INDEXED BY idx_obs_queue_drain`, the `INSERT … SELECT … WHERE … GROUP BY … ON CONFLICT DO UPDATE` upsert, and the stuck DELETE that re-checks `processed_at IS NULL`. Ledger prune is by age and by count. Id lists are bound through `json_each(@ids)`.
- Each batch method (`purgeProcessedBatch`, `quarantineStuckBatch`, `pruneLedger`) runs exactly one `BEGIN IMMEDIATE`/`COMMIT`. On error it runs `ROLLBACK` and throws `RetentionStepError`:
  - `database-busy`: better-sqlite3 `code` starting with `SQLITE_BUSY`, or node:sqlite `errcode & 0xff === 5`.
  - `sql-error`: anything else.
- `readLiveStorage` never throws. It returns null fields plus `"<read>: <message>"` entries.
- Statements are cached per connection object, as in `ObservationQueueStore`.
- Spec coverage:
  - Plans on a DB with no `sqlite_stat1` (asserted): every step on `observation_queue` is a `SEARCH` and there is no `SCAN`. Exact index use is checked for the walk, the drain select, the counts and the rowid deletes.
  - Nothing sets `processed_at`, and there is no UPDATE of `observation_queue` or VACUUM. This is checked on the SQL constants and on every statement actually issued.
  - Exactly 3 `BEGIN IMMEDIATE` across the three batch methods.
  - Purge cursor semantics.
  - Upsert accumulation, oldest and newest times, payload bytes.
  - Prune by age and by count.
  - `writeSkip` keeps the run fields; a partial `writeRun` keeps `last_completed_at` and the average.
  - A real busy error from a second handle holding `BEGIN IMMEDIATE`, and a real sql-error from a dropped table, both followed by a confirmed rollback.

### 3.3 Service, DI, barrel, settings comment

- The eight gates are implemented, with the flag set before any `await` and cleared in `finally`.
- Steps run in order: purge, quarantine, ledger prune, reclaim, `checkpointPassive`, `writeRun`.
- Between batches the service checks abort, battery, foreground and the wall budget, then yields with `setImmediate`.
- Adaptive halving: batch size halves after any batch over 120 ms (floor 50); the reclaim step halves the same way (floor 256).
- Outcome mapping:
  - `completed`: everything finished (reason `null` or `auto-vacuum-not-incremental`).
  - `partial`: a budget, abort, battery, foreground or busy stop.
  - `failed`: a non-busy step error or an unexpected throw, with the error text path-sanitized.
- `backlog_remaining` is set unless `completed`. `last_completed_at` is written only when `completed`.
- `storageHealth()` returns `MemoryStorageHealthDto` and never throws. `nextDueAt` is `last_finished_at` when a backlog remains, else `last_completed_at + 24h`, else `null`.
- Service spec covers:
  - every gate token (`not-due` writes nothing; `persistence-unavailable` writes nothing);
  - due after 24 h, and due immediately with a backlog;
  - concurrent `already-running`, with the flag cleared afterwards;
  - step order;
  - batch halving 500 → 250 → 125 → 62 → 50 → 50, and reclaim step halving 2048 → 1024 → 512 → 256 → 256;
  - the row cap and the wall budget, both ending `partial` with a backlog;
  - a foreground change mid-run stopping after the current batch;
  - the reclaim cap, and the mode-0 skip;
  - a thrown step error ending `failed` with earlier counts kept, paths redacted, one warn, and the next run not `already-running`;
  - busy ending `partial`;
  - a throwing gate input still resolving;
  - a failed `writeRun` being logged, not thrown;
  - `storageHealth` mapping, `nextDueAt` rules, and null/`readErrors` degradation.
- `register.spec.ts` covers:
  - After `registerPersistenceSqliteServices` then `registerMemoryCuratorServices` in a child container, `isRegistered` is true for `MEMORY_RETENTION_SERVICE`, `OBSERVATION_RETENTION_STORE`, `MEMORY_RETENTION_LIMITS` and `SQLITE_PAGE_RECLAIMER`.
  - The service resolves as a singleton over a real temp SQLite file.
  - `storageHealth()` reads the seeded pending rows.
  - A first `run()` returns `boot-deferred`, which is persisted as `last_skip_reason`.

### 3.4 Purge removal

- `PURGE_SQL` and `purgeOlderThan` are deleted, and every mention in the plan and in R-TL2 is updated.
- Grep `purgeOlderThan` over `libs/` and `apps/` now matches only `libs\backend\persistence-sqlite\src\lib\migrations\0039_reap_orphaned_queue_rows.ts`.

### 3.5 Integration spec

The spec uses:

- a temp-file DB;
- `auto_vacuum = INCREMENTAL` set before the schema, with WAL;
- migrations 0016 and 0043;
- the real store, real `SqlitePageReclaimer` and real service;
- fixed `NOW = 1,900,000,000,000`, battery off, foreground at `Infinity`.

**Main test:**

- **Seed** (exactly as the plan):
  - P-old: 1,200 rows over 3 sessions, 8 KB each.
  - P-new: 50 rows.
  - P-old-captured-new-processed: 10 rows (R7).
  - U-grace: 40 rows.
  - U-stuck: 300 rows over 2 sessions × 2 kinds.
  - `batchSize` 100.
- **Run 1** assertions:
  - `completed`, with purged 1,200 and quarantined 300.
  - Every P-old and U-stuck id is gone. Every survivor's `(session, kind, captured_at, processed_at)` is identical to the snapshot, so nothing wrote `processed_at`.
  - The ledger has 4 rows summing to 300. Each row has `reason = 'stuck-unprocessed'`, the right count, the exact oldest and newest `captured_at`, and `last_quarantined_at = NOW`.
  - `freelist_count` is 0 or lower than before.
  - The `page_count` drop equals `pagesReclaimed` plus the pointer-map pages removed (see deviation 8).
  - The run record has `last_completed_at === NOW`.
  - `storageHealth().observations.pendingRows === 40`, and `nextDueAt === NOW + 24h`.
- **Run 2** at `NOW + 1h` returns `skipped / not-due`, and the state row is unchanged.
- **Run 3** at `NOW + 25h` returns `completed` with every counter 0. The ledger sum is still 300, the survivor snapshot is identical, and `last_completed_at = NOW + 25h`.

**Budget test** (`maxRowsPerRun` 250, see deviation 7):

- Run 1 is `partial / row-budget`. The 250 deletes are committed and visible. `backlog_remaining` is 1, `last_completed_at` is null, and `nextDueAt === NOW`.
- Run 2 at `NOW + 1h` is due and `completed`: 50 purged and 100 quarantined, table empty.

**Failure test:** the store wrapper throws on the third purge batch.

- The run is `failed / sql-error`, with the path redacted in the error.
- The first 200 ids are gone and the remaining 150 are present, so batches commit one at a time.
- `last_error` is persisted and sanitized, `backlog_remaining` is 1, and `last_completed_at` is null.
- The next run is not `already-running`; it completes and purges the 150.

## Stack observed

- **DI:** tsyringe with `Symbol.for` tokens and `register.ts` per lib (`memory-curator\src\lib\di\register.ts`, `tokens.ts`). `emitDecoratorMetadata` is on in `tsconfig.lib.json` and `tsconfig.spec.json`; `di-lint` (`tools\di-lint\check-injects.ts`) requires every injected token to be registered.
- **Settings:** read through `IWorkspaceProvider.getConfiguration` and validated with clamps at that boundary, following `triggers\memory-trigger-config.ts`.
- **SQLite:**
  - Uses the shared `SqliteConnectionService.db`.
  - `BEGIN IMMEDIATE` follows `observation-queue.store.ts` (`backfillSessionId`).
  - The node:sqlite fallback follows `persistence-sqlite\src\lib\sqlite-page-reclaimer.spec.ts`.
  - better-sqlite3 does NOT load under Node 24.15 on this machine (ABI mismatch, confirmed), so every real-SQLite spec ran on `node:sqlite`.
- **Yield:** `setImmediate`, following `agent-sdk\src\lib\session-history-reader.service.ts:63-64`.
- **Error sanitization:** follows `rpc-handlers\...\persistence-rpc.handlers.ts:567`.

## Verification

1. `npx nx run-many -t typecheck test lint -p @ptah-extension/memory-curator @ptah-extension/platform-core`. The header reported **2 projects**.
   - At default parallelism: EXIT 1, twice. The only failure was `platform-core` `file-settings-manager.bench.spec.ts`, "keeps per-write cost flat across 1000 sequential set() calls", which hit its 30 s Jest timeout while memory-curator's suites ran at the same time. This is a load-dependent performance smoke test; this batch's platform-core change is comment-only.
   - `npx nx run-many -t test -p @ptah-extension/platform-core` alone: EXIT 0, 32 suites passed, 576 passed, 4 todo.
   - Same command plus `--parallel=1`: **EXIT 0**, "Successfully ran targets typecheck, test, lint for 2 projects".
     - platform-core: 32/32 suites, 576 passed, 4 todo.
     - memory-curator: 35 passed, 2 skipped suites, 542 passed, 59 skipped. The skipped suites are the older better-sqlite3-gated round-trip blocks, such as `observation-queue.store.spec.ts` "(native-gated)"; none of them is new.
     - Lint: 0 errors, and no warnings in any new or modified file. The warnings that remain were already there.
2. `npx nx run-many -t typecheck -p @ptah-extension/thoth-runtime @ptah-extension/cli-engine`: header **2 projects**, EXIT 0, "Successfully ran target typecheck for 2 projects".
3. The four new spec files, from Jest `--json` per-file results, all ran with **0 skipped and 0 failed**:

   | Spec file | Passed |
   | --- | --- |
   | `memory-retention.service.spec.ts` | 27 |
   | `observation-retention.store.spec.ts` | 20 |
   | `memory-retention.integration.spec.ts` | 4 |
   | `di\register.spec.ts` | 2 |

   The store, integration and register specs call `requireSqliteOpener()` / `openRetentionTestDb()`, which throw when no binding loads, so they fail rather than skip.
4. Grep `purgeOlderThan` over `libs/` and `apps/`: only `0039_reap_orphaned_queue_rows.ts`.
5. Invariant greps on `retention/` (non-spec files):
   - no `VACUUM` statement (only the `AUTO_VACUUM_INCREMENTAL` constant name);
   - no `processed_at =`;
   - no `CREATE INDEX`;
   - no import of `cron-scheduler`, `skill-synthesis`, `agent-sdk` or `rpc-handlers`.
6. No `nx reset` was run, and nothing under `~/.ptah` or any real DB file was opened.

## Risk handling

- **R-TL2:** the two extra doc mentions are rewritten, and the grep is clean apart from 0039.
- **R1** (main-thread I/O):
  - Every batch is one short transaction followed by a `setImmediate` yield.
  - Adaptive halving applies to the batch (floor 50) and the reclaim step (floor 256), both spec-pinned.
  - The row cap, 60 s wall budget and 32,768-page reclaim cap all apply.
  - Per-batch and per-step `debug` logs record `durationMs`, so A1/A2 can be read in the field. Batch 7 measures A1/A2 on a copy.
- **R2** (boot catch-up): gate 3 compares against `startedAt`, captured when the singleton is constructed. Pinned by the service spec and by `register.spec.ts`: a freshly resolved service returns `boot-deferred`.
- **R5** (two hosts): `BEGIN IMMEDIATE` on every batch. A busy error becomes `RetentionStepError('database-busy')` and the run ends `partial`. The store spec proves this with a real second handle; the service spec covers the mapping.
- **R6** (stuck delete racing `markProcessed`): the stuck DELETE re-checks `processed_at IS NULL`, and a store spec test keeps a processed row outside the window intact.
- **R7:** the purge keys on `processed_at`. Pinned by the integration P-old-captured-new-processed rows and by a store spec case.
- **A2:** the batch size is a setting (default 500) and halves adaptively. The batch timing check itself belongs to Batch 7.
- **A3:** `json_each(@ids)` is exercised by the store and integration specs on `node:sqlite`, the binding that loads here.

## Plan deviations

1. **A third DI token, `MEMORY_TOKENS.MEMORY_RETENTION_LIMITS`, registered with `registerInstance(MEMORY_RETENTION_LIMITS)`. The service has 6 injected deps, not 5.**
   - The plan asks for a constructor-injectable constants object. Under tsyringe with `emitDecoratorMetadata`, a plain interface-typed 6th parameter resolves to `Object` and throws.
   - `di-lint` rejects an unregistered token.
   - This follows the `EMBEDDER_WORKER_IDLE_MS` precedent in the same `register.ts`.
2. **`retention-sqlite.test-support.ts` is an extra file.**
   - It shares the opener across three specs so the copies cannot drift, following `skill-synthesis\...\queue-db.test-support.ts`.
   - The memory-curator `tsconfig.lib.json` does not exclude `*.test-support.ts`. Editing that file is out of scope, so the support file is written to compile cleanly under the lib config (it does; typecheck is green). The barrel does not import it.
3. **Gate order:** `persistence-unavailable` is checked before `not-due`. The due check is a DB read, so a closed connection cannot answer it. Both tokens still write nothing.
4. **Extra statement `STUCK_PAYLOAD_BYTES_SQL`.**
   - It exists because the plan's return shape `{ quarantined, payloadBytes }` needs the byte sum. It is a rowid-lookup SELECT in the same transaction.
   - On a DB with no statistics, SQLite plans the verbatim stuck DELETE (`… AND processed_at IS NULL`) as `SEARCH … USING COVERING INDEX idx_obs_queue_drain`, not as rowid lookups. It is still a bounded index search and never a scan. The spec accepts either plan for that one statement and says why. The SQL was kept as written rather than adding a `+processed_at` planner hint.
5. **`purgeProcessedBatch` visits at most `limit` sessions per batch.** Without this bound, a single transaction could seek through every session that has nothing eligible.
6. **Outcome details the plan left open:**
   - A `row-budget` stop ends only the row steps. The ledger prune and the page reclaim still run, since each has its own bound.
   - Hitting the reclaim page cap ends the run `partial / reclaim-budget`, so the next hour continues the reclaim.
   - A reclaim step that frees 0 pages while the freelist is not empty ends the run `partial / reclaim-stalled`, which avoids a spin.
   - Closed gates other than `not-due` and `persistence-unavailable` call `writeSkip`. A failed `writeSkip` is logged at debug.
7. **Integration test inputs changed where the plan's own numbers do not work together:**
   - **Run 3:** at `NOW + 25h`, the plan's seed makes P-new (processed `NOW-6d`) and U-grace (captured `NOW-13d`) eligible under the default 7/14-day windows, which contradicts "nothing new eligible". The spec widens the settings to 8/15 days for run 3 so the plan's assertions (all counters 0, ledger still 300, survivors identical) hold.
   - **Budget test:** the full 1,500-row seed cannot finish in "run 2" under a 250-row cap. The budget test therefore seeds 300 processed + 100 stuck rows: run 1 is partial at 250, run 2 finishes 150.
8. **`page_count` assertion.** With auto-vacuum on, truncating the file also drops pointer-map pages, which are never on the freelist. Measured: `page_count` fell by 2,569 against 2,566 reclaimed. The assertion is "drop = `pagesReclaimed` + pointer-map pages in the truncated range", computed from SQLite's pointer-map spacing (one page every `usable/5 + 1` pages, starting at page 2).
9. **`freedBytes`** is measured around the processed purge only, as the plan says for the average. Quarantine deletes also free pages, and the reclaim step returns those too.

## Out-of-scope observations

- `libs\backend\memory-curator\tsconfig.lib.json` has no `src/**/*.test-support.ts` exclude; skill-synthesis has one. It is worth adding in a later batch.
- The `platform-core` `file-settings-manager.bench.spec.ts` perf smoke test times out when run in parallel with another project's Jest run. Batch 7's 8-project run may hit the same flake; `--parallel=1` avoids it.
- Legacy processed rows with `session_id = ''` are never reached by the purge walk (`session_id > ''`). Unprocessed rows of that kind are still quarantined through the drain index. New rows cannot have an empty id (`enqueue` refuses them).
- `storageHealth()` runs the pending-bytes sum (`PENDING_BYTES_SQL`) on every diagnostics poll. The plan accepts this; it measured about 26 ms on the live file.
