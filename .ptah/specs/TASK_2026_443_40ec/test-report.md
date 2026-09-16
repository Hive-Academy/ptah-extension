# Test Report - TASK_2026_443_40ec

## Task 10.2

### Scope

- Full affected-set run (test/typecheck/lint across the 11-lib set, ptah-electron +
  ptah-extension-vscode, platform-core re-run, ptah-docs build, degradation-audit
  lint) plus the invariant greps and per-spec reachability evidence for
  TASK_2026_443 (memory lifecycle) phase 2. No timing (Task 10.3, deliberately
  out of scope here).
- Environment: Node v24.15.0, Windows 11 (win32 10.0.26200), PowerShell 5.1 +
  Git Bash. Worktree `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle`,
  branch `feat/task-439-phase2-memory-lifecycle`, HEAD `dd7d82ab2`, clean tree
  before and after (verified: `git status --short` empty at start; no commits
  made).
- Deliberately not tested: AC9 timing (Task 10.3, runs after this report); no
  `*.timing.local.spec.ts` created.

### Commands (verbatim headers)

1. `npx nx run-many -t test -p @ptah-extension/persistence-sqlite @ptah-extension/memory-contracts @ptah-extension/memory-curator @ptah-extension/agent-sdk @ptah-extension/vscode-lm-tools @ptah-extension/rpc-handlers @ptah-extension/platform-core @ptah-extension/shared @ptah-extension/thoth-runtime @ptah-extension/cli-engine @ptah-extension/memory-curator-ui`
   - Header: `NX  The following projects do not have a configuration for any of the provided targets ("test") - @ptah-extension/memory-contracts` then `NX  Running target test for 10 projects` (matches expectation — memory-contracts has no `test` target).
   - Result (run 1): `NX  Running target test for 10 projects failed` — **@ptah-extension/platform-core:test FAILED** (`NX detected a flaky task`).
     - Failing spec: `src/file-settings-manager.bench.spec.ts` › "Performance smoke — PtahFileSettingsManager (Gap E) › keeps per-write cost flat across 1000 sequential set() calls (no O(n²) growth)" — `Exceeded timeout of 30000 ms`. This is **R-TL8** (pre-existing load flake, risk table).
     - platform-core suite that run: 1 failed, 40 passed, 41 total; Tests 1 failed, 4 todo, 780 passed, 785 total.
     - All other 9 projects green in that same run: persistence-sqlite 9 skipped/31 passed of 40 (native `better-sqlite3` ABI mismatch under plain Node — pre-existing, not R-TL8; see below), 80 skipped/430 passed/510 total; memory-curator-ui 17/17 suites, 189/189 tests; memory-curator 2 skipped/40 passed of 42, 59 skipped/640 passed/699 total; vscode-lm-tools 50/50, 1161/1161; agent-sdk 2 skipped/110 passed of 112, 3 skipped/1955 passed/1958; rpc-handlers 101/101, 33 skipped/3007 passed/3040; cli-engine 19/19, 188/188; thoth-runtime 5/5, 91/91.
   - Result (run 2, `--parallel=1`, R-TL8 mitigation): `NX  Running target test for 10 projects` → `NX  Successfully ran target test for 10 projects` (9 of 10 tasks served from cache, platform-core re-executed). platform-core: 41 passed/41 total; 4 todo, 781 passed, 785 total. **Both runs recorded — R-TL8, resolved on re-run, per risk-table mitigation.**
