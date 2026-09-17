# Test Report - TASK_2026_440_834c (Batch 7: Tasks 7.1, 7.2)

## Scope

- User request: verify the memory-retention feature (migration 0043, page reclaimer, retention
  store/service, cron job wiring, diagnostics) end to end across the 8 affected projects, and prove
  the two unverified timing assumptions (A1 incremental-vacuum step cost, A2 processed-purge batch
  cost) against the shape of a real 1.28 GB production database, without ever touching the live DB
  or its only rollback snapshot.
- Criteria tested (from `batches.md` "Batch 7" / "Plan validation"):
  - All 8 projects' `test`, `typecheck`, `lint` targets pass, each header reporting **8 projects**.
  - 0-skipped reachability for the 8 named specs/describe-blocks (Task 7.1).
  - A1 (`incremental_vacuum(2048)` step) and A2 (500-row processed-purge batch) measured on a
    **copy** of the pre-migration snapshot, never the original file or the live DB (R-TL4).
  - A6 (`session_id = ''` processed rows) counted before/after the purge on the copy.
- Regressions covered: none opened in Batch 7 (verification-only batch); prior batches' regression
  specs are exercised as part of the full suite run below (e.g. Task 1.4's atomic-publish collision
  specs, run as part of `backup.service.spec.ts` / `integrity-worker-protocol.spec.ts`).
- Review findings covered: mutation-sensitivity is **not re-run** in Batch 7 per its routing note
  (editing host sources while the Task 7.3 lane works in the same worktree risks a stray edit
  reaching a commit). Cited instead, as directed:
  - `code-logic-review-batch-5-fixes.md`: mutation-sensitivity walk-through for
    `thoth-runtime.spec.ts:535-572` (cli-engine's registration/handler-reach retention tests) —
    removing the production `has()` guard, removing registration, or wiring a handler that does not
    reach the retention service each independently fails a named assertion.
  - `code-logic-review-batch-3-fixes.md`: verdict "M1, M2, and m1 are genuinely closed with exact,
    regression-sensitive assertions."
  - `code-logic-review-batch-1-task-1.4-r1.md`: r1 re-review of the atomic-publish fix (APPROVED, 0
    blocking / 0 serious / 1 moderate / 1 minor), which the `backup.service.spec.ts` /
    `integrity-worker-protocol.spec.ts` atomic-publish tests below re-run (not re-audit) as part of
    the full suite.
- Deliberately not tested: mutation sanity (cited, not re-run, per routing note above); Task 7.3
  (docs-only, a parallel lane, already landed — see Execution/git status below); manual Electron
  field check from `implementation-plan.md` (out of scope for an automated report).

## Suites

### Full 8-project test / typecheck / lint — reachability

- Requirement: every project touched by Components 1-10 still builds, typechecks and lints, and the
  reachability specs for the DI wiring, cron-job wiring and real-SQLite integration path run (not
  skip).
- Cases: the 8 named reachability specs/describe-blocks (below); the remainder of each project's
  existing suite as a regression backstop.
- Files: no new files (verification only). Ran against the worktree as committed through Batch 6.

### A1/A2 timing — real pre-migration snapshot, copy only

- Requirement: A1 (page-reclaim step) and A2 (processed-purge batch) stay inside their design
  budgets when driven against data shaped like the actual 1.28 GB production file, never the
  original.
- Cases: >=200 A2 batches (500 rows/batch, real 7-day cutoff) or exhaustion; >=50 A1 steps (2048
  pages/step) or an empty freelist; one `MemoryRetentionService.run()` call with every gate forced
  open; A6 `session_id = ''` processed-row count before and after the A2 phase.
- Files: `libs/backend/memory-curator/src/lib/retention/memory-retention.timing.local.spec.ts` —
  **created, run, then deleted** (see Execution). Never committed.

## Execution

### Task 7.1 — Full suite

Command run (verbatim, `--parallel=1` per R-TL7):

```
npx nx run-many -t test --parallel=1 -p @ptah-extension/persistence-sqlite @ptah-extension/memory-curator @ptah-extension/thoth-runtime @ptah-extension/cli-engine @ptah-extension/rpc-handlers @ptah-extension/shared @ptah-extension/platform-core @ptah-extension/memory-curator-ui
```

Header confirmed **8 projects**. Per-project result (Test Suites / Tests):

| Project | Suites | Tests | Notes |
| --- | --- | --- | --- |
| `@ptah-extension/shared` | 57 passed / 57 | 1398 passed / 1398 | clean |
| `@ptah-extension/platform-core` | 32 passed / 32 | 576 passed + 4 todo / 580 | clean (R-TL7 spec ran fine at `--parallel=1`) |
| `@ptah-extension/persistence-sqlite` | 29 passed, 9 skipped / 38 | 393 passed, 80 skipped / 473 | skips are pre-existing, gated on the `better-sqlite3` native binary specifically (`integrity-worker-backup.integration.spec.ts`, 7 native-only migration ratchet specs, `sqlite-connection.realbinary.spec.ts`) — console shows `native probe failed; ... skipped: NODE_MODULE_VERSION 143 ... requires ... 137`. None of the retention specs are in this skip set. |
| `@ptah-extension/memory-curator` | 35 passed, 2 skipped / 37 | 550 passed, 59 skipped / 609 | skips are `knowledge-agents/corpus.store.spec.ts` and `corpus-suggestion.service.spec.ts` — unrelated feature, same native-binary gate. No retention spec skipped. |
| `@ptah-extension/memory-curator-ui` | 17 passed / 17 | 183 passed / 183 | clean |
| `@ptah-extension/rpc-handlers` | **1 failed**, 98 passed / 99 | **1 failed**, 33 skipped, 2992 passed / 3026 | see failure analysis below |
| `@ptah-extension/thoth-runtime` | 5 passed / 5 | 87 passed / 87 | clean |
| `@ptah-extension/cli-engine` | 17 passed / 17 | 179 passed / 179 | clean |

**rpc-handlers failure, confirmed flaky, not a product defect**: `skills-sh-legacy-adoption.spec.ts`
> `groups slugs from different repos into different source roots` failed with "Exceeded timeout of
5000 ms for a test" during the 8-project sequential run. This file is unrelated to memory retention
(skills.sh legacy-adoption feature) and untouched by this task. Re-ran the project in isolation:

```
npx nx run-many -t test --parallel=1 -p @ptah-extension/rpc-handlers
```
→ **99 passed / 99 suites, 2993 passed / 3026 tests (33 skipped, pre-existing/unrelated), 0 failed.**
The same test that timed out under full-suite CPU contention passed cleanly alone. Treated as an
environmental flake (Jest's default 5 s timeout under load), not a regression from this task.

**Typecheck** — `npx nx run-many -t typecheck --parallel=1 -p <same 8>`: header confirmed
**"Running target typecheck for 8 projects"**, exit 0, **"Successfully ran target typecheck for 8
projects."** No errors.

**Lint** — `npx nx run-many -t lint --parallel=1 -p <same 8>`: **"Successfully ran target lint for 8
projects"** (all 8 read from cache or freshly linted), **0 errors**, only pre-existing warnings
(`max-lines` on files this task did not touch, a couple of `no-unused-vars` / `no-empty-function` /
`no-non-null-assertion` warnings, none in files this task created or modified).

### Task 7.1 — Reachability (Jest `--json` per file, 0 skipped required)

| Spec / describe block | Tests | Result |
| --- | --- | --- |
| `thoth-runtime` `start-thoth-cron.spec.ts` `describe('memory retention job')` | 4 | 4 passed, 0 skipped: "upserts the exact `@ptah/memory-retention` job...", "the registered handler reaches `service.run`...", "registers once and upserts twice...", "registers no retention job without the service..." |
| `thoth-runtime` `memory-retention-job.spec.ts` | 9 | 9 passed, 0 skipped (job-id/schedule pin, handler→`service.run` wiring, all 4 report-mapping branches, power-monitor/foreground-tracker resolution, unresolvable-service branch) |
| `cli-engine` `bootstrap/thoth-runtime.spec.ts` retention tests | 5 | 5 passed, 0 skipped: runtime tier upsert/register-once, handler→`service.run` reach, **repeated start** ("two runtime activations register memory:retention once, upsert twice..."), no-service branch, **oneshot tier** ("the oneshot tier registers and upserts nothing") |
| `memory-curator` `di/register.spec.ts` | 2 | 2 passed, 0 skipped: "registers the retention service, its store and its limits"; "resolves one singleton service whose graph reads the real database" |
| `persistence-sqlite` `sqlite-page-reclaimer.spec.ts` DI assertion | 1 | 1 passed, 0 skipped: "registers `SQLITE_PAGE_RECLAIMER` as a singleton `SqlitePageReclaimer`" |
| `memory-curator` `retention/memory-retention.integration.spec.ts` (all tests) | 5 | 5 passed, 0 skipped: real-SQLite-binding guard, the 4-run purge/quarantine/reclaim/idempotency scenario, row-budget-shared-across-steps, row-budget-partial-then-completes, mid-batch-failure-then-recovers |
| `persistence-sqlite` `backup.service.spec.ts` atomic-publish tests | 5 | 5 passed, 0 skipped: unavailable-verdict cleanup, daily-winner-without-degradation race, early-exit preserves another host's final, staging sweep (young/old) |
| `persistence-sqlite` `integrity-worker-protocol.spec.ts` atomic-publish tests | 8 | 8 passed, 0 skipped: publish-and-remove-staging, EEXIST-no-cleanup, corrupt/unavailable never publish, cleanup-after-backup-failure, no-fallback-on-publish-failure, real-fs hard-link no-overwrite/EEXIST, `removeBackupArtifact` never throws |

Mutation sanity: **not performed** in Batch 7 (routing note: editing host sources while the Task 7.3
docs lane works in the same worktree risks a stray edit reaching a commit). Cited instead — see
"Review findings covered" above.

### Task 7.2 — A1/A2 timing on a temp copy (R-TL4) — run 1 — non-production pragmas (superseded for A1)

**Environment**: Windows 11 Home 10.0.26200, Node v24.15.0, SQLite opener **`node:sqlite`**
(`better-sqlite3`'s native binary failed to load under the Jest/ts-jest process — `NODE_MODULE_VERSION
143` vs the running Node's required `137` — the same ABI mismatch the persistence-sqlite suite logs
for its own native-gated specs; a bare `node -e` outside Jest loaded `better-sqlite3` fine, so this
is specifically a Jest-process binding issue, not a missing build — **team-leader correction after Task 7.4:
that check was `require` only; `new Database` fails in plain Node too, because the repository binary is
built for Electron's ABI (NODE_MODULE_VERSION 143 vs 137)**), SQLite engine version **3.51.3**,
disk **SSD** (Kingston SNV2S1000G, 374 GB free). Per the task's own framing: **node:sqlite timings
here approximate, but may not equal, production `better-sqlite3` inside Electron** — treat the A1
finding below as a signal to act on, not an exact production number.

1. **Snapshot facts, before**: `C:\Users\abdal\.ptah\state\ptah.pre-migration-20260909T230600Z.sqlite`
   — **1,178,537,984 bytes**, **2026-09-10 02:06:09** — matches the expected `1,178,537,984` /
   `2026-09-10 02:06`. Never opened, written, renamed or deleted; `ptah.sqlite` was never opened.
2. **Temp dir**: `C:\Users\abdal\AppData\Local\Temp\ptah-task-440-timing-20f73e61` — created with a
   fail-if-exists `mkdir` (8 lowercase-hex suffix from `crypto.randomBytes(4)`). Copied the snapshot
   into it as `timing-copy.sqlite` (non-`ptah`-prefixed name; 2.8 s for 1.28 GB).
3. **Opened only the copy.** Initial reads (via the same `node:sqlite` opener the specs fall back
   to): `auto_vacuum=2` (INCREMENTAL), `page_size=4096`, `page_count=287729`, `freelist_count=137`,
   `MAX(version)` in `schema_migrations` = `41`. Real-clock counts: `processed_at` older than 7 days
   = **174,824**; unprocessed `captured_at` older than 14 days = **2,332**. Applied **only**
   `MIGRATIONS.find(m => m.version === 43).sql`, no runner, no backup service — **9 ms**, DDL-only,
   two new empty tables (matches the migration's own docblock claim of no `observation_queue` scan).
4. **Harness**: `libs/backend/memory-curator/src/lib/retention/memory-retention.timing.local.spec.ts`
   (temporary), driven by `PTAH_TIMING_COPY_PATH`. Used the real `ObservationRetentionStore`,
   `SqlitePageReclaimer` and `MemoryRetentionService`, constructed directly (not through DI/the
   `retention-sqlite.test-support.ts` fixture, since that fixture builds its own scratch DB — this
   harness needed the actual copy file). Ran via
   `npx jest --config libs/backend/memory-curator/jest.config.ts --testPathPatterns="memory-retention.timing.local.spec.ts" --runInBand`
   with `PTAH_TIMING_COPY_PATH` set. **1 test suite passed, 1 test passed**, wall time 78.8 s.

   **A2** — `store.purgeProcessedBatch(cutoff = now - 7d, 500, cursor)`, direct calls: **350
   batches** (>= the 200-batch minimum; the pass exhausted naturally), **174,824 rows deleted**
   (matches the pre-count exactly). **p50 = 7 ms, p95 = 50 ms, max = 66 ms.**

   **A1** — `reclaimer.reclaimStep(2048)`, direct calls, after the A2 purge: **113 steps** (>= the
   50-step minimum), freelist driven from a large post-purge value to **0**. **p50 = 588 ms, p95 =
   1227 ms, max = 1687 ms.**

   **`MemoryRetentionService.run()` once**, gates forced open via a fixed `now: () => (realNow + 365
   days)` (so `startedAt - constructionTime` >> `bootDeferralMs`), `isOnBattery: () => false`,
   `msSinceForegroundActivity: () => Infinity`: **`status: "completed"`**, `processedPurged: 10343`,
   `stuckQuarantined: 4214`, `ledgerPruned: 0`, `freedBytes: 35,217,408`, `pagesReclaimed: 14135`,
   `backlogRemaining: false`, measured wall time **1432 ms**. (The report's own `durationMs: 0` is an
   artifact of using one fixed `now()` value for both the start and finish timestamp — the DTO field
   is not a real measurement here; the 1432 ms wall-clock figure is.) The processed/stuck rows found
   by this call are additional to A2's 174,824: the far-future clock ages the *entire* remaining
   table past the 7/14-day cutoffs, so this call is a "does the service run end to end" proof, not a
   second independent A1/A2 sample. Per-step adaptive-halving events are logged at `debug`, which
   this harness's logger stub discarded (no-op) — **not directly observed**. Given every direct A1
   call at 2048 pages exceeded the 120 ms hard bound (see below), the service's own budget loop would
   have halved the step size on its very first internal reclaim call; this is a reasonable inference
   from the measured per-page cost, not a captured log line, and is flagged as a report limitation
   rather than claimed as measured.
5. **A6**: `session_id = ''` AND `processed_at IS NOT NULL` in `observation_queue` — **before the
   purge: 0**. **After the purge: 0.** No fix required; matches the plan's assumption and the Batch 3
   reviewer's judgment (check 4) that this is a non-issue on real data.
6. **Close and re-verify.** Closed the copy handle. Re-checked the original snapshot:
   **1,178,537,984 bytes, 2026-09-10 02:06:09 — identical to step 1.** Deleted the temp dir; confirmed
   gone (`Test-Path`-equivalent check after `rm -rf` returned false).
7. **Harness deletion.** Deleted
   `libs/backend/memory-curator/src/lib/retention/memory-retention.timing.local.spec.ts`.
   `git status --short -- libs/backend/memory-curator/src/lib/retention/` returned **no output** —
   confirmed absent from the working tree.

### Git status note (Task 7.3, informational only)

`git status --short` outside `.ptah/specs/**` shows exactly two modified files, matching the Task 7.3
docs-only change already landed by the parallel lane (comment-only, per its own description):

```
 M libs/backend/persistence-sqlite/CLAUDE.md
 M libs/backend/persistence-sqlite/src/lib/backup.service.ts
```

Not authored or touched by this report. No other source changes are present; the remaining `git
status` entries are the untracked task-folder `.md` artifacts already in `.ptah/specs/TASK_2026_440_834c/`.

### Not executed

- Mutation sanity (see above — cited, not re-run, by design).
- The manual Electron field check from `implementation-plan.md`'s "Verification points" (out of
  scope for an automated report; would need a running Electron host against a copy of the file).

## Verdict

- **Criteria proven**:
  - All 8 projects: test (modulo one confirmed-flaky, unrelated, now-passing test), typecheck, lint
    — each command's header reported 8 projects.
  - 0-skipped reachability across all 8 named specs/describe-blocks (37 individual test cases, all
    passed).
  - A6: no fix needed on real data (0 rows before and after).
  - **A2 PASSES**: p50 7 ms / p95 50 ms / max 66 ms, comfortably inside the ~60 ms/batch target and
    the 120 ms hard bound. `batchSize` default (500) needs no change; `file-settings-keys.ts` parity
    (500) stands.
  - Migration 0043 applied in 9 ms with zero `observation_queue` scan, as designed.
- **Criteria not proven / FAILED**:
  - **A1 FAILS**, badly: p50 588 ms, p95 1227 ms, max 1687 ms against a target of ~100 ms/step and a
    **hard 120 ms bound** — 5x to 14x over on this environment. Every single one of the 113 direct
    `reclaimStep(2048)` calls exceeded 120 ms (the fastest recorded step was still far above target;
    no step landed at or under 120 ms).
- **Recommendation (Batch 3 files, before merge, per R1)**:
  - `memory-curator/src/lib/retention/memory-retention-config.ts`:
    - Lower `RETENTION_RECLAIM_PAGES_PER_STEP` (initial step) from **2048 to 256** — starting at the
      *current floor* instead of 8x above it means the very first call is already in the
      measured-safe neighborhood instead of guaranteed to blow the 120 ms bound and rely on halving
      to recover.
    - Lower `RETENTION_MIN_RECLAIM_PAGES_PER_STEP` (adaptive floor) from **256 to 128** — at the
      measured worst-case rate (~0.82 ms/page, from 1687 ms / 2048 pages), 256 pages alone could
      still land at ~211 ms in a bad tail, over the hard bound; 128 pages gives adaptive halving
      genuine headroom to land under 120 ms even on this disk's worse moments.
  - No change recommended to `RETENTION_MAX_RECLAIM_PAGES_PER_RUN`, `batchSize`, or any A2-side
    constant — A2 has no finding against it.
  - Caveat this recommendation is offered *with*: this measurement ran on `node:sqlite`, not the
    `better-sqlite3` binding Electron production actually loads (see Environment). The magnitude of
    the overrun (every one of 113 calls over the bound, several multiples over) is large enough that
    it is unlikely to be a pure binding artifact, but the exact lowered numbers above should be
    treated as a starting point for Batch 3's owner to re-check against `better-sqlite3` timings if
    that measurement becomes available, not as a final tuned value.
- **Risks a reader should know about**:
  - The rpc-handlers timeout flake (`skills-sh-legacy-adoption.spec.ts`, unrelated feature) may
    recur under heavy parallel CI load; it is a pre-existing Jest-default-timeout sensitivity, not
    something this task introduced or can fix within its scope.
  - Adaptive halving's actual in-service behavior under A1-class load was not directly observed
    (debug logs stubbed in this harness) — only inferred from the direct per-call measurements. A
    follow-up that captures `logger.debug` output during a service-driven run (not direct store/
    reclaimer calls) would close that gap.
  - This run used `node:sqlite`; a same-shaped measurement under `better-sqlite3` (e.g., via an
    Electron-hosted harness) would be the stronger production signal for finalizing the lowered
    defaults.

## Task 7.4 — re-measure under production pragmas

Re-measures A1/A2 with the exact six pragmas production applies on every connection open
(`sqlite-connection.service.ts:85-92`: `journal_mode = WAL`, `foreign_keys = ON`,
`synchronous = NORMAL`, `temp_store = MEMORY`, `mmap_size = 268435456`, `busy_timeout = 5000`),
applied in that order, plus a step-size sweep and two full `MemoryRetentionService.run()` calls with
a debug-capturing logger. Run 1 (above) used `node:sqlite` defaults — a rollback journal with
`synchronous = FULL` — which pays journal writes and fsyncs on every `reclaimStep` transaction that
production's WAL/NORMAL mode defers to checkpoint time; run 1's A1 numbers are **superseded** by this
section.

### Safety proof

1. **Snapshot, before**: `C:\Users\abdal\.ptah\state\ptah.pre-migration-20260909T230600Z.sqlite` —
   **1,178,537,984 bytes, 2026-09-10 02:06:09** — matches expected. Never opened, written, renamed or
   deleted; `ptah.sqlite` was never opened.
2. **Temp dir**: `C:\Users\abdal\AppData\Local\Temp\ptah-task-440-timing2-dc14f737` — created with a
   fail-if-exists `mkdir` (8-hex suffix). Every copy inside it was named `timing-copy-*` (never
   `ptah*`) and deleted as soon as its series finished (verified empty mid-run after the M1a/A1
   sweep, and again after M2's failed attempts left one stray copy that was explicitly cleaned up —
   see M2 below).
3. Every connection applied the six production pragmas **in the documented order**, then migration
   **0043 only** (`MIGRATIONS.find(m => m.version === 43).sql`) — no `SqliteMigrationRunner`, no
   `SqliteBackupService`, no `PTAH_DB_PATH` under `~/.ptah`.
4. **Snapshot, after**: re-checked once every M1/M2 connection was closed —
   **1,178,537,984 bytes, 2026-09-10 02:06:09 — identical to step 1.** Temp dir deleted; confirmed
   gone (`rm -rf` then existence check returned false).
5. **Harness deletion**: `libs/backend/memory-curator/src/lib/retention/memory-retention.timing.local.spec.ts`
   deleted. `git status --short -- libs/backend/memory-curator/src/lib/retention/` returned **no
   output**. Full `git status --short`, filtered to exclude the pre-existing untracked
   `.ptah/specs/**` task-folder artifacts, returned **no output** — no source changes of any kind are
   pending from this task (all prior batches, including Task 7.3, are already committed per the
   coordinator's brief).

### M1 — `node:sqlite`, real classes, production pragmas

Harness: `libs/backend/memory-curator/src/lib/retention/memory-retention.timing.local.spec.ts`
(temporary), run via
`npx jest --config libs/backend/memory-curator/jest.config.ts --testPathPatterns="memory-retention.timing.local.spec.ts" --runInBand`
with `PTAH_TIMING_SRC` / `PTAH_TIMING_DIR` set. **1 suite passed, 1 test passed, 40.2 s wall.**

**Pragma readback** (identical on every copy opened this run): `journal_mode: "wal"`,
`synchronous: 1` (NORMAL), `auto_vacuum: 2` (INCREMENTAL), `page_size: 4096`, `page_count: 287729`,
`freelist_count: 137` (fresh copy, before any purge).

#### M1a — A2 (`purgeProcessedBatch(500)`), production pragmas

| Metric | Value |
| --- | --- |
| Batches | 350 (>= 200 minimum; exhausted naturally) |
| Rows deleted | 174,830 |
| p50 | 5 ms |
| p95 | 50 ms |
| **max** | **487 ms** |

**A2 mostly PASSES** (p50/p95 comfortably under the ~60 ms target and the 120 ms hard bound), but
**one of the 350 batches spiked to 487 ms** — over the hard bound. This is consistent with an
automatic WAL checkpoint landing inside that one transaction (WAL mode defers fsync to checkpoint,
so the checkpoint's cost surfaces as a latency spike on whichever caller triggers it, not spread
evenly). Run 1's max (66 ms, rollback-journal mode) never hit this because DELETE-journal mode
fsyncs every commit instead of batching into an occasional larger stall. **Residual risk**: a
production-shaped A2 batch can occasionally exceed the 120 ms hard bound because of WAL checkpoint
timing, independent of `batchSize`. Not actioned here (out of scope: the selection rule below governs
only the A1 reclaim-step constants); flagged for Task 7.5's owner to note against `memory-retention.service.spec.ts`'s
slow-call/halving assertions and to decide whether it needs a mitigation, since a halved batch does
not fix a checkpoint-timing stall the way it fixes a genuinely-too-large read.

#### M1b — A1 step-size sweep (`reclaimStep(size)`, >= 30 reps/size), production pragmas

| Step size | n | p50 | p95 | max | ms/page (p50) | Bound (max<=120 & p95<=100) |
| --- | --- | --- | --- | --- | --- | --- |
| 2048 | 30 | 491 ms | 1172 ms | 1181 ms | 0.240 | **FAIL** |
| 1024 | 30 | 162 ms | 393 ms | 403 ms | 0.158 | **FAIL** |
| 512 | 30 | 86 ms | 151 ms | 164 ms | 0.168 | **FAIL** (p95 151 > 100) |
| **256** | 30 | 20 ms | 44 ms | 44 ms | 0.078 | **PASS** |
| 128 | 30 | 12 ms | 13 ms | 13 ms | 0.094 | PASS |
| 64 | 30 | 5 ms | 6 ms | 7 ms | 0.078 | PASS |

Sweep ran sequentially (2048 -> 64) on **one copy**, reusing the freelist A2 generated (no refill was
needed — the freelist stayed above the `size * 30` threshold for every size in the sweep). **Under
production pragmas, A1 is dramatically cheaper than run 1's rollback-journal measurement** (max at
2048 dropped from 1687 ms to 1181 ms; the smaller sizes are 20-100x cheaper than run 1 suggested)
confirming the team-leader's hypothesis that journal mode/fsync policy, not page count alone,
dominated run 1's cost.

**Methodological caveat, reported honestly rather than smoothed over**: the sweep ran the sizes in
descending order on a single file, so it does not cleanly separate "step size" from "OS page-cache
warmth" — the 2048-size reps ran first against a comparatively cold cache (a fresh copy, just
migrated), while 128/64 ran last against pages the process had already touched repeatedly. The
per-page cost (`ms/page`) is not monotonically decreasing with size (512 at 0.168 is higher than 1024
at 0.158), which is consistent with a warmth effect layered on top of a real size effect rather than
size being the only variable. Section M1c below surfaces the same tension directly: the service's own
16 reclaim steps at the CURRENT default (2048), run immediately after its own purge on an
already-warm file, all landed at or under 120 ms — contradicting the cold-cache sweep's 2048 numbers.
Both are real measurements of the same code; they describe different cache regimes. This report
applies the selection rule exactly as specified (using the M1b sweep, not the warm service-run
numbers), and flags the discrepancy as a risk for Task 7.5's owner rather than picking whichever
number is more convenient.

**Selection candidates** (max <= 120 ms AND p95 <= 100 ms): **{256, 128, 64}**. Largest = **256**.

#### M1c — service runs, gates forced open (`bootDeferralMs: 0` override only; real clock otherwise)

Both runs purge/quarantine/reclaim against the SAME real 7-day/14-day cutoffs a production run would
use (no far-future clock trick this time — only the boot-deferral gate parameter was overridden, so
the cutoff math is exactly what production would compute right now). Each ran on its own freshly
copied, freshly migrated file (no pre-purge — the service does its own purge as part of `run()`).

**Run 1 — current default limits** (`reclaimPagesPerStep: 2048`):

- Report: `status: "partial"`, `reason: "row-budget"`, `processedPurged: 50000`,
  `stuckQuarantined: 0`, `freedBytes: 265,342,976`, `pagesReclaimed: 32768`, `backlogRemaining: true`.
  Wall time **3169 ms**. Ended on the **50,000-row `maxRowsPerRun` cap** (not the 60 s wall budget,
  not the 32,768-page reclaim cap directly — though `pagesReclaimed` also lands exactly on the
  32,768-page-per-run ceiling, so both the row cap and the reclaim cap bound this run simultaneously).
- Reclaim-step `pagesReclaimed` sequence (16 steps, proxy for the step-size sequence since freelist
  stayed far above 2048 throughout): `[2048 x16]` — **no halving observed**: every step requested and
  reclaimed the full 2048.
- Reclaim-step `durationMs` sequence: `[120, 95, 99, 98, 100, 98, 91, 119, 87, 73, 101, 72, 67, 89, 96, 111]`
  — max 120 ms, right at the bound; several steps in the 95-119 ms band. None exceeded 120 ms in this
  particular run, but the margin is thin and this contradicts the cold-cache sweep's 2048 numbers (see
  the caveat above) — this run's file was warmed by its own immediately-preceding purge.

**Run 2 — overridden limits** (`reclaimPagesPerStep: 256`, `minReclaimPagesPerStep: 64`, matching the
selection below):

- Report: `status: "partial"`, `reason: "row-budget"`, `processedPurged: 50000`,
  `stuckQuarantined: 0`, `freedBytes: 265,342,976`, `pagesReclaimed: 32768`, `backlogRemaining: true`.
  Wall time **3045 ms**. Same ending condition as run 1 (row cap / reclaim-per-run cap).
- Reclaim-step `pagesReclaimed` sequence: 128 steps of `256` each — **no halving observed** (every
  step stayed under the 120 ms `slowCallMs` threshold, so `adaptBatch`'s halving condition never
  fired).
- Reclaim-step `durationMs` sequence: overwhelmingly **1-7 ms**, with a periodic spike to **25-43 ms**
  (roughly every 13th step) — comfortably inside the 120 ms bound throughout, including every spike.
  The periodic spikes are consistent with WAL checkpoint activity (same phenomenon as A2's one 487 ms
  outlier, at a much smaller scale here because 256-page steps write far less per transaction).

Both runs reclaimed the identical `32768` pages and `265,342,976` freed bytes (both hit the same
per-run reclaim cap), so the two are a fair side-by-side: **256 finished slightly faster in wall time
(3045 ms vs 3169 ms) while keeping every single step comfortably under the bound**, whereas 2048 left
no margin (one step at exactly 120 ms).

### M2 — cross-check with the production binding (better-sqlite3), plain node

**Could not be completed — environment limitation, reported rather than worked around.** The
throwaway script (`m2-cross-check.mjs`, in the temp dir, using
`require('D:/projects/ptah-extension/node_modules/better-sqlite3')`) copied a fresh snapshot
successfully, but `new Database(copyPath)` failed:

```
Error: The module '...\better-sqlite3\build\Release\better_sqlite3.node'
was compiled against a different Node.js version using NODE_MODULE_VERSION 143.
This version of Node.js requires NODE_MODULE_VERSION 137.
```

**This corrects a claim in the Task 7.2 result notes** ("`better-sqlite3` loads in a bare `node`
process — only the Jest process has the ABI mismatch") and a claim in this report's own run-1
Environment paragraph. Both were based on an incomplete check: `require('better-sqlite3')` alone
only loads the package's JS wrapper and succeeds regardless of ABI — the native addon is not
`dlopen`'d until `new Database(...)` is actually called. Isolated reproduction, done twice more with
progressively closer copies of the M2 script (plain `require`, `require` + `fs.copyFileSync` of the
real 1.2 GB snapshot, then `new Database(':memory:')`), confirmed: `require('better-sqlite3')`
succeeds every time; `new Database(...)` reliably fails with the same ABI error every time, from any
location, regardless of preceding I/O. **The native binary in this worktree's resolved
`node_modules` is genuinely Electron-only and cannot be loaded by any plain Node process** — not a
transient or Jest-specific issue. Rebuilding it for this Node version was not attempted: it would
modify `node_modules` shared with other in-flight work in this worktree/repo, which is out of this
task's "edit no source" scope and would risk breaking the Electron-targeted build other lanes may
depend on.

**Consequence for the selection rule**: the rule's proviso ("provided M2 does not show that size over
120 ms max") is a veto condition — it has no data to veto with. The selection below is made from M1
alone; the production-binding cross-check remains **unverified** and is called out as a residual risk.
All leftover files from the M2 attempts (the stray `timing-copy-m2.sqlite` left by the first failed
attempt, and three minimal repro scripts) were deleted before the temp dir was removed (see Safety
proof, step 2).

### Selection (reported, not applied — no source edited)

Per the fixed rule in `batches.md` Task 7.4, applied to the M1b sweep:

- `RETENTION_RECLAIM_PAGES_PER_STEP` (initial) = **256** — the largest of {2048, 1024, 512, 256, 128,
  64} with max <= 120 ms AND p95 <= 100 ms.
- `RETENTION_MIN_RECLAIM_PAGES_PER_STEP` (floor) = **max(16, 256/4) = 64**.
- Not a BLOCKER: 64 (and 128, and 256) all passed the bound comfortably.

This selection is handed to **Task 7.5**, whose owner sets the constants; this report does not edit
`memory-retention-config.ts`.

### Verdict (Task 7.4)

- **A2**: still PASSES against its target (p50 5 ms, p95 50 ms), with one flagged residual (487 ms
  outlier, likely a WAL checkpoint stall, independent of the constants Task 7.5 will change).
- **A1**: **PASS at initial=256, floor=64** — not a BLOCKER. All of 256/128/64 met max <= 120 ms and
  p95 <= 100 ms in the production-pragma sweep; the service-run cross-check at both the current
  default (2048) and the proposed value (256) confirms 256 leaves comfortable margin under the bound
  while 2048 leaves essentially none.
- **Risks a reader should know about**:
  - M2 (the better-sqlite3/production-binding cross-check) could not run in this environment; the
    selection rests on `node:sqlite` data only. `node:sqlite` and `better-sqlite3` wrap the same
    SQLite engine, so the qualitative result (production pragmas make A1 far cheaper than run 1
    suggested, and 256 clears the bound with margin) is likely to hold, but the exact numbers are
    unverified against the binding Electron actually loads.
  - The cache-warmth confound in the M1b sweep (cold-to-warm ordering) means the sweep's absolute
    numbers at each size are not perfectly clean measurements of size alone; the M1c service-run
    cross-check (which runs each step size on a freshly-warmed file, matching production's own
    purge-then-reclaim sequence) is offered as a second, independently-gathered data point and it
    agrees with the sweep's selection (256 has real margin; 2048 does not).
  - A2's one 487 ms outlier (WAL checkpoint-shaped) is unactioned by this task's rule (which only
    covers A1 reclaim-step sizing) and should be named to Task 7.5's owner as a known residual, not a
    regression this report is silently accepting.