2. Same 11-name set, `-t typecheck` → `NX  Successfully ran target typecheck for 11 projects`. All 11 green (persistence-sqlite, memory-contracts, memory-curator, agent-sdk, vscode-lm-tools, rpc-handlers, platform-core, shared, thoth-runtime, cli-engine, memory-curator-ui). No errors.
3. Same 11-name set, `-t lint` → `NX  Successfully ran target lint for 10 projects` (memory-contracts has no `lint` target either, dropped exactly as expected). 0 errors across all 10; 42 pre-existing warnings in agent-sdk (non-null assertions in specs, `max-lines` on 3 pre-existing files) — none new, none touching memory lifecycle code.
4. `npx nx run-many -t test -p ptah-electron ptah-extension-vscode` → `NX  Successfully ran target test for 2 projects and 32 tasks they depend on` (4 of 34 tasks from cache). ptah-extension-vscode: 6/6 suites, 65/65 tests. ptah-electron (re-run standalone to surface its own summary line, same cache-backed result): 2 skipped/45 passed of 47 suites (pre-existing, unrelated to memory lifecycle), 7 skipped/631 passed/638 tests.
5. After Task 10.1: `npx nx run-many -t test -p @ptah-extension/platform-core` → `NX  Successfully ran target test for project @ptah-extension/platform-core` (cached from run 2 above: 41/41 suites, 781 passed/785, 4 todo). `npx nx run-many -t build -p ptah-docs` → `NX  Successfully ran target build for project ptah-docs`, 156 pages built, Pagefind index built (158 HTML files), sitemap generated.
6. `npx nx run degradation-audit:lint` → `NX  Successfully ran target lint for project degradation-audit` (exit 0). Per-lib lines: `apps/ptah-extension-vscode: 8 ok (baseline 9)`; `libs/backend/memory-curator: 20 ok (baseline 20)`; `libs/backend/platform-core: 7 ok (baseline 7)`; `libs/frontend/memory-curator-ui: 15 ok (baseline 15)`. TOTAL 303 unsuppressed sites (unchanged baseline reporting; no lib exceeds its baseline).
7. better-sqlite3 via Electron (PowerShell, quoted per the mandatory rule):
   `$env:ELECTRON_RUN_AS_NODE='1'; & 'D:\projects\ptah-extension\node_modules\.bin\electron.cmd' 'D:\projects\ptah-extension\node_modules\jest\bin\jest.js' --config libs/backend/memory-curator/jest.config.ts --testPathPatterns '"memory-retention|memory-lifecycle|di/register.spec|memory.store.spec|salience-ranking"' --runInBand`
   → `Test Suites: 42 passed, 42 total` / `Tests: 699 passed, 699 total`. (PowerShell wrapped Electron's stderr into a `NativeCommandError` display line per the documented 5.1 quirk; exit content shows all green, no failures.)

### Greps (under `libs` and `apps`, excluding `.ptah`)

- `MemoryDecayJob|SalienceScorer|recordHit|updateSalience|lastDecay|decay-run|recordDecayEvent|MemoryDecayStats|updateTier` (all file types) → **one hit**, not zero:
  `libs/backend/memory-curator/src/lib/di/register.spec.ts:106: expect(child.isRegistered(Symbol.for('PtahMemorySalienceScorer'))).toBe(false)`.
  Read in context (lines 106-111): the spec asserts `PtahMemorySalienceScorer` is **NOT** registered (`.toBe(false)`), and the neighbouring line 110 assembles `'PtahMemory' + 'DecayJob'` at runtime specifically to dodge this same grep. The literal `SalienceScorer` substring at 106 was not runtime-assembled, so the plan's "no matches outside `.ptah/specs` prose" expectation is not literally met — but the match itself is evidence FOR the invariant (the symbol is proven absent from the DI container), not against it. No decay job, salience scorer, or any of the other eight symbols exist as live production code anywhere in `libs`/`apps`. Flagging the literal-vs-assembled inconsistency for awareness; not a functional defect.
- `decayHalflifeDays` and `tierLimits` over `libs`, `apps`, `docs` (all file types) → no matches, both. Clean.
- `SET tier = 'archival'|tier = 'archival',` in non-spec code → exactly one hit: `libs/backend/memory-curator/src/lib/retention/memory-lifecycle.store.ts:22` (`ARCHIVE_UPDATE_SQL`, `MemoryLifecycleStore.archiveBatch`). Matches A4 exactly.
- `SET salience|salience = ` writes in non-spec, non-migration code → no matches. Clean (insert-only binding, as required).
- `from '@ptah-extension/(cron-scheduler|skill-synthesis|agent-sdk|rpc-handlers)'` inside `libs/backend/memory-curator/src` → **NOT clean**: 15 hits, all `@ptah-extension/agent-sdk` (`NetworkBackoff`, `JsonlReaderService`, `CuratorRateLimitService`), across `curator-pass-admission.ts`/`.spec.ts`, `knowledge-agent.service.ts`/`.spec.ts`, and four `memory-trigger*.spec.ts` files plus `memory-trigger.service.ts`. Checked with `git log` and `git merge-base HEAD origin/main`: every one of these imports exists at the merge-base commit `51d0d2e1f` (current `origin/main` tip, introduced by pre-existing commit `95130eabe` "feat(agent-sdk): back off background curator and skill-synthesis calls when the provider is unreachable" — TASK_2026_437, already shipped on `main` before this branch's own work started). **None of these imports were added by TASK_2026_443 batches**; they predate this task entirely. The `memory-curator/CLAUDE.md` boundary rule ("Should not import rpc-handlers or agent-sdk, only via `ICuratorLLM` port") is already violated on `main`, independent of this task. Reporting as a pre-existing architecture condition, not a Task 2026-443 regression — batches.md's "-> none" expectation for this grep does not hold against the actual repository state and should be corrected there, but this task did not introduce it and is not the place to fix it.

### Reachability evidence (per-spec, skipped = 0 required)

| Spec | Suites | Tests | Skipped |
| --- | --- | --- | --- |
| `thoth-runtime` `start-thoth-cron.spec.ts` | 1 passed / 1 | 31 passed / 31 | 0 |
| `cli-engine` `thoth-runtime.spec.ts` (config: `jest.config.cjs`, no `.ts` config exists) | 1 passed / 1 | 21 passed / 21 | 0 |
| `memory-curator` `di/register.spec.ts` | 1 passed / 1 | 4 passed / 4 | 0 |
| `memory-curator` `memory-retention.integration.spec.ts` | 1 passed / 1 | 16 passed / 16 | 0 |
| `memory-curator` `memory-lifecycle.store.spec.ts` | 1 passed / 1 | 11 passed / 11 | 0 |
| `memory-curator` `retention-run-budget.spec.ts` | 1 passed / 1 | 10 passed / 10 | 0 |
| `memory-curator` `salience-ranking.spec.ts` | 1 passed / 1 | 4 passed / 4 | 0 |
| `persistence-sqlite` `0044_memory_lifecycle.spec.ts` | 1 passed / 1 | 6 passed / 6 | 0 |

All eight run green with 0 skipped, each invoked directly (`npx jest --config <lib-config> --testPathPatterns=<name> --verbose`) to force actual execution rather than reading Nx cache.

### Flake handling

- **R-TL8** (`file-settings-manager.bench.spec.ts`, platform-core): failed under the default-parallel full run-many (timeout at 30000 ms on the 1000-sequential-`set()` smoke test); re-ran the identical `run-many` command with `--parallel=1` per the mitigation — passed 41/41 suites, 781/785 tests (4 todo). Both runs recorded above under Command 1. Not touched, not weakened, not skipped.
- **R-TL11** (`memory-retention.integration.spec.ts`, real SQLite + sqlite-vec, slow under load): did not reproduce in this session — it passed cleanly inside the default-parallel run-many (part of memory-curator's 640/699), in the direct per-spec reachability run (16/16), and in the better-sqlite3-via-Electron run (part of 699/699). No re-run needed; recorded as non-reproducing this pass, consistent with it being a load-dependent flake rather than a deterministic failure.
- **R-TL12** (`rpc-handlers` `skills-sh/skills-sh-source-root.service.spec.ts`): passed in the full run-many (part of rpc-handlers' 3007/3040) and was additionally run twice, standalone, to check for the known flake — both runs 1 passed/1 suite, 20 passed/20 tests. No flake observed this session; both runs recorded per the "record both" rule even though neither failed.
- No other spec failed anywhere in this session. The only genuine failure encountered was the R-TL8 bench timeout, already covered by its documented mitigation.

### Verdict

- **PASS.** All commanded test/typecheck/lint/build targets are green (R-TL8's one flake resolved on the prescribed re-run, exactly as the risk table predicts); `degradation-audit:lint` exits 0 with no per-lib baseline raised; the better-sqlite3-via-Electron binding run is 42/42 suites, 699/699 tests; all eight reachability specs pass with 0 skipped.
- Four of five invariant greps are fully clean. The fifth (`SET tier = 'archival'`) matches exactly the one expected writer. The decay-symbol grep produces one literal substring hit that is evidence *for* the invariant (an explicit `.toBe(false)` registration check), not against it — flagged only because it is not runtime-assembled like its neighbour. The agent-sdk import grep is genuinely non-clean but every hit predates TASK_2026_443 (present at `origin/main` HEAD `51d0d2e1f` before this branch diverged) — a pre-existing condition this task did not create and this report does not have authorization to fix.
- Risks a reader should know about: (1) the batches.md text for the agent-sdk import grep and the decay-symbol grep should be corrected to reflect the actual repository state (pre-existing agent-sdk imports; the register.spec.ts hit is intentional and desirable) — a documentation fix, not a code fix; (2) `persistence-sqlite`'s 9 skipped suites under plain Node are a `better-sqlite3` native-ABI mismatch (compiled for a different `NODE_MODULE_VERSION`) in this environment, orthogonal to memory lifecycle — the Electron-hosted run in Command 7 is the one that actually exercises `better-sqlite3` and it is fully green; (3) Task 10.3 (timing) has not run yet and is out of scope here.

## Task 10.3

### Scope

- User request: measure AC9 (memory lifecycle timing) against the real 1.18 GB
  pre-migration production snapshot, on temp byte copies only, never the live
  `ptah.sqlite` or the snapshot file itself.
- Criteria tested: M1 (migration 0044 duration, target ≤ 1 s), M2 (first real
  `MemoryRetentionService.run`, archive batch durations ≥ 40 batches, lifecycle
  wall time), M3 (age delete, ≥ 30 batches of 200, max ≤ 120 ms / p95 ≤ 100 ms,
  zero orphans afterwards), M4 (cap eviction, `maxPerWorkspace = 5,000`, ≥ 30
  batches, same bound), M5 (3 preview reads + ranked `list`/`listAll`), M6
  (`recordUse` × 100 reps on 5 ids). Extracted from `batches.md` Task 10.3 /
  `implementation-plan.md:872-894`, following the procedure of
  `../TASK_2026_440_834c/test-report.md` Task 7.4 (`:252-292`).
- Deliberately not tested: mutation sanity (not in scope for a timing task);
  the manual Electron field check (same reason as Task 7.4); a `better-sqlite3`
  cross-check (Task 7.4 already found `better-sqlite3` cannot load outside
  Electron's ABI in this environment — not re-attempted here since the task
  mandates `node:sqlite` directly, not a fallback probe).

### Environment

- Windows 11 Home 10.0.26200, Node **v24.15.0**, SQLite opener **`node:sqlite`**
  (mandated by the task — not the `better-sqlite3`-with-fallback probe Task 7.4
  used), SQLite engine version **3.51.3**, sqlite-vec **v0.1.6**
  (`sqlite-vec-windows-x64\vec0.dll`, loaded via `getLoadablePath()` +
  `loadExtension` with `allowExtension: true`), disk **C: 361 GB free**
  (387,679,522,816 bytes) of 437 GB.
- Real classes constructed directly (`new ClassName(...)`, not through the
  tsyringe container — same pattern Task 7.4 used): `VecStatusService`,
  `SqlitePageReclaimer`, `MemoryLifecycleStore`, `MemoryStore` (stub `IEmbedder`
  — never called by `list`/`listAll`/`recordUse`), `ObservationRetentionStore`,
  `MemoryLifecycleService`, `MemoryRetentionService` (governor `null` — ungoverned,
  matching "the governor was absent" expectation exactly: no
  `BACKGROUND_WORK_GOVERNOR` was registered in this harness). Logger and
  `IWorkspaceProvider` are minimal duck-typed stubs (workspace settings resolve
  to `MEMORY_RETENTION_DEFAULTS` / `MEMORY_LIFECYCLE_DEFAULTS`; `bootDeferralMs`
  overridden to `0` per the task, everything else left at production values).

### Safety proof

1. **Snapshot, before**: `C:\Users\abdal\.ptah\state\ptah.pre-migration-20260909T230600Z.sqlite`
   — **1,178,537,984 bytes, 2026-09-10 02:06:09 (local)** — matches the expected
   1,178,537,984 / 2026-09-10 02:06:09 exactly. Opened only through
   `fs.copyFileSync(src, dst, COPYFILE_EXCL)`; never opened, written, renamed or
   deleted directly. `ptah.sqlite` (the live file) was never referenced anywhere
   in the harness.
2. **Temp dir**: `C:\Users\abdal\AppData\Local\Temp\task-443-timing-<8 lowercase
   hex>` — created with a fail-if-exists `fs.mkdirSync` (no `recursive`, no
   `force`), a fresh 8-hex suffix per run (`task-443-timing-a7173b9f`, then
   `-a23e71ee` on the sweep re-run). Every copy inside was named
   `timing-copy-*.sqlite` (`timing-copy-a`, `timing-copy-b200`,
   `timing-copy-b100`; the `-b` name from the first pass before the sweep was
   generalized) — never `ptah*`, so no `ptah.pre-migration-*` glob could match
   it. Each copy's handle was closed and the file (plus `-wal`/`-shm` sidecars)
   deleted as soon as its series ended; the whole directory was removed in a
   `finally` block and its absence asserted by the harness itself
   (`fs.existsSync(tempDir) === false`).
3. Every copy was opened only with `node:sqlite`'s `DatabaseSync`. The six
   production pragmas were applied in the documented order and **read back**:

   | Pragma | Set | Read back |
   | --- | --- | --- |
   | `journal_mode` | `WAL` | `"wal"` |
   | `foreign_keys` | `ON` | `1` |
   | `synchronous` | `NORMAL` | `1` (NORMAL) |
   | `temp_store` | `MEMORY` | `2` (MEMORY) |
   | `mmap_size` | `268435456` | `268435456` |
   | `busy_timeout` | `5000` | `5000` |

   Pre-migration schema version read as `MAX(version) = 41` on every copy,
   confirming the snapshot's starting point. Only the static `sql` of migrations
   **42, 43, 44** was applied, in that order, straight from `MIGRATIONS` —
   `SqliteMigrationRunner` and `SqliteBackupService` were never imported or
   constructed; `PTAH_DB_PATH` was never set. None of migrations 42/43/44 carry
   a `vecSql` block (checked in source), so only the extension load (step above)
   provides vec0 to these copies.
4. **Snapshot, after**: re-checked once every handle across every series was
   closed — **1,178,537,984 bytes, 2026-09-10 02:06:09 — identical to step 1.**
5. **Temp dir gone**: confirmed by the harness's own final assertion
   (`fs.existsSync(tempDir) === false`) and independently by
   `Get-ChildItem 'C:\Users\abdal\AppData\Local\Temp' -Filter 'task-443-timing-*'`
   returning no results after the run.
6. **Harness deletion**: `libs/backend/memory-curator/src/lib/retention/memory-lifecycle.timing.local.spec.ts`
   deleted. `git status --short -- libs/backend/memory-curator` returned **no
   output** — confirmed absent from the working tree.

### Method notes (methodological caveats, reported rather than smoothed over)

- **M1 is a single sample, not a distribution.** Migration 44's `ALTER TABLE`
  and one-shot `UPDATE ... salience - 0.45` statements are not safely
  re-runnable against the same copy (the salience subtraction would double-apply
  on a second call), so p50/p95/max collapse to one measurement per run. Two
  independent copies (the initial run and the sweep re-run) gave 1066 ms and
  1011 ms — consistent with each other, both over the 1 s target.
- **M2's archive-batch durations and lifecycle wall time were captured by
  instance-level timing wrappers** around `MemoryLifecycleStore.archiveBatch`
  and `MemoryLifecycleService.runStep` (the production classes have no
  `logger.debug` call at the per-archive-batch granularity the way the reclaim
  step does), not by parsing debug log lines. This is a test-only monkey-patch
  on the constructed instances, not a source change.
- **M4's "aged past the grace" is simulated through the `graceCutoffMs`
  argument** (a far-future value), not by mutating `archived_at` on disk. This
  matters because migration 0044's own backfill (`UPDATE memories SET
  archived_at = <migration-apply time> WHERE tier = 'archival' AND archived_at
  IS NULL`) stamps every pre-existing archival row with a timestamp at
  migration-apply time — i.e., minutes before this harness runs — so a *real*
  7-day grace cutoff would find nothing eligible on a freshly migrated copy.
  Passing a far-future cutoff directly to `evictBatch` reaches the same
  eligibility a genuinely 7-day-aged file would have, without an extra
  destructive write pass. Recall-tier eviction has no age filter in the SQL at
  all, so it needed no such trick.
- **M4 batch-size sweep used fresh copies per size** (`timing-copy-b200`,
  `timing-copy-b100`) because eviction is destructive — a size that already
  evicted a workspace's backlog cannot be re-measured on the same file.
- Real production data shape observed: **23,902 rows became newly archival**
  in the M2 run (recall → archival, `last_used_at` older than 30 days), then
  **all 23,902 were deleted** in M3 (archival → gone, `archived_at` older than
  60 days from the M3 fake-now), and **one workspace root
  (`D:\projects\ptah-extension`) held 30,564 evictable rows** against the
  `maxPerWorkspace = 5,000` cap used for M4 — all real counts from the actual
  snapshot content, not synthetic.

### M1 — migration 0044 total duration

| Run | Duration | Target |
| --- | --- | --- |
| Initial | 1066 ms | ≤ 1000 ms |
| Sweep re-run | 1011 ms | ≤ 1000 ms |

**FAIL** on both independent samples — 1-7% over the 1 s target. Consistent
with `0042_db_integrity_check_state.ts`'s own note that a large `memories`
table scan/update is not free; migration 44's `UPDATE ... WHERE pinned = 0 AND
session_id IS NOT NULL` touches every non-pinned, session-scoped row. Reported
only — no source change made here.

### M2 — first real `MemoryRetentionService.run` (`bootDeferralMs: 0`, real clock)

Run report (initial run; sweep re-run was materially identical —
`memoriesArchived: 23902`, `durationMs` 5362-5437 ms):

| Field | Value |
| --- | --- |
| `status` / `reason` | `partial` / `row-budget` |
| `processedPurged` | 50,000 (hit `maxRowsPerRun`) |
| `stuckQuarantined` | 0 |
| `memoriesArchived` | 23,902 |
| `memoriesDeleted` | 0 (deletes gated behind the archive step in `runStep`'s order; none reached before the row budget) |
| `memoriesEvicted` | 0 |
| `pagesReclaimed` | 32,768 (hit `maxReclaimPagesPerRun`) |
| `freedBytes` | 264,462,336 |
| `durationMs` (report) | 5362-5437 ms |
| Wall time (measured outside) | 5385-5463 ms — matches the report closely |

Archive batch durations (instance-timed, `MemoryLifecycleStore.archiveBatch`):

| Metric | Initial run | Sweep re-run | Target |
| --- | --- | --- | --- |
| n | 49 | 49 | ≥ 40 |
| p50 | 44 ms | 45 ms | — |
| p95 | 93 ms | 93 ms | ≤ 100 ms (archive-batch-floor rule) |
| max | 115 ms | 112 ms | — |

**PASS.** n ≥ 40 satisfied (49 batches); p95 (93 ms) is under the 100 ms
archive-floor-rule threshold, so the fixed rule's archive-batch-size fallback
({500, 250, 100}) is **not needed** — the production default (`batchSize:
500`) stands.

Lifecycle step wall time (`MemoryLifecycleService.runStep`, instance-timed):
**2788 ms** (initial), **2827 ms** (re-run) — one sample per run (`runStep` is
called once per `service.run()`), consistent between the two independent runs.

No `[memory-curator] retention batch slow; halved` (or reclaim-step halving)
debug lines were observed in either run — **adaptive halving did not trigger**
for the archive batches in this run (every batch stayed at or under the 115 ms
ceiling, close to but under the 120 ms `slowCallMs` threshold that would halve
`archiveBatchSize`).

### M3 — age delete, fake `now = run1 + 61 d`, same file as M2

| Metric | Value | Target |
| --- | --- | --- |
| Batches | 121 | ≥ 30 |
| Rows deleted | 23,902 | matches M2's `memoriesArchived` exactly |
| p50 | 27-28 ms | — |
| p95 | 73-75 ms | ≤ 100 ms |
| **max** | **93-94 ms** | **≤ 120 ms** |

**PASS**, comfortably inside both bounds, on both independent runs.

Orphan counts after M3, on the same copy:

| Check | Count |
| --- | --- |
| `memory_chunks` rows with no matching `memories.id` | 0 |
| `memory_chunks_fts_docsize` rows with no matching `memory_chunks.rowid` | 0 |
| `memory_chunks_vec` rows with no matching `memory_chunks.rowid` | 0 |

**All zero** — the delete pair (`DELETE_CHUNKS_SQL` then `DELETE_MEMORIES_SQL`)
and the vec/FTS delete triggers leave no orphans on real data, confirming
AC1's "no orphans" criterion at this scale.

### M4 — cap eviction, `maxPerWorkspace = 5,000`, batch-size sweep

Target workspace (real data): `D:\projects\ptah-extension`, `evictable:
30,564`, `recallEvictable: 30,564` (i.e. every evictable row for this
workspace was tier `recall`, none `archival`, on the fresh migrated copy — the
archival-tier eviction path ran and immediately found nothing to evict before
falling through to recall).

| Batch size | n | p50 | p95 | max | Bound (max ≤ 120 & p95 ≤ 100) | Rows evicted |
| --- | --- | --- | --- | --- | --- | --- |
| 200 (production default) | 155 | 25-27 ms | 83-90 ms | **133-1730 ms** | **FAIL** | 30,564 |
| 100 | 308 | 12 ms | 58 ms | **116 ms** | **PASS** | 30,564 |

**200 FAILS** on max in both independent attempts (133 ms and, on the very
first exploratory run before the sweep was generalized, 1730 ms on one
outlier batch) — consistent with Task 7.4's finding that WAL checkpoint
timing produces occasional large spikes independent of batch size (the same
phenomenon as that report's A2 487 ms outlier). p95 stays under 100 ms at 200
in both attempts; only `max` fails, but the rule is `max ≤ 120 AND p95 ≤ 100`
— max alone failing the bound is enough to fail the size under the task's
rule as written (`if M3 or M4 max exceeds 120 ms or p95 exceeds 100 ms`).

**100 PASSES** cleanly: max 116 ms, p95 58 ms, both under bound, at roughly
twice the batch count for the same 30,564 rows.

No halving debug lines observed in either run — the batch size itself was
never adaptively halved during a run (each run holds a fixed size by
construction here, since eviction is called directly rather than through the
service's own `RetentionRunBudget.observe`).

**Fixed rule applied**: 200 fails → try 100 → **100 passes** → report **100**
as the largest of {200, 100, 50} that passes. 50 was not attempted since 100
already passes (the rule asks for the largest passing size, and 100 > 50).

**Recommended `memoryDeleteBatchSize`: 100** (currently `RETENTION_MEMORY_DELETE_BATCH_SIZE
= 200` in `memory-retention-config.ts:59`). This is a report-only finding — no
source was edited by this task. Per the routing note, a changed constant
becomes a follow-up (Task 10.4) only if the team-leader decides to open one;
this report does not open it.

### M5 — preview reads + ranked `list` / `listAll` (post-M3 file)

| Read | Duration |
| --- | --- |
| `readPreview` #1 | 21 ms |
| `readPreview` #2 | 19-21 ms |
| `readPreview` #3 | 18-20 ms |
| `list({ limit: 100 })` (unscoped, salience-ranked) | 12-17 ms, `total: 7,400` |
| `listAll(undefined, undefined, 100, 0)` (unscoped, salience-ranked) | 9-13 ms, `total: 7,400` |

All well under any stated bound (none is fixed for M5 by the task beyond
"measure"); reported as evidence for R6 (unscoped `memory:list` losing its
index) — at this post-cleanup row count (7,400 memories, down from the
pre-run count via the M2/M3 archive-then-delete pass) the unscoped scan cost
stays in the low tens of milliseconds, not the 45.9 ms regression cited in the
plan's R6 risk note; that risk was accepted at design time regardless of this
measurement.

### M6 — `recordUse` × 100 reps, 5 ids

| Metric | Value |
| --- | --- |
| n | 100 |
| p50 | 0 ms |
| p95 | 1 ms |
| max | 2 ms |

Trivially fast — a single indexed `UPDATE ... WHERE id IN (5 values)` plus one
`SELECT DISTINCT workspace_root` inside one transaction, exactly the "one
indexed UPDATE, never throws" cost the plan's R8 risk note expects.

### Verdict

- **Criteria proven**:
  - M2 (archive batches): **PASS** — n=49 ≥ 40, p95=93 ms ≤ 100 ms; no
    archive-batch-floor change needed.
  - M3 (age delete): **PASS** — 121 batches ≥ 30, max 93-94 ms ≤ 120 ms, p95
    73-75 ms ≤ 100 ms; zero chunk/FTS-docsize/vec-rowid orphans afterwards.
  - M4 (cap eviction) at the recommended size (100): **PASS** — 308 batches ≥
    30, max 116 ms ≤ 120 ms, p95 58 ms ≤ 100 ms.
  - M5, M6: measured, no fixed bound stated by the task; both comfortably fast
    (single/double-digit ms) on real data.
  - Adaptive halving: **not observed** in M2 (archive) or M4 (eviction) — no
    `... halved` debug line in either. The governor was **absent**, as
    intended (no `BACKGROUND_WORK_GOVERNOR` registered in this harness), so
    `RetentionRunBudget.waitForGovernor`'s `governor === null` fast-path was
    exercised, not the wait path.
- **Criteria not proven / FAILED**:
  - **M1 FAILS**: 1066 ms and 1011 ms against the ≤ 1 s target, on two
    independent copies. Single-sample only (the migration's `ALTER
    TABLE`/one-shot `UPDATE` statements are not re-runnable for a second
    sample on the same file). No fixed-rule fallback is specified for M1 by
    the task (the fallback table only covers M2's archive floor and M3/M4's
    delete-batch size), so this is reported as a plain FAIL with no
    recommended mitigation — a call for the team-leader/architect, not a
    change this report is authorized to make.
  - **M4 at the production default (200) FAILS** on `max` (133-1730 ms) in
    both attempts, though `p95` stays under 100 ms both times. Per the fixed
    rule, the largest passing size in {200, 100, 50} is **100** — recommended
    but not applied to source.
- **Risks a reader should know about**:
  - M4's 200-batch-size `max` was highly variable between the two
    measurements (133 ms vs. an earlier exploratory 1730 ms on one outlier
    batch) — consistent with WAL checkpoint timing landing inside whichever
    transaction happens to trigger it (same phenomenon TASK_2026_440's Task
    7.4 documented for A2). A single bad-luck sample could report either a
    marginal fail or a dramatic one; 100 was chosen because both its
    measurements passed cleanly with real margin (max 116 ms vs. the 120 ms
    bound), not because the 200-size failure was itself precisely
    characterized.
  - M1's migration-duration finding rests on n=2 (not a distribution) because
    the migration cannot safely re-run against the same file; a third
    independent copy was not measured given the task's "report only" scope
    and to minimize additional live-snapshot copy operations.
  - `node:sqlite`, not `better-sqlite3`, was used throughout (mandated by the
    task, consistent with Task 7.4's finding that `better-sqlite3`'s Electron
    ABI does not load under plain Node/Jest in this environment) — production
    Electron timings could differ, as Task 7.4 already flagged for its own
    A1/A2 numbers.
  - The M2/M3 archive-then-delete pass consumed the snapshot's ~23,902
    eligible-for-archival rows; the M4 sweep therefore used separate fresh
    copies (`timing-copy-b200`, `timing-copy-b100`) rather than continuing on
    the M2/M3 file, so M4's numbers are independent of M2/M3's row churn.
