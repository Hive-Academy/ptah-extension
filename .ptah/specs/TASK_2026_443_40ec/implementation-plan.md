# Implementation Plan - TASK_2026_443_40ec

Phase 2 of the Thoth rework (umbrella TASK_2026_439_1310): memory age lifecycle, ranking-only salience,
per-workspace cap.

All paths are relative to the worktree
`D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle` unless absolute. Every
`file:line` was opened in that worktree (branch `feat/task-439-phase2-memory-lifecycle`, HEAD 5e34e39cc, which
contains all of phase 1).

## Inputs and constraints

- Requirements used: `context.md` (user rules), `../TASK_2026_439_1310/context.md`,
  `../TASK_2026_439_1310/tribunal/verdict.md` section A (requirements source), `tribunal/brief.md` (live-DB
  numbers), phase 1 `../TASK_2026_440_834c/implementation-plan.md`, `test-report.md` (Task 7.2 / 7.4 procedure).
  No `task-description.md`: the verdict is the approved requirements source.
- Corrections applied: none.
- Design handoff used: none. UI work is limited to two rows in the phase 1 storage panel plus the deletion of
  one dead tile (Component 10).
- Missing decision-critical input: none that blocks the plan. Six product choices need the user's word and are
  listed under `## Decisions for Gate 2`. The plan is written with the recommended option of each.

### Sizing evidence (temp copy, 2026-09-15)

Procedure: fail-if-exists `mkdir C:\Users\abdal\AppData\Local\Temp\task-443-sizing-b1b1e1dc`; byte copy of
`ptah.pre-migration-20260909T230600Z.sqlite` (1,178,537,984 bytes, mtime 2026-09-10 02:06:09) to
`timing-copy.sqlite` with `COPYFILE_EXCL`; opened ONLY the copy with `node:sqlite` (Node 24.15.0) and the six
production pragmas in production order (`journal_mode = WAL`, `foreign_keys = ON`, `synchronous = NORMAL`,
`temp_store = MEMORY`, `mmap_size = 268435456`, `busy_timeout = 5000`); loaded
`node_modules/sqlite-vec-windows-x64/vec0.dll` (vec `v0.1.6`). All write probes ran inside `BEGIN IMMEDIATE` …
`ROLLBACK`. Snapshot re-checked after the run: same size and mtime. Temp dir deleted and confirmed gone. The live
`ptah.sqlite` was never opened.

The snapshot is older than the brief (2026-09-09 22:08 UTC, `schema_migrations` max = **41**). Numbers:

| Measure | Value |
| --- | --- |
| Memories | 31,302 (recall unpinned 31,300, core pinned 2, archival 0, `expires_at` set 0) |
| Never used (`last_used_at = created_at`) | 28,321 (90.5%); `hits = 0`: 28,554; `hits >= 10`: 58 |
| Recall unpinned, `last_used_at` older than 30 d / 60 d / 90 d (at snapshot time) | 22,243 / 17,752 / 3,751 |
| Same, 30 d / 90 d, evaluated at 2026-09-15 | 22,685 / 7,179 |
| Per workspace | `D:\projects\ptah-extension` 30,566 (97.6%); `property-hub` 658; `''` (empty string, not NULL) 43; four others ≤ 27 |
| Chunks / FTS docsize / vec rowids | 33,141 / 33,141 / 33,137; 98.8% of memories have 1 chunk; 0 orphans in each |
| `corpus_memories` | 0 rows |
| `subject LIKE 'code:%'` | 0 rows |
| Stored salience | unpinned min 0.55, avg 1.248, max 2.707; 74 rows above 1.45; `session_id IS NULL`: 1 unpinned recall (0.6) + 2 pinned core (1.0) |
| `memory_concepts_fts` definition on this file | `content=''` (contentless), 113,662 entries, `memory_id` reads NULL. **Drift** from the source DDL (see R1) |

Write-cost probes (production pragmas, vec loaded, rolled back):

| Probe | Result |
| --- | --- |
| Candidate select `tier='recall' AND pinned=0 AND last_used_at<? ORDER BY last_used_at LIMIT 500`, current indexes | `SEARCH ... idx_memories_tier (tier=?)` + `USE TEMP B-TREE FOR ORDER BY`, 43 ms |
| Same select with `(tier, last_used_at)` index | `SEARCH ... (tier=? AND last_used_at<?)`, max 3.8 ms over 45 batches |
| Archive UPDATE 500 rows (with the two new indexes) | 45 batches archived all 22,243 rows: p50 50.5 ms, max 69.7 ms, whole pass 2,347 ms |
| DELETE 500 memories (cascade → chunks, FTS trigger, vec trigger) | 52.6–69.2 ms (first probe); 76.6–126.3 ms over 15 batches (second probe) |
| DELETE 200 memories | 52.9–65.9 ms over 15 batches |
| Chunk / FTS docsize / vec rowid deltas per delete | equal to each other on every batch (e.g. 503/503/503); 0 vec and 0 FTS orphans after 10,500 deletes |
| DELETE of a memory with vec NOT loaded but `memory_chunks_vec_ad` present | **fails**: `no such module: vec0` |
| Migration pieces | `ADD COLUMN archived_at` 0.8 ms; `DROP INDEX idx_memories_salience` 1.5 ms; `CREATE INDEX (tier,last_used_at)` 50 ms; `(archived_at) WHERE tier='archival'` 32 ms; `corpus_memories(memory_id)` 0.2 ms; salience rebase UPDATE 31,299 rows 245 ms + 3 rows 31 ms |
| Delete-candidate select with a PARTIAL `archived_at` index, no `INDEXED BY` | planner ignored the partial index → `idx_memories_tier_last_used (tier=?)` + temp B-tree, 37–60 ms per batch |
| Ranking `ORDER BY` (proposed expression) | workspace-scoped `LIMIT 10`: 44.1 ms (old `ORDER BY salience`: 42.2 ms); unscoped `LIMIT 100`: 45.9 ms (old: 9.7 ms, index-served) |
| Preview counts (4 aggregates in one statement) | 62 ms |
| `recordUse` UPDATE for 20 ids | 5.7 ms |
| `SELECT exp(1), ln(2)` | works under `node:sqlite`; `better-sqlite3` builds with `SQLITE_ENABLE_MATH_FUNCTIONS` (`node_modules/better-sqlite3/deps/defines.gypi:27`). The plan still uses plain arithmetic. |

## Codebase evidence

| Evidence | Location | Architectural implication |
| --- | --- | --- |
| `scoreMemory` feeds the stored composite back as `base`; all terms additive | `libs/backend/memory-curator/src/lib/salience-scorer.ts:44-71` | The loop is in the scorer API itself. Delete `scoreMemory`; do not patch the job. |
| Curator writes `score({ base: hint+boost, hits: 0, lastUsedAt: now })` = base + 0.4 + 0.05 at insert, and on merge scores `max(target.salience, hint)` again | `memory-curator.service.ts:653-671` (merge), `:673-688` (insert), `:518` (tier default `recall`) | Second feedback loop (merge). Stored values are `base + 0.45` for unmerged curator rows, which makes an exact rebase possible (Component 1). |
| Writer adapter stores the raw request salience (0.6 / 1.0), unscored | `memory-writer.adapter.ts:83`; seeds `setup-rpc.handlers.ts:959-993` (two pinned core 1.0, one unpinned recall `key-files` 0.6) | Rows with `session_id IS NULL` already hold a base. Rebase must not subtract 0.45 from them. |
| Decay job: `< 0.1` archival branch, hit/salience promotion and demotion, `expires_at` sweep, loads every row with `store.all()` | `memory-decay.job.ts:62-107`; `memory.store.ts:661-666` | Built on salience; unscheduled. Deleted, not refactored (Architecture decision). |
| Decay job is registered but has no caller; diagnostics read `lastDecayInfo()` only | `di/register.ts:132-136`; `diagnostics.service.ts:33-34,48,57-58`; no cron registration in `start-thoth-cron.ts` | Dead registered code. Removal touches diagnostics, the wire DTO and one UI tile. |
| `recordHit` (the only `last_used_at` writer on a read path) runs inside `searchRichInner` for EVERY fused candidate, after the cache check | `memory-search.service.ts:283-288` (cache return skips it), `:309` (`rrfFuse(..., limit * 4)`), `:341-361` (loop over all `fused`, `recordHit` at `:360`); `memory.store.ts:516-522` | "Used" is over-counted (up to 4×topK rows per query when no reranker trims `fused`) and under-counted (a cache hit records nothing). A read service owns a hidden write. |
| `appendChunks` (curator merge) sets `last_used_at = now` | `memory.store.ts:573-575,603` | Merge is today's second writer of `last_used_at`. Kept as a "use" (Component 3). |
| Production reads that do NOT write `last_used_at` | session-start roster `memory-prompt-injector.ts:201-206` → `listAll` (`memory.store.ts:364-412`); `memory:get` `memory-rpc.handlers.ts:240-253`; `mem:getObservations` `mem-rpc.handlers.ts:145-148` → `memory-search.service.ts:676-732`; `mem:searchIndex` `memory-search.service.ts:546-615`; corpus priming `memory-prompt-injector.ts:259-333` | These paths deliver memory content or subjects without recording use. |
| Production callers of `IMemoryReader.search` (→ `searchRich` → `recordHit`) | prompt injection `memory-prompt-injector.ts:105-111` (called from `sdk-query-options-builder.ts:1371-1376`); MCP `ptah.memory.search` `memory-namespace.builder.ts:221`; skill digest probes `skill-gap-curator.service.ts:1082`; MCP code fallback `code-namespace.builder.ts:132-138`; UI `memory:search` `memory-rpc.handlers.ts:224` | Background probes (digest) and UI browsing count as "use" today. A skill-digest probe re-touching the same top hit is a feedback loop of its own. |
| `IMemoryReader` / `IMemoryLister` ports, `MEMORY_CONTRACT_TOKENS`, null implementations | `libs/backend/memory-contracts/src/lib/memory-reader.port.ts:30-45`; `tokens.ts:1-10`; `null-implementations.ts:17-24` | A use recorder is a new port here (zero-dep lib). Consumers inject it optionally. |
| Optional port injection precedent in the MCP API builder | `vscode-lm-tools/.../ptah-api-builder.service.ts:388-392,754-760` | Same seam carries the recorder to `buildMemoryNamespace`. |
| Schema: `memory_chunks.memory_id ... ON DELETE CASCADE`; FTS delete trigger; vec delete trigger is `vecSql` (applied only when vec loaded, else deferred); concepts trigger on `memories` | `migrations/0002_memory.ts:31,47-55`; `0019_memory_chunks_vec_cleanup.ts:15-19`; `migration-runner.ts:246-262`; `0017_memory_schema_v2.ts:42-44`; `corpus_memories ... ON DELETE CASCADE` `0018_corpora.ts:30` | A memory DELETE removes chunks, FTS rows and vec rows through triggers. With the vec trigger present and vec not loaded the DELETE fails (measured). A corpus member delete silently shrinks a corpus. |
| Production pragmas include `foreign_keys = ON` | `persistence-sqlite/src/lib/sqlite-connection.service.ts:86-91` | The cascade works in production, but the lifecycle deletes chunks explicitly so no correctness depends on the pragma. |
| `VecStatusService.available` | `persistence-sqlite/src/lib/vec-status.service.ts:32-34` | The lifecycle store's delete precondition. |
| `idx_memories_salience ON memories(salience DESC)`, `idx_memories_tier ON memories(tier)` | `0002_memory.ts:34,33` | After ranking moves to an expression, no statement reads the salience index (grep: only `ORDER BY` sites below). `(tier, last_used_at)` makes the tier index a redundant prefix. |
| Every salience-ordered read | `memory.store.ts:351` (`list`), `:386` (`listAll`); `memory-search.service.ts:815` (`listIndexRowsByFilter`) | The three places ranking salience is applied. Search (`searchRich`, `searchIndex`) never used salience. |
| Retention service: constructor with 6 deps; run-local guard closures; ordered steps; `continueAfterRows` | `retention/memory-retention.service.ts:143-155,319-339,341-425,407-409` | Lifecycle is inserted as a step after quarantine. The closures must be shared with the new step; they move to one named collaborator (Component 5). |
| Outcome mapping and run record | `memory-retention.service.ts:501-577,580-628`; state types `observation-retention.store.ts:228-266` | New counters extend the record and `MemoryRetentionRunReport`. |
| Retention limits object injected under a token; settings clamped at the file boundary | `retention/memory-retention-config.ts:22-43,84-112,124-165`; `di/register.ts:142-155` | Lifecycle settings and limits copy this shape. |
| Settings registry block for `memory.retention.*` | `libs/backend/platform-core/src/file-settings-keys.ts:335-339,593-598` | Register four `memory.lifecycle.*` keys beside them. |
| One job spec + handler factory for both hosts; summary string | `thoth-runtime/src/lib/memory-retention-job.ts:40-46,62-104`; Electron `start-thoth-cron.ts:266-293,473`; CLI `cli-engine/src/lib/bootstrap/thoth-runtime.ts:330,528-556` | No new job. The lifecycle is reached through `service.run`. Only the summary text changes. |
| Host reach specs build stub containers with a mocked `run` | `thoth-runtime/src/lib/start-thoth-cron.spec.ts:787-923`; `cli-engine/src/lib/bootstrap/thoth-runtime.spec.ts:456-599` | Extend with a REAL `MemoryRetentionService` whose lifecycle collaborator is a spy, so the spec fails if the handler or `run` skips the step. |
| Real-SQLite harness applies 0016 + 0043 only; fails, never skips | `retention/retention-sqlite.test-support.ts:73-85,171-210` | Extend with an opt-in memory schema and vec loading. |
| DI reach spec builds the real registration graph on a real DB | `di/register.spec.ts:1-120` | Extend for the lifecycle tokens and the absence of the decay token. |
| Migration 43 is the highest; eight ratchet specs assert `toBe(43)` | `migrations/index.ts` (last entry 43); `0028...spec.ts:78`, `0030...spec.ts:33`, `0038...spec.ts:86`, `0039...spec.ts:60`, `0040...spec.ts:73`, `0041...spec.ts:57`, `0042...spec.ts:65`, `0043_memory_retention.spec.ts:48` | New migration is **0044**; bump the eight ratchets. |
| Hand-written `memories` DDL in an app spec | `apps/ptah-electron/src/integration/wizard-seed.integration.spec.ts:119-133` | `insertMemoryWithChunks` will bind `archived_at`; that spec's schema must gain the column. |
| App spec mocks the deleted tokens | `apps/ptah-extension-vscode/src/integration/wizard-seed-noop.spec.ts:41-42` | Remove `MEMORY_SALIENCE_SCORER` / `MEMORY_DECAY_JOB` from the mock. |
| Wire DTOs: `lastDecayAt` / `lastDecayStats`, `'decay-run'` event kind, storage DTO | `libs/shared/src/lib/types/rpc/rpc-curator-diagnostics.types.ts:4,103-145,173-176`; handler mapping `memory-rpc.handlers.ts:530-541,564` | Remove the decay fields and kind; extend the storage DTO. `memory:` namespace exists, so no dual registration. |
| UI consumers of decay | tile `memory-diagnostics-accordion.component.ts:61-66,226,242-243`; state `memory-diagnostics-state.service.ts:30,41,68-70`; event tone `event-feed.component.ts:159`; producer `memory-curator.service.ts:300-306` | Deleted together. |
| Storage panel structure | `libs/frontend/memory-curator-ui/src/lib/components/diagnostics/storage-health-panel.component.ts:213-258,296-351` | One row in the "Last retention run" list, one row in the "Retention settings" list. |
| Null reader registrations in hosts without memory | `rpc-handlers/src/lib/host-profile/register-rpc-surface.ts:210-212`; `cli-engine/src/lib/thoth/register-thoth-libraries.ts:193-197` | The recorder is injected `isOptional`, so no null registration is needed. |
| `memory-curator` tags `scope:extension`, `type:feature`; allowed deps memory-contracts, persistence-sqlite, platform-core (+ vscode-core, shared) | `libs/backend/memory-curator/project.json:6`; `memory-curator/CLAUDE.md` Dependencies / Cross-Lib Rules | Nothing new crosses a boundary. `agent-sdk` and `vscode-lm-tools` reach the recorder only through `memory-contracts`. |

## Architecture decision

- **Chosen approach**:
  - One new step, **memory lifecycle**, inside the existing `MemoryRetentionService.run`, placed after stuck
    quarantine and before ledger prune and page reclaim. It uses the existing gates, due decision, single-flight
    flag, wall budget, `BEGIN IMMEDIATE` per batch and the `@ptah/memory-retention` job. No new job.
  - Two new collaborators in `memory-curator/src/lib/retention/`: `MemoryLifecycleStore` (every lifecycle SQL
    statement) and `MemoryLifecycleService` (policy: order, cutoffs, cap, preview, cache invalidation).
  - The run-local guard closures of `MemoryRetentionService.execute` move into one per-run object,
    `RetentionRunBudget`, so the queue steps and the lifecycle step obey one budget implementation.
  - `archived_at` column (migration 0044) records when a row became `archival`. Deletion counts M days from it.
  - "Used" becomes an explicit, recorded event through a new `IMemoryUsageRecorder` port. `MemorySearchService`
    loses its hidden write. A use restores an `archival` row to `recall`.
  - Salience becomes an immutable stored base in `[0, 1]`. Ranking is a query-time SQL expression
    `base × recency + use + pin`. Migration 0044 rebases the stored composites once.
  - `MemoryDecayJob`, `SalienceScorer` (class and token) and the decay diagnostics are deleted.
- **Rationale**:
  - Verdict A, Fix: "Lifecycle uses age, not salience", "Salience is for ranking only", "One `memory-retention`
    daily cron job that runs … the memory age rule". Phase 1 recorded the same seam as assumption A4
    (`../TASK_2026_440_834c/implementation-plan.md:150`).
  - The retention service already owns every gate the user named (`memory-retention.service.ts:259-294`); a
    second service with its own gates is what `context.md` forbids.
  - Separate store and policy classes follow phase 1's `ObservationRetentionStore` / `MemoryRetentionService`
    split. They keep `memory-retention.service.ts` (693 lines) under the ceiling and give each file one reason to
    change.
- **`MemoryDecayJob`: deleted, not refactored.**
  - Every rule in it is salience-driven (`memory-decay.job.ts:81-98`); the age rule shares none of its logic.
  - It loads the whole table into memory (`store.all()`), which contradicts bounded batches.
  - Its `expires_at` sweep has no writer (`memory.store.ts:198`, brief: 0 rows); the age rule replaces it.
  - Hit-based `recall → core` promotion would make an auto-promoted row exempt forever, which contradicts
    "not used for N days → archival" (Decision D4).
  - Keeping the class name for a different algorithm would leave `lastDecayInfo()` / `recordDecayEvent` wired to
    nothing. Replace, not accumulate.
- **AC2 — why `archived_at` and not `last_used_at` alone**:
  - With `last_used_at` only, a June row (unused 100 days) meets both "unused 30 d → archive" and "unused 90 d →
    delete" and leaves in back-to-back runs. The snapshot has 3,751 such rows at snapshot time and 7,179 at
    2026-09-15.
  - Rejected: `updated_at` as the archival stamp — `stats.lastCuratedAt` is `MAX(updated_at)`
    (`memory.store.ts:648-650`), so the lifecycle would fake curation times.
  - Rejected: re-using `expires_at` (`archived + M`) — it bakes M into data, so a changed setting does not apply
    to rows already archived, and the column's name says "expire", which the dead sweep read.
  - `ALTER TABLE ... ADD COLUMN` measured 0.8 ms.
- **AC3 — "used" definition (Decision D3)**: a memory is used when its content is delivered to a model or opened
  by the user.
  - Counts: prompt injection hits actually injected (`MemoryPromptInjector.buildBlock`); hits returned by the MCP
    `ptah.memory.search`; `memory:get`; `mem:getObservations` rows returned; curator merge (`appendChunks`).
  - Does not count: the session-start roster (it ranks by use, so counting it is a new feedback loop); the UI
    `memory:search` result list and `mem:searchIndex` compact rows (browsing subjects, not content); skill-digest
    probes (background, loop-shaped); the legacy code fallback (0 `code:` rows); corpus priming (corpus members
    are exempt instead, Decision D5).
  - A use on an `archival` row sets `tier = 'recall'`, `archived_at = NULL`. Rationale: archival is "out of the
    way, still retrievable"; a row a model or the user just read is not "unused".
- **AC4 — cap (Decision D1)**: default `memory.lifecycle.maxPerWorkspace = 25,000` evictable rows
  (non-core, unpinned, non-corpus) per `workspace_root` value (`NULL` and `''` are separate groups).
  - Rationale from the brief: creation ran 14,151 / 8,450 / 4,748 / 6,066-in-14-days per month (Jun–Sep). The age
    window N+M = 90 days holds about 14k rows at the August rate and about 39k at the September rate. 25,000 lets
    the age rule govern a normal month and bounds a busy one. At ~3.1 KB per memory including chunk and vec rows
    (brief: memories 35 MB + chunks 14 MB + vec 54 MB for 33k rows), 25,000 is about 78 MB.
  - Eviction order: `archival` rows first, oldest `last_used_at` first, and only rows with
    `archived_at < now − 7 d` (the cap grace). Then `recall` rows, oldest `last_used_at` first, and only when the
    evictable `recall` count ALONE exceeds the cap.
  - Same-run interaction: age delete → archive → cap. The grace means rows archived in this run are never evicted
    in this run, so AC2 holds even under the cap. First run on the snapshot shape: 0 evicted. From day 7:
    ~5.6k evicted for `ptah-extension` on the snapshot shape (~30.6k evictable − 25k), more on the live file.
  - Rejected: a global cap (the user's other workspaces would lose rows because one workspace is busy); archive
    instead of delete for cap eviction (archival rows also cost the vec bytes, so it would not bound size).
- **AC5 — ranking-only salience**:
  - Stored `salience` is the base in `[0, 1]`, written once at insert (`min(1, hint + boost)` for the curator;
    request value for the writer adapter). Merge does NOT change it; merge records use instead.
  - Ranking expression (one constant, `memory-curator/src/lib/salience-ranking.ts`):
    `m.salience * (604800000.0 / (604800000.0 + MAX(0, <now> - m.last_used_at))) + 0.3 * m.hits / (m.hits + 3.0) + m.pinned`
    — base × hyperbolic recency with a 7-day half-life (the scorer's current default,
    `salience-scorer.ts:38`) + saturating use term (max 0.3) + pin bonus 1.0. Plain arithmetic, so the result is
    identical under `better-sqlite3` and `node:sqlite` and needs no math extension.
  - An archival row (unused ≥ 30 d) has recency ≤ 7/37 ≈ 0.19, so it ranks below any recently used row without a
    tier filter. No roster filter is added.
  - Existing values: migration 0044 rebases once (exact for unmerged curator rows, `salience − 0.45`, clamped to
    `[0, 1]`; merged rows above 1.45 clamp to 1.0; `session_id IS NULL` and pinned rows clamp only). Measured
    245 ms + 31 ms on 31,302 rows. Rejected: reinterpretation at read time (`salience − 0.45` in every query) —
    two meanings for one column forever; rejected: a new `salience_base` column — the old column would stay as a
    dead second source.
  - The `< 0.1` branch goes with the decay job.
- **AC6 — scheduling**: the step runs inside `MemoryRetentionService.run`. Gates, due decision and budgets are
  inherited. A lifecycle backlog sets `backlog_remaining = 1`, so the next hourly tick is due, exactly as a queue
  backlog does (`memory-retention.service.ts:284-291,544`).
- **AC7 — dry-run preview**: the smallest surface is data on the existing `memory:diagnostics` result, computed at
  the END of each run for the NEXT due run and stored in `memory_retention_state` (no poll-time query — a live
  preview measured 62 ms against a 30 s poll on the main thread). `memory.lifecycle.enabled = false` turns the
  step into a pure preview: no archive, no delete, preview still recorded. UI: two rows in the phase 1 storage
  panel, because that panel already shows the retention run and its settings, and a separate surface would be
  the redesign phase 6 owns.
- **Rejected alternatives**:
  - A separate `@ptah/memory-lifecycle` job: forbidden by `context.md`; duplicates gates.
  - Refactoring `MemoryDecayJob` into the step: see above.
  - Recording use inside `IMemoryReader.search` (keep the side effect, add an option flag): still a write behind a
    cached read, and every consumer must remember the flag. A separate port makes each recording site explicit and
    testable.
  - Relying on the FK cascade alone for chunks: correct in production, but the harness and any connection without
    the pragma would orphan chunks silently. An explicit chunk DELETE costs one indexed statement.
  - A partial `archived_at` index: measured ignored by the planner without `INDEXED BY`; a full
    `(tier, archived_at)` index plus `INDEXED BY` gives a plan that does not depend on `sqlite_stat1` (phase 1
    rule, `observation-retention.store.ts:17-25`).
  - An `exp()`-based recency: equivalent ranking, but it depends on a compile flag in each binding.
- **Assumptions**:
  - A1. `require('sqlite-vec').getLoadablePath()` resolves a loadable binary in Jest on every CI platform, and
    `node:sqlite` `DatabaseSync(file, { allowExtension: true }).loadExtension(path)` works there (verified locally:
    Node 24.15.0, Windows x64, vec v0.1.6). Check: the integration spec's first test (it fails, never skips).
  - A2. A 200-row memory DELETE batch stays ≤ 120 ms max and the 500-row archive batch ≤ 100 ms p95 under the
    Electron `better-sqlite3` binding. Measured only under `node:sqlite` (phase 1 M2 showed `better-sqlite3` cannot
    load in plain Node here). Check: Component 12 timing batch; field `debug` log per batch. Adaptive halving
    bounds the damage.
  - A3. Mixed named and positional parameters are not needed: every ranked statement binds `now` in the same
    style it already uses (Component 2). Check: the ranking parity spec runs every changed statement on real SQLite.
  - A4. No production writer other than insert (stamped) and the lifecycle store sets `tier = 'archival'` after
    this change. Check: grep `'archival'` in non-spec `memory-curator` and `rpc-handlers` code during review.
- **Effect on existing code**:
  - Replaced: `SalienceScorer` class → pure ranking module; `MemoryStore.recordHit` → `recordUse`;
    `MemoryStore.updateSalience` deleted; three `ORDER BY salience` sites → ranking expression;
    `MemorySearchService` hidden `recordHit` deleted; `execute` closures → `RetentionRunBudget`;
    `MemoryDecayJob` + token + registration + `lastDecayInfo` + `recordDecayEvent` + `'decay-run'` +
    `lastDecayAt/lastDecayStats` wire fields + "Last decay sweep" tile deleted; job summary text extended.
  - Left alone: gates and due logic; queue purge, quarantine, ledger, reclaim; `@ptah/memory-retention` id,
    schedule and handler name; VS Code host (no Thoth cron, memory handlers expected absent); search fusion;
    curator extraction; `memory_concepts_fts` drift (R1).

## Component specifications

### 1. Migration 0044 — lifecycle column, indexes, salience rebase, run-record columns

- **Purpose**: persist archival time, index the lifecycle predicates, rebase stored salience, extend the run record.
- **Responsibilities**: static SQL only, applied once by the runner in its `BEGIN IMMEDIATE` transaction.
- **Verified contracts and entry points**: registry shape and static-SQL rule `migrations/index.ts:1-19` and the
  last entry (`version: 43`); `0043_memory_retention.ts` (table `memory_retention_state`); `0002_memory.ts:33-34`
  (indexes to drop); `0018_corpora.ts:28-34` (`corpus_memories` PK `(corpus_id, memory_id)`, so `memory_id` alone
  has no index).
- **Exact SQL** (`0044_memory_lifecycle.ts`, name `0044_memory_lifecycle`, `sql` only, not vec-gated):

```sql
ALTER TABLE memories ADD COLUMN archived_at INTEGER;

DROP INDEX IF EXISTS idx_memories_salience;
DROP INDEX IF EXISTS idx_memories_tier;
CREATE INDEX IF NOT EXISTS idx_memories_tier_last_used ON memories(tier, last_used_at);
CREATE INDEX IF NOT EXISTS idx_memories_tier_archived  ON memories(tier, archived_at);
CREATE INDEX IF NOT EXISTS idx_corpus_mem_memory       ON corpus_memories(memory_id);

UPDATE memories
   SET archived_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
 WHERE tier = 'archival' AND archived_at IS NULL;

UPDATE memories
   SET salience = MIN(1.0, MAX(0.0, salience - 0.45))
 WHERE pinned = 0 AND session_id IS NOT NULL;

UPDATE memories
   SET salience = MIN(1.0, MAX(0.0, salience))
 WHERE pinned = 1 OR session_id IS NULL;

ALTER TABLE memory_retention_state ADD COLUMN memories_archived        INTEGER NOT NULL DEFAULT 0;
ALTER TABLE memory_retention_state ADD COLUMN memories_deleted         INTEGER NOT NULL DEFAULT 0;
ALTER TABLE memory_retention_state ADD COLUMN memories_evicted         INTEGER NOT NULL DEFAULT 0;
ALTER TABLE memory_retention_state ADD COLUMN lifecycle_note           TEXT;
ALTER TABLE memory_retention_state ADD COLUMN preview_measured_at      INTEGER;
ALTER TABLE memory_retention_state ADD COLUMN preview_for_run_at       INTEGER;
ALTER TABLE memory_retention_state ADD COLUMN preview_archive_eligible INTEGER;
ALTER TABLE memory_retention_state ADD COLUMN preview_delete_eligible  INTEGER;
ALTER TABLE memory_retention_state ADD COLUMN preview_over_cap         INTEGER;
```

  - The indexes are dropped BEFORE the rebase UPDATE so the UPDATE does not maintain `idx_memories_salience`
    (measured 245 ms after the drop).
  - The rebase is a one-time reinterpretation. `0.45 = 0.4 × recency(0) + 0.1 × tierBias(recall 0.5)` from
    `salience-scorer.ts:44-49` with `hits = 0` at insert (`memory-curator.service.ts:679-686`).
  - No CHECK on `lifecycle_note`, same reason phase 1 gave for `last_outcome`.
- **Dependencies**: runner only.
- **Integration points**: `archived_at` is read and written by `MemoryStore` (insert stamp, `recordUse`,
  `appendChunks`) and `MemoryLifecycleStore`; state columns by `ObservationRetentionStore`.
- **Failure behaviour**: a migration failure follows the existing runner path; the pre-migration backup is the
  recovery. `ADD COLUMN` is not idempotent, which is correct: the runner applies a version once.
- **Quality requirements**: boot-path cost about 0.33 s on the snapshot shape (sum of measured pieces); no scan
  of `observation_queue`.
- **Verification seam**: `0044_memory_lifecycle.spec.ts` on real SQLite (harness from Component 11):
  - registry entry is version 44, plain `sql`, highest version, contains no `${`;
  - after migrations up to 43 plus seeded rows, applying 0044 yields: unmerged curator row 0.75 → 0.30; merged row
    1.9 → 1.0; row 0.5 → 0.05; `session_id IS NULL` unpinned 0.6 → 0.6; pinned 1.0 → 1.0; a pre-existing
    `archival` row gets a non-null `archived_at`; `recall` rows keep `archived_at NULL`;
  - `idx_memories_salience` and `idx_memories_tier` are absent; the three new indexes exist;
  - `memory_retention_state` has the nine new columns with the stated defaults;
  - bump the eight ratchet specs from 43 to 44.
- **Files**:
  - CREATE `libs/backend/persistence-sqlite/src/lib/migrations/0044_memory_lifecycle.ts`
  - CREATE `libs/backend/persistence-sqlite/src/lib/migrations/0044_memory_lifecycle.spec.ts`
  - MODIFY `libs/backend/persistence-sqlite/src/lib/migrations/index.ts`
  - MODIFY ratchets `0028_gateway_conversation_workspace_root.spec.ts`, `0030_skill_event_metrics.spec.ts`,
    `0038_gateway_message_turn_state.spec.ts`, `0039_reap_orphaned_queue_rows.spec.ts`,
    `0040_skill_candidate_workspace_root.spec.ts`, `0041_skill_md_migration_state.spec.ts`,
    `0042_db_integrity_check_state.spec.ts`, `0043_memory_retention.spec.ts`

### 2. Ranking-only salience (memory-curator)

- **Purpose**: one definition of ranking salience; stored salience is an immutable base.
- **Responsibilities**:
  - REWRITE `salience-scorer.ts` as `salience-ranking.ts` (pure module, no DI):
    - `SALIENCE_RANK_HALF_LIFE_MS = 604_800_000`, `SALIENCE_USE_WEIGHT = 0.3`, `SALIENCE_USE_SATURATION = 3`,
      `SALIENCE_PIN_BONUS = 1`.
    - `baseSalience(hint: number, boost = 0): number` — clamp `hint + boost` to `[0, 1]`; non-finite → 0.
    - `rankSalience(row: { salience; hits; pinned; lastUsedAt }, nowMs): number` — the JS mirror, used only by
      specs and any in-memory sort.
    - `salienceRankOrderBy(placeholder: '?' | '@rankNow'): string` — returns one of two literal strings
      `ORDER BY (m.salience * (604800000.0 / (604800000.0 + MAX(0, ? - m.last_used_at))) + 0.3 * m.hits / (m.hits + 3.0) + m.pinned) DESC, m.id DESC`
      (and the same text with `@rankNow`). The `m.id` tiebreak makes pagination stable.
  - `MemoryStore.list` (`memory.store.ts:325-358`): `FROM memories m`, named params, ranking by
    `salienceRankOrderBy('@rankNow')`, bind `rankNow: Date.now()`.
  - `MemoryStore.listAll` (`:364-412`): positional; `now` binds after the filter params and before `LIMIT ? OFFSET ?`.
  - `MemorySearchService.listIndexRowsByFilter` (`memory-search.service.ts:806-828`): positional, `now` before `LIMIT ?`.
  - `MemoryCuratorService` (`memory-curator.service.ts:653-688`): insert stores `baseSalience(r.salienceHint,
    input.salienceBoost)`; merge calls `appendChunks` only (no salience write). Remove the `SalienceScorer`
    injection (`:183-184`) and import (`:29`).
  - Delete `MemoryStore.updateSalience` (`memory.store.ts:524-540`), its spec (`memory.store.spec.ts:186`), the
    `MEMORY_SALIENCE_SCORER` token (`di/tokens.ts:16-17`), its registration (`di/register.ts:72-76`, header
    comment `:6`), the barrel exports `SalienceScorer` / `ScoreInputs` (`src/index.ts:52-53`); export the new
    module's functions instead.
  - `IMemoryLister.listAll` doc comment "sorted by salience" → "sorted by ranking salience"
    (`memory-contracts/src/lib/memory-reader.port.ts` is untouched; the comment lives at `memory.store.ts:360-363`).
- **Verified contracts**: `list` / `listAll` / `listIndexRowsByFilter` statements as cited; writer adapter already
  stores a base (`memory-writer.adapter.ts:83`).
- **Dependencies**: none new.
- **Integration points**: `memory:list` RPC, session-start roster, `ptah.memory.list`, `mem:searchIndex` without a
  query, curator related-memory lookup (`memory-curator.service.ts:606-611`).
- **Failure behaviour**: unchanged per call site (the statements already sit inside their callers' error handling).
- **Quality requirements**: ranked reads measured ≤ 46 ms on the snapshot shape (Sizing evidence).
- **Verification seam**:
  - `salience-ranking.spec.ts` on real SQLite: for a table of rows (fresh, 7 d, 30 d, 90 d unused; hits 0/3/50;
    pinned 0/1), the SQL expression value equals `rankSalience` within 1e-9; a recent low-base row outranks a 90-day
    high-base row; a pinned row outranks every unpinned row; both placeholder texts are identical apart from the
    placeholder; `baseSalience` clamps.
  - `memory-curator.service.spec.ts`: insert passes `baseSalience(hint, boost)`; merge issues no salience write;
    constructor no longer takes a scorer (update the seven scorer mocks at `:67,286,381,455,698,1324,1657`).
  - `memory.store.spec.ts`: `list`/`listAll` bind `now` and order by rank (real SQLite case).
  - `memory-search.service.spec.ts`: pure-filter listing orders by rank.
- **Files**:
  - CREATE `libs/backend/memory-curator/src/lib/salience-ranking.ts`, `salience-ranking.spec.ts`
  - DELETE `libs/backend/memory-curator/src/lib/salience-scorer.ts`
  - MODIFY `libs/backend/memory-curator/src/lib/memory.store.ts`, `memory.store.spec.ts`,
    `memory-search.service.ts`, `memory-search.service.spec.ts`, `memory-curator.service.ts`,
    `memory-curator.service.spec.ts`, `di/tokens.ts`, `di/register.ts`, `src/index.ts`
  - MODIFY `apps/ptah-extension-vscode/src/integration/wizard-seed-noop.spec.ts` (drop the two mocked tokens)

### 3. Explicit use recording (`IMemoryUsageRecorder`)

- **Purpose**: `last_used_at` changes only when a memory is used (AC3 definition), and a use restores archival rows.
- **Responsibilities**:
  - `memory-contracts`: add `memory-usage-recorder.port.ts` with
    `export interface IMemoryUsageRecorder { recordUse(memoryIds: readonly string[]): void; }` (contract: never
    throws; empty or unknown ids are a no-op). Add `MEMORY_CONTRACT_TOKENS.MEMORY_USAGE_RECORDER =
    Symbol.for('PtahMemoryUsageRecorder')`. Export from the barrel.
  - `MemoryStore implements IMemoryLister, IMemoryUsageRecorder`. REPLACE `recordHit` with `recordUse`:

    ```sql
    UPDATE memories
       SET hits = hits + 1,
           last_used_at = @now,
           tier = CASE WHEN tier = 'archival' THEN 'recall' ELSE tier END,
           archived_at = NULL
     WHERE id IN (SELECT value FROM json_each(@ids))
    RETURNING workspace_root, (tier = 'recall' AND archived_at IS NULL) AS restored
    ```

    - Dedupe ids in JS first (a hit list can repeat a memory); cap at 200 ids per call (the `getObservations` cap,
      `memory-search.service.ts:677`).
    - Catch `unknown`, log `warn` once per failure, never throw.
    - Bump the write counter for every returned `workspace_root` when the call restored at least one row, so
      cached searches and lists see the tier change.
    - Assumption check for `RETURNING`: SQLite ≥ 3.35 (bundled 3.53.1 per phase 1 evidence). If the executor
      prefers, split into a `SELECT workspace_root ... WHERE tier='archival'` before the UPDATE.
  - `insertMemoryWithChunks` (`memory.store.ts:174-207,216-225`): bind `archived_at = insert.tier === 'archival' ? now : null`.
  - `appendChunks` (`:573-575`): `UPDATE memories SET updated_at = ?, last_used_at = ?, tier = CASE WHEN tier = 'archival' THEN 'recall' ELSE tier END, archived_at = NULL WHERE id = ?`.
  - Register `MEMORY_CONTRACT_TOKENS.MEMORY_USAGE_RECORDER` with `useToken: MEMORY_TOKENS.MEMORY_STORE`
    (`di/register.ts:112-114` precedent for `MEMORY_LISTER`).
  - `MemorySearchService.searchRichInner`: delete `this.store.recordHit(memory.id)` (`:360`); slice the result to
    `limit` before building hits (`fused.slice(0, limit)` after the rerank block) so a no-reranker host returns
    `topK`, not `4 × topK` (`:309,341`).
  - Recording sites:
    - `agent-sdk` `MemoryPromptInjector`: inject `@inject(MEMORY_CONTRACT_TOKENS.MEMORY_USAGE_RECORDER,
      { isOptional: true }) usage: IMemoryUsageRecorder | null = null` (after `workspace`, before `corpus`; update
      the constructor call sites in specs). In `buildBlock`, after filtering by `MIN_SCORE` and before returning the
      block, call `usage?.recordUse(hits.map((h) => h.memoryId))` inside the existing try.
    - `vscode-lm-tools`: `ptah-api-builder.service.ts` injects the recorder optionally beside `memorySearch`
      (`:388-389`) and passes `getMemoryUsageRecorder` to `buildMemoryNamespace` (`:754-760`);
      `memory-namespace.builder.ts` `search` calls `getMemoryUsageRecorder()?.recordUse(result.hits.map((h) => h.memoryId))`
      after a successful `reader.search` (`:221`). `code` namespace and skill digest: no change.
    - `rpc-handlers`: `memory:get` calls `this.store.recordUse([params.id])` after a found memory
      (`memory-rpc.handlers.ts:245-252`); `mem:getObservations` calls `recordUse(r.memories.map((m) => m.id))`
      (`mem-rpc.handlers.ts:145-152`; inject `MEMORY_TOKENS.MEMORY_STORE` there if the class does not already hold
      the store — check its constructor).
- **Verified contracts**: port file and tokens as cited; optional injection precedents
  `memory-prompt-injector.ts:94-95`, `ptah-api-builder.service.ts:388-401`.
- **Dependencies**: `agent-sdk`, `vscode-lm-tools`, `rpc-handlers` → `memory-contracts` (existing edges);
  `rpc-handlers` → `memory-curator` (existing).
- **Integration points**: VS Code and hosts without memory resolve `null` for the optional token; the recorder
  call is skipped.
- **Failure behaviour**: `recordUse` never throws; prompt injection, MCP search and RPC results are unchanged when
  it fails.
- **Quality requirements**: one indexed UPDATE per call (measured 5.7 ms for 20 ids); on the prompt path at most
  `MAX_HITS` = 5 ids after the slice fix.
- **Verification seam**:
  - `memory.store.spec.ts` (real SQLite): `recordUse` increments hits once per distinct id, sets `last_used_at`,
    restores an archival row and nulls `archived_at`, leaves core/pinned tier unchanged, bumps the counter only
    when a row was restored, swallows a closed-connection error; `appendChunks` restores an archival target;
    insert with `tier: 'archival'` stamps `archived_at`.
  - `memory-search.service.spec.ts`: `searchRich` issues no UPDATE (assert no `recordHit`/`recordUse` call) and
    returns at most `topK` hits without a reranker.
  - `memory-prompt-injector.spec.ts`: `recordUse` receives exactly the injected ids; not called for 0 hits or a
    short query; a throwing recorder does not change the returned block; `buildSessionStartBlock` never calls it.
  - `memory-namespace.builder.spec.ts`: search records returned ids; `list` does not.
  - `memory-rpc.handlers.spec.ts` / `mem-rpc.handlers.spec.ts`: `memory:get` and `mem:getObservations` record;
    `memory:search`, `memory:list`, `mem:searchIndex`, `mem:timeline` do not.
- **Files**:
  - CREATE `libs/backend/memory-contracts/src/lib/memory-usage-recorder.port.ts`
  - MODIFY `libs/backend/memory-contracts/src/lib/tokens.ts`, `src/index.ts`, `CLAUDE.md`
  - MODIFY `libs/backend/memory-curator/src/lib/memory.store.ts`, `memory.store.spec.ts`,
    `memory-search.service.ts`, `memory-search.service.spec.ts`, `di/register.ts`
    (same files as Component 2 — same batch)
  - MODIFY `libs/backend/agent-sdk/src/lib/helpers/memory-prompt-injector.ts` and its spec
  - MODIFY `libs/backend/vscode-lm-tools/src/lib/code-execution/ptah-api-builder.service.ts`,
    `namespace-builders/memory-namespace.builder.ts` and their specs
  - MODIFY `libs/backend/rpc-handlers/src/lib/handlers/memory-rpc.handlers.ts`, `mem-rpc.handlers.ts` and their specs

### 4. `MemoryLifecycleStore` (memory-curator)

- **Purpose**: every SQL statement of the age lifecycle, the cap and the preview. No policy.
- **Responsibilities** (each batch method is ONE `BEGIN IMMEDIATE` … `COMMIT`, returns counts, no internal loop;
  statement cache by db identity and the transaction helper copied from `observation-retention.store.ts:313-330,568-619`):
  1. `canDelete(): { allowed: true } | { allowed: false; reason: 'vec-unavailable' }` —
     `allowed = vecStatus.available || !triggerExists('memory_chunks_vec_ad')` where the trigger read is
     `SELECT 1 FROM sqlite_master WHERE type = 'trigger' AND name = 'memory_chunks_vec_ad'`.
  2. `deleteArchivedBatch(cutoffMs, limit)` → `{ deleted, workspaceRoots }`:

     ```sql
     SELECT m.id, m.workspace_root FROM memories m INDEXED BY idx_memories_tier_archived
      WHERE m.tier = 'archival' AND m.archived_at < @cutoff AND m.pinned = 0
        AND NOT EXISTS (SELECT 1 FROM corpus_memories c WHERE c.memory_id = m.id)
      ORDER BY m.archived_at LIMIT @limit;
     ```

     then the shared delete pair (below) with the collected ids.
  3. `archiveBatch(cutoffMs, nowMs, limit)` → `{ archived, workspaceRoots }`:

     ```sql
     SELECT m.id, m.workspace_root FROM memories m INDEXED BY idx_memories_tier_last_used
      WHERE m.tier = 'recall' AND m.last_used_at < @cutoff AND m.pinned = 0
        AND NOT EXISTS (SELECT 1 FROM corpus_memories c WHERE c.memory_id = m.id)
      ORDER BY m.last_used_at LIMIT @limit;

     UPDATE memories SET tier = 'archival', archived_at = @now
      WHERE id IN (SELECT value FROM json_each(@ids)) AND tier = 'recall' AND pinned = 0;
     ```

     `updated_at` is not touched (`stats.lastCuratedAt` reads it).
  4. `overCapWorkspaces(cap)` → `readonly { workspaceRoot: string | null; evictable: number; recallEvictable: number }[]`:

     ```sql
     SELECT m.workspace_root AS workspace_root, COUNT(*) AS evictable,
            SUM(m.tier = 'recall') AS recall_evictable
       FROM memories m
      WHERE m.tier <> 'core' AND m.pinned = 0
        AND NOT EXISTS (SELECT 1 FROM corpus_memories c WHERE c.memory_id = m.id)
      GROUP BY m.workspace_root
     HAVING COUNT(*) > @cap;
     ```

     Read, no transaction.
  5. `evictBatch(workspaceRoot, tier: 'archival' | 'recall', graceCutoffMs, limit)` → `{ evicted }`:

     ```sql
     -- archival (grace applies)
     SELECT m.id FROM memories m INDEXED BY idx_memories_tier_last_used
      WHERE m.tier = 'archival' AND m.workspace_root IS @ws AND m.pinned = 0
        AND m.archived_at < @graceCutoff
        AND NOT EXISTS (SELECT 1 FROM corpus_memories c WHERE c.memory_id = m.id)
      ORDER BY m.last_used_at LIMIT @limit;
     -- recall (no grace)
     SELECT m.id FROM memories m INDEXED BY idx_memories_tier_last_used
      WHERE m.tier = 'recall' AND m.workspace_root IS @ws AND m.pinned = 0
        AND NOT EXISTS (SELECT 1 FROM corpus_memories c WHERE c.memory_id = m.id)
      ORDER BY m.last_used_at LIMIT @limit;
     ```

     Two literal statements selected by the `tier` argument; then the shared delete pair.
  6. Shared delete pair (inside the batch transaction, same ids, predicate repeated so the invariant is local to
     each statement):

     ```sql
     DELETE FROM memory_chunks
      WHERE memory_id IN (SELECT id FROM memories
                           WHERE id IN (SELECT value FROM json_each(@ids))
                             AND tier <> 'core' AND pinned = 0);
     DELETE FROM memories
      WHERE id IN (SELECT value FROM json_each(@ids)) AND tier <> 'core' AND pinned = 0;
     ```

     Chunk deletion fires `memory_chunks_ad` (FTS) and `memory_chunks_vec_ad` (vec); memory deletion fires
     `memories_concepts_ad`. Returns `changes` of the second statement.
  7. `readPreview(archiveCutoffMs, deleteCutoffMs, cap)` → `{ archiveEligible, deleteEligible, overCap }` — three
     separate statements (each index-bounded; the combined form measured 62 ms): the two counts use the same
     predicates and `INDEXED BY` as 2 and 3; `overCap = Σ max(0, evictable − cap)` from statement 4.
- **Verified contracts**: index names from Component 1; trigger names `0002_memory.ts:47-55`,
  `0019_memory_chunks_vec_cleanup.ts:15-19`, `0017_memory_schema_v2.ts:42-44`; `RetentionStepError` and the
  `database-busy` mapping `observation-retention.store.ts:568-605` (import the class; do not re-declare it).
- **Dependencies**: `PERSISTENCE_TOKENS.SQLITE_CONNECTION`, `PERSISTENCE_TOKENS.VEC_STATUS`, `TOKENS.LOGGER`.
  Token `MEMORY_TOKENS.MEMORY_LIFECYCLE_STORE = Symbol.for('PtahMemoryLifecycleStore')`, singleton.
- **Integration points**: used only by `MemoryLifecycleService`.
- **Failure behaviour**: a batch error rolls back that batch and throws `RetentionStepError` (`database-busy` for
  `SQLITE_BUSY`, `sql-error` otherwise). Reads never throw: `overCapWorkspaces` / `readPreview` return empty /
  `null` fields and push `"<read>: <message>"` into `readErrors`.
- **Quality requirements**: every SELECT above must show `SEARCH ... USING INDEX idx_memories_tier_last_used` or
  `idx_memories_tier_archived` (and `idx_corpus_mem_memory` for the subquery) in `EXPLAIN QUERY PLAN` on a DB
  without `sqlite_stat1`; no statement contains `UPDATE memories SET salience`.
- **Verification seam**: `memory-lifecycle.store.spec.ts` on real SQLite with vec loaded (Component 11 harness):
  plan assertions; each batch method's predicates (pinned, core, corpus member, grace, cutoff edges `<` not `<=`);
  the delete pair leaves 0 chunk, 0 FTS docsize, 0 vec rowid and 0 concepts rows for deleted ids and does not touch
  others; `canDelete` is false on a file reopened without vec while the trigger exists and true when the trigger is
  absent; a thrown statement rolls back both deletes of the batch.
- **Files**:
  - CREATE `libs/backend/memory-curator/src/lib/retention/memory-lifecycle.store.ts`
  - CREATE `libs/backend/memory-curator/src/lib/retention/memory-lifecycle.store.spec.ts`

### 5. `MemoryLifecycleService` + `RetentionRunBudget` + settings (memory-curator)

- **Purpose**: run the lifecycle step inside a retention run, within the run's budget, and produce the preview.
- **`RetentionRunBudget`** (`retention/retention-run-budget.ts`, plain class, constructed per run by
  `MemoryRetentionService.execute`, not in DI). It REPLACES the closures at `memory-retention.service.ts:319-339`:
  - `constructor(options: MemoryRetentionRunOptions, limits: MemoryRetentionLimits, now: () => number, startedAt: number, logger: Logger, initialQueueBatch: number, initialArchiveBatch: number)`
  - `hardStop(): RetentionStopReason | null` — abort, battery, foreground, `time-budget` (same order as today).
  - `queueRowRoom()`, `consumeQueueRows(n)`; `memoryRowRoom()`, `consumeMemoryRows(n)`.
  - `batchSize(kind: 'queue' | 'archive' | 'delete'): number`; `observe(kind, durationMs)` halves that kind's size
    above `slowCallMs`, floor `minBatchSize` (same rule as `adaptBatch`).
  - `yield(): Promise<void>` — `setImmediate`.
- **`MemoryLifecycleService`** (`retention/memory-lifecycle.service.ts`):
  - `runStep(budget: RetentionRunBudget, nowMs: number): Promise<MemoryLifecycleStepResult>` where
    `MemoryLifecycleStepResult = { archived; deleted; evicted; exhausted: boolean; stop: RetentionStopReason | null; note: MemoryLifecycleNote | null; preview: MemoryLifecyclePreview | null }`,
    `MemoryLifecycleNote = 'disabled' | 'vec-unavailable'`,
    `MemoryLifecyclePreview = { measuredAt; forRunAt; archiveEligible; deleteEligible; overCap }`.
  - Order (each loop: `hardStop()` → `memoryRowRoom()` (`memory-row-budget` when 0) → one store batch →
    `observe` → `consume` → `yield` while rows came back):
    1. Read settings. If `enabled === false`: skip 2-4, `note = 'disabled'`, `exhausted = true`.
    2. `canDelete()`. If not allowed: `note = 'vec-unavailable'`, skip 3 and 5 (one `warn` per run).
    3. Age delete: `deleteArchivedBatch(nowMs − deleteAfterDays·DAY_MS, batchSize('delete'))` until 0.
    4. Archive: `archiveBatch(nowMs − archiveAfterDays·DAY_MS, nowMs, batchSize('archive'))` until 0.
    5. Cap: for each row of `overCapWorkspaces(maxPerWorkspace)`: evict `archival` with
       `graceCutoff = nowMs − limits.capEvictionGraceMs` up to `evictable − cap`; then, if
       `recallEvictable > cap`, evict `recall` up to `recallEvictable − cap`. The excess is recomputed from the
       returned `evicted` counts, not re-queried per batch.
    6. Preview (always, including `disabled`, skipped only when a hard stop ended the step):
       `forRunAt = nowMs + limits.intervalMs`, cutoffs from `forRunAt`.
    7. `memoryStore.markWorkspacesChanged(roots)` for all roots returned by 3-5 (new public method on
       `MemoryStore` that calls the existing private `bumpWriteCounter` per root).
  - `exhausted` = every enabled loop ended on an empty batch. A `vec-unavailable` note does not make the step
    unexhausted: a missing extension must not make every hourly tick due.
  - `readSettings()` mirrors `MemoryRetentionService.readSettings` (`memory-retention.service.ts:645-654`).
- **Settings** (`retention/memory-lifecycle-config.ts`, same shape as `memory-retention-config.ts:22-50,114-165`):

  | Key | Default | Clamp | Why |
  | --- | --- | --- | --- |
  | `memory.lifecycle.enabled` | `true` | boolean | Kill switch; `false` = preview only (AC7) |
  | `memory.lifecycle.archiveAfterDays` | `30` | 7–365 | Verdict N=30 |
  | `memory.lifecycle.deleteAfterDays` | `60` | 7–730 | Verdict M=60; ≥ 7 keeps a real archival window |
  | `memory.lifecycle.maxPerWorkspace` | `25000` | 1,000–1,000,000 | AC4 rationale |

- **Limits** (added to `MemoryRetentionLimits` / `MEMORY_RETENTION_LIMITS`, `memory-retention-config.ts:84-112`):

  | Bound | Value | Why |
  | --- | --- | --- |
  | `maxMemoryRowsPerRun` | 25,000 (archive + delete + evict) | First run archives ~22–23k rows in one run (measured pass 2.35 s); separate from the queue's 50,000 so the 174k queue backlog cannot starve the lifecycle |
  | `memoryDeleteBatchSize` | 200 (initial `delete` size; halving floor `minBatchSize` 50) | 200-row deletes measured 53–66 ms; 500-row deletes reached 126 ms |
  | archive batch | `settings.batchSize` (500 default) | measured p50 50 ms, max 70 ms |
  | `capEvictionGraceMs` | 7 days | Rows archived this week are never cap-evicted; keeps AC2 on the first run |

- **Verified contracts**: `IWorkspaceProvider.getConfiguration` usage `memory-retention-config.ts:124-165`;
  limits token `di/tokens.ts` `MEMORY_RETENTION_LIMITS`.
- **Dependencies**: `TOKENS.LOGGER`, `PLATFORM_TOKENS.WORKSPACE_PROVIDER`, `MEMORY_TOKENS.MEMORY_LIFECYCLE_STORE`,
  `MEMORY_TOKENS.MEMORY_STORE`, `MEMORY_TOKENS.MEMORY_RETENTION_LIMITS` (5). Token
  `MEMORY_TOKENS.MEMORY_LIFECYCLE_SERVICE = Symbol.for('PtahMemoryLifecycleService')`, singleton.
- **Integration points**: called only by `MemoryRetentionService` (Component 6).
- **Failure behaviour**: store `RetentionStepError` propagates to the retention service's existing catch
  (`memory-retention.service.ts:426-435`): `database-busy` → `partial`, other → `failed`. Committed batches stay.
  Settings read failure → defaults + `warn`.
- **Quality requirements**: no synchronous call designed above 120 ms (per-kind halving); at most 25,000 memory rows
  per run; preview is three index-bounded reads once per run.
- **Verification seam**:
  - `retention-run-budget.spec.ts`: stop order, per-kind halving and floors, independent row budgets.
  - `memory-lifecycle.service.spec.ts` (fake store, fake clock): step order; disabled → no writes + preview;
    vec-unavailable → archive only + note + `exhausted` true; memory row budget → `stop = 'memory-row-budget'`,
    `exhausted` false; cap order archival-then-recall and the recall-alone rule; grace passed to the store;
    `markWorkspacesChanged` receives the union of roots; settings parity: each default equals
    `FILE_BASED_SETTINGS_DEFAULTS` (`file-settings-keys.ts`).
- **Files**:
  - CREATE `libs/backend/memory-curator/src/lib/retention/retention-run-budget.ts`, `retention-run-budget.spec.ts`
  - CREATE `libs/backend/memory-curator/src/lib/retention/memory-lifecycle.service.ts`, `memory-lifecycle.service.spec.ts`
  - CREATE `libs/backend/memory-curator/src/lib/retention/memory-lifecycle-config.ts`
  - MODIFY `libs/backend/memory-curator/src/lib/retention/memory-retention-config.ts` (limits), `memory.store.ts`
    (`markWorkspacesChanged`)

### 6. `MemoryRetentionService` integration (memory-curator)

- **Purpose**: run the lifecycle step in every retention run and record it.
- **Responsibilities**:
  - Inject `MEMORY_TOKENS.MEMORY_LIFECYCLE_SERVICE` (7 deps).
  - `execute`: build `RetentionRunBudget`; the purge and quarantine loops use it instead of the closures; after
    quarantine, when `stop === null || stop === 'row-budget'`, call `lifecycle.runStep(budget, startedAt)`; a
    returned `stop` sets the run's `stop` if still null. Ledger prune and reclaim keep their current condition
    (`memory-retention.service.ts:407-425`), so pages freed by memory deletes are reclaimed in the same run.
  - Outcome: `completed` additionally requires `lifecycle.exhausted`; otherwise `partial` with the lifecycle stop
    token (`memory-row-budget`, or the hard-stop token).
  - `RetentionStopReason` gains `'memory-row-budget'`.
  - `MemoryRetentionRunReport` gains `memoriesArchived`, `memoriesDeleted`, `memoriesEvicted`, `lifecycleNote`.
  - `ObservationRetentionStore`: `RetentionRunRecord` / `RetentionState` / `WRITE_RUN_SQL` / `READ_STATE_SQL` mapping
    gain the nine columns of migration 0044. Preview columns: `null` in the record keeps the previous value (same
    rule as `avg_processed_row_bytes`, `memory-retention.service.ts:616-621`).
  - `storageHealth()` adds the `memoryLifecycle` section (Component 8 DTO) from live settings + state; no memory
    table query on the poll.
- **Verified contracts**: as cited in Codebase evidence.
- **Failure behaviour**: unchanged contract — `run` never rejects; the flag clears in `finally`.
- **Verification seam**: `memory-retention.service.spec.ts` (fake collaborators): lifecycle called once per
  executed run with the budget; not called for any skip gate; called after a queue `row-budget` stop; not called
  after `time-budget`; `partial` when not exhausted; counters persisted; preview `null` keeps previous;
  `storageHealth().memoryLifecycle` shape. Update the two `new MemoryRetentionService(` sites.
- **Files**: MODIFY `retention/memory-retention.service.ts`, `memory-retention.service.spec.ts`,
  `memory-retention.types.ts`, `observation-retention.store.ts`, `observation-retention.store.spec.ts`.

### 7. Decay removal (memory-curator, shared, rpc-handlers)

- **Purpose**: leave no registered dead lifecycle code and no diagnostics field that can never change.
- **Responsibilities**:
  - DELETE `memory-decay.job.ts`, `memory-decay.job.spec.ts`; `MEMORY_DECAY_JOB` token (`di/tokens.ts:18-19`) and
    registration (`di/register.ts:132-136`, header `:9`); barrel export of `MemoryDecayJob` / `MemoryDecayStats`
    (`src/index.ts:85` and the class export).
  - `MemoryDiagnosticsService`: drop the decay injection and `lastDecayAt` / `lastDecayStats`
    (`diagnostics.service.ts:12,33-34,48,57-58`); `diagnostics.types.ts`: drop `MemoryDecayStats`, the two snapshot
    fields and `'decay-run'`.
  - `MemoryCuratorService.recordDecayEvent` (`memory-curator.service.ts:300-306`) and its spec cases
    (`memory-curator.service.spec.ts:152-160,183`) deleted.
  - `shared` `rpc-curator-diagnostics.types.ts`: remove `'decay-run'` (`:4`), `lastDecayAt`, `lastDecayStats`
    (`:173-176`).
  - `rpc-handlers` `memory-rpc.handlers.ts:532-541`: remove the mapping; spec fixtures `:117-118,633-634,683`.
- **Failure behaviour**: not applicable (deletion).
- **Verification seam**: typecheck of every project in the command set; `register.spec.ts` asserts
  `container.isRegistered(Symbol.for('PtahMemoryDecayJob')) === false`; grep for `MemoryDecayJob|lastDecay|decay-run`
  in `libs/` and `apps/` returns only historical `.ptah/specs` prose.
- **Files**: listed above plus `diagnostics.service.spec.ts`.

### 8. Settings keys and wire DTO (platform-core, shared)

- **Purpose**: persist the four lifecycle settings on every host; carry lifecycle numbers to diagnostics.
- **Responsibilities**:
  - `file-settings-keys.ts`: add the four `memory.lifecycle.*` keys to `FILE_BASED_SETTINGS_KEYS` (beside
    `:335-339`) and defaults `true / 30 / 60 / 25000` to `FILE_BASED_SETTINGS_DEFAULTS` (beside `:593-598`).
  - `rpc-curator-diagnostics.types.ts`:

    ```ts
    // MemoryRetentionRunDto gains:
    readonly memoriesArchived: number;
    readonly memoriesDeleted: number;
    readonly memoriesEvicted: number;

    export interface MemoryLifecyclePreviewDto {
      readonly measuredAt: number;
      readonly forRunAt: number;          // the next due run the counts were evaluated for
      readonly archiveEligible: number;
      readonly deleteEligible: number;
      readonly overCap: number;           // Σ max(0, evictable − cap), an upper bound before grace
    }

    // MemoryStorageHealthDto gains (required):
    readonly memoryLifecycle: {
      readonly enabled: boolean;
      readonly archiveAfterDays: number;
      readonly deleteAfterDays: number;
      readonly maxPerWorkspace: number;
      readonly lastNote: 'disabled' | 'vec-unavailable' | null;
      readonly preview: MemoryLifecyclePreviewDto | null;   // null until the first run
    };
    ```

  - No new RPC method → no change to `rpc.types.ts` method map or `ALLOWED_METHOD_PREFIXES`.
- **Verification seam**: `file-settings-keys.spec.ts` membership; settings parity assertion in Component 5; the
  rpc-handlers diagnostics spec passes `storage` through unchanged (`memory-rpc.handlers.ts:564`).
- **Files**: MODIFY `libs/backend/platform-core/src/file-settings-keys.ts`,
  `libs/shared/src/lib/types/rpc/rpc-curator-diagnostics.types.ts` (plus Component 7's removals in the same file).

### 9. Job summary and host reach (thoth-runtime, cli-engine, apps spec)

- **Purpose**: the one retention job reports lifecycle counts; both hosts are proven to reach the step.
- **Responsibilities**:
  - `memory-retention-job.ts:97`: summary becomes
    `purged <p> processed, quarantined <q> stuck, archived <a> / deleted <d> / evicted <e> memories, reclaimed <r> pages`.
    No change to id, name, handler name, cron expression, gating or failure channel.
  - Host reach tests (Component 11 items 1-2).
  - `apps/ptah-electron/src/integration/wizard-seed.integration.spec.ts:119-133`: add `archived_at INTEGER` to the
    hand-written `memories` DDL.
  - `thoth-runtime/CLAUDE.md`: the retention job bullet names the lifecycle step.
- **Files**: MODIFY `libs/backend/thoth-runtime/src/lib/memory-retention-job.ts`, `memory-retention-job.spec.ts`,
  `start-thoth-cron.spec.ts`, `CLAUDE.md`; `libs/backend/cli-engine/src/lib/bootstrap/thoth-runtime.spec.ts`;
  `apps/ptah-electron/src/integration/wizard-seed.integration.spec.ts`.

### 10. Storage panel rows and decay tile removal (memory-curator-ui)

- **Purpose**: show lifecycle results and the preview where retention is already shown; remove the dead tile.
- **Responsibilities**:
  - `storage-health-panel.component.ts`:
    - "Last retention run" list (`:214-223`): one row `Memories` → `archived <a> · deleted <d> · evicted <e>`
      (`formatCount`).
    - "Retention settings" list (`:245-252`): one row `Memory lifecycle` →
      `archive after <N> d · delete after <M> d · cap <cap>`, followed on the same `dd` by the preview
      `next run: <x> to archive · <y> to delete · up to <z> over cap`, or `preview after the first run` when
      `preview` is null, or `off (preview only)` when disabled, or `deletes paused: vector extension unavailable`
      for `vec-unavailable`. `data-testid="storage-memory-lifecycle"`.
  - `memory-diagnostics-accordion.component.ts`: delete the "Last decay sweep" tile (`:61-66`), `lastDecay`
    (`:226`), `lastDecayLabel` (`:242-243`).
  - `memory-diagnostics-state.service.ts`: delete `_lastDecay` / `lastDecay` / its `refresh` assignment (`:30,41,68-70`).
  - `event-feed.component.ts:159`: delete the `'decay-run'` case.
  - Spec fixtures: `memory-diagnostics-accordion.component.spec.ts:30,65,99,131`,
    `memory-curator-tab.component.spec.ts:20`, `memory-diagnostics-state.service.spec.ts:69-73,132`,
    `memory-diagnostics-rpc.service.spec.ts:64-65,102-103`, `storage-health-panel.component.spec.ts`.
- **Quality requirements**: OnPush unchanged; text, not colour, carries the note; no settings writes (read-only tab).
- **Verification seam**: panel spec renders the two rows for a populated DTO, `null` preview, `disabled`,
  `vec-unavailable`; accordion spec asserts `[data-testid="last-decay-run"]` is absent.
- **Files**: MODIFY the files above in `libs/frontend/memory-curator-ui/src/lib/`.

### 11. Reachability proof and integration specs (non-negotiable)

These fail when the lifecycle is built but not reached.

1. **Electron host** — `libs/backend/thoth-runtime/src/lib/start-thoth-cron.spec.ts`, inside
   `describe('memory retention job')`, new test `the registered handler runs the memory lifecycle step through a real MemoryRetentionService`:
   - Register under `MEMORY_TOKENS.MEMORY_RETENTION_SERVICE` a REAL `MemoryRetentionService` (import from
     `@ptah-extension/memory-curator`) built with: a fake `ObservationRetentionStore` (purge returns
     `{ deleted: 0, exhausted: true }`, quarantine 0, `readState` null), a fake reclaimer
     (`autoVacuumMode: 0`), `{ db: {} }` as the connection, a workspace provider returning defaults, limits
     `{ ...MEMORY_RETENTION_LIMITS, bootDeferralMs: 0 }`, and a spy lifecycle
     `{ runStep: jest.fn().mockResolvedValue({ archived: 4, deleted: 2, evicted: 1, exhausted: true, stop: null, note: null, preview: null }) }`.
   - `startThothCron`, take the `memory:retention` handler, invoke it with a fake ctx.
   - Assert `runStep` called once with a budget and a number, and the result summary contains
     `archived 4 / deleted 2 / evicted 1 memories`.
   - This fails if the handler is not registered, does not call `run`, or `run` does not call the step.
2. **CLI host** — `libs/backend/cli-engine/src/lib/bootstrap/thoth-runtime.spec.ts`, inside
   `describe('memory retention job (TASK_2026_440 reachability)')`, the same test through
   `activateThoth(container, 'runtime', logger)`; plus `oneshot` registers nothing (existing test stays).
3. **DI reach** — `libs/backend/memory-curator/src/lib/di/register.spec.ts`: after
   `registerMemoryCuratorServices`, `isRegistered` is true for `MEMORY_LIFECYCLE_SERVICE`, `MEMORY_LIFECYCLE_STORE`,
   `MEMORY_CONTRACT_TOKENS.MEMORY_USAGE_RECORDER`; false for `Symbol.for('PtahMemoryDecayJob')` and
   `Symbol.for('PtahMemorySalienceScorer')`; the resolved `MemoryRetentionService` singleton runs against the real
   test DB with the lifecycle schema and returns a run report containing `memoriesArchived` (proves the
   registered graph wires the step).
4. **Integration, real SQLite, vec loaded, fake clock** — extend
   `libs/backend/memory-curator/src/lib/retention/memory-retention.integration.spec.ts` with
   `describe('memory lifecycle — integration (real SQLite + sqlite-vec, fake clock)')`.
   - **Harness** (`retention-sqlite.test-support.ts`, extended, still test-only):
     - `openRetentionTestDb({ memorySchema: true, vec: true })`: opens with `allowExtension: true` under
       `node:sqlite` (or `loadExtension` under `better-sqlite3`), loads `require('sqlite-vec').getLoadablePath()`,
       applies `PRAGMA auto_vacuum = INCREMENTAL`, WAL, `foreign_keys = ON`, then the static SQL and `vecSql` of
       migrations 2, 7, 10, 15, 16, 17, 18, 19, 43, 44 in version order (a helper `migrationVecSql(version)`).
     - If vec cannot load, the call THROWS (the first test asserts it loads): no `it.skip`.
     - `reopenWithoutVec()` closes and reopens the same file without the extension.
     - `seedMemory(raw, { id, workspaceRoot, tier, pinned, lastUsedAt, archivedAt, sessionId, salience, chunks: n, concepts, token })`
       inserts the memory, its chunks (FTS rows via trigger), one vec row per chunk
       (`INSERT INTO memory_chunks_vec(rowid, embedding) VALUES (?, ?)` with a 384-float blob), and concepts rows.
     - Real `ObservationRetentionStore`, `SqlitePageReclaimer`, `MemoryStore` (fake embedder, real `VecStatusService`
       stand-in with `available` toggled), `MemoryLifecycleStore`, `MemoryLifecycleService`, `MemoryRetentionService`
       with `bootDeferralMs` past and gates open.
   - **Seed** (fixed `T0`, workspace A unless stated): R-old ×40 (recall, unused 31 d, 2 chunks each, unique token
     `alphaold<i>`); R-fresh ×10 (unused 29 d); P-old ×2 (recall pinned, unused 200 d); C-old ×2 (core pinned,
     unused 200 d); K-old ×2 (recall, unused 200 d, member of a corpus); W-B ×5 (workspace B, unused 31 d).
   - **Run 1 at T0**: `completed`; 45 archived (R-old + W-B); `archived_at = T0` on exactly those; R-fresh, P, C, K
     unchanged; 0 deleted; chunk / FTS docsize / vec rowid counts unchanged.
   - **Use at T0 + 10 d**: `store.recordUse([R-old[0].id])` → tier `recall`, `archived_at NULL`, hits 1.
   - **Run at T0 + 30 d** (due): 0 deleted (M not elapsed from archival even though `last_used_at` is 61 d old for
     39 rows) — **this is the AC2 assertion**.
   - **Run at T0 + 61 d**: 44 deleted; for each deleted id: 0 rows in `memories`, `memory_chunks`,
     `memory_chunks_fts_docsize` (by chunk rowid), `memory_chunks_vec_rowids` (by chunk rowid), `memory_concepts_fts`;
     FTS `MATCH 'alphaold1'` returns 0 rows; vec `MATCH` KNN for a deleted row's vector does not return its rowid;
     restored row, P, C, K, R-fresh (now archived at T0+30d) remain; `memoriesDeleted === 44`; `pagesReclaimed`
     reported; `storageHealth().memoryLifecycle.preview` not null.
   - **Cap test** (`maxPerWorkspace` via a fake workspace provider = 1,000 is the clamp floor, so seed 1,006
     evictable rows in A: 1,003 archival archived 8 d ago with ascending `last_used_at`, 3 archival archived 2 d
     ago, plus 20 in B): run evicts exactly the 6 oldest-`last_used_at` grace-eligible archival rows of A; the 3
     in-grace rows remain; B untouched; pinned and core never evicted. Second case: 1,010 recall evictable in A →
     10 oldest recall evicted.
   - **First-run back-to-back guard**: seed 30 recall rows unused 400 d; run at T; run again at T + 1 h with a
     forced backlog (`backlog_remaining = 1`): 30 archived in run 1, 0 deleted in both runs.
   - **Vec unavailable**: seed with vec, `reopenWithoutVec()`, `available = false`: run is `completed` with
     `lifecycleNote = 'vec-unavailable'`, archive happened, 0 deleted, no thrown `no such module: vec0`, next hourly
     run is `not-due`.
   - **Budget**: `maxMemoryRowsPerRun = 25`: run 1 `partial` / `memory-row-budget` with committed archives; run at
     +1 h due and finishes.
   - **Failure mid-delete**: wrap the lifecycle store so the second delete batch's memory DELETE throws after the
     chunk DELETE: report `failed`; batch 1 rows gone; batch 2 memories AND chunks still present (rollback); flag
     released.
   - **Disabled**: `memory.lifecycle.enabled = false`: 0 archived / deleted, `lifecycleNote = 'disabled'`, preview
     recorded with the counts the enabled run would have acted on.

## Integration architecture

- **Data flow (one retention run)**:
  1. Cron tick `17 * * * *` → `JobRunner` → `memory:retention` handler (both hosts,
     `memory-retention-job.ts:62-104`).
  2. `MemoryRetentionService.run` gates (unchanged) → `execute` builds `RetentionRunBudget`.
  3. Processed purge batches → stuck quarantine batches (unchanged SQL).
  4. **Memory lifecycle step**: `canDelete` → age delete batches (200) → archive batches (500) → cap evict batches
     (200) → preview reads → write-counter invalidation. Each batch is `BEGIN IMMEDIATE` … `COMMIT` + yield.
  5. Ledger prune → page reclaim + passive checkpoint (reclaims pages freed by queue AND memory deletes).
  6. `writeRun` with queue + memory counters + note + preview → report → job result summary (or thrown `failed`).
  7. Diagnostics: `memory:diagnostics` → `storageHealth()` (live settings + state row) → panel rows.
  8. Use path (outside runs): injection / MCP search / `memory:get` / `mem:getObservations` / merge →
     `recordUse` / `appendChunks` → `last_used_at`, hits, archival restore.
- **State and persistence**: `archived_at` on `memories` (owned by `MemoryStore` for insert/use, by
  `MemoryLifecycleStore` for archive); run counters and preview in `memory_retention_state` (owned by
  `ObservationRetentionStore`); per-run budget in memory only.
- **External boundaries**: settings clamped in `memory-lifecycle-config.ts`; id lists bound as JSON through
  `json_each`; workspace roots bound with `IS @ws`; no interpolated SQL beyond two literal `ORDER BY` texts
  chosen by a literal union.
- **Failure and rollback**: per-batch atomicity (chunks and memory deletes share one transaction); a failed batch
  rolls back and the run records `failed` with committed earlier batches kept; `database-busy` → `partial`;
  vec missing → deletes paused with a note, archive continues; budget exhausted → `partial` + backlog → next hourly
  tick; an interrupted process loses only the in-flight batch (the transaction never committed) and the next run
  recomputes cutoffs from data, so nothing needs a resume cursor.
- **Observability**: `job_runs` summary with memory counts; `memory_retention_state` counters, note and preview in
  the storage panel; `debug` per lifecycle batch with duration (A2 in the field); one `warn` per run for
  `vec-unavailable`; one `info` per run (existing) gains the memory counters.

## Architecture-level quality requirements

- **Functional**:
  - Unpinned, non-core, non-corpus `recall` rows with `last_used_at < now − archiveAfterDays` become `archival` with
    `archived_at = now`.
  - `archival` rows with `archived_at < now − deleteAfterDays` are deleted with their chunks, FTS rows, vec rows and
    concepts rows (source-defined concepts table).
  - No row is deleted by the age rule in the run that archived it or before `deleteAfterDays` after archival.
  - Per workspace, evictable rows above `maxPerWorkspace` are deleted archival-first (grace 7 d) then recall (only
    when recall alone exceeds the cap).
  - A recorded use restores an archival row to recall.
  - Stored salience is in `[0, 1]` and never rewritten after insert; ranked lists order by the ranking expression.
  - No `MemoryDecayJob`, no salience lifecycle rule, no decay diagnostics remain.
- **Performance**: no lifecycle work within 10 min of start, on battery or with foreground activity (inherited);
  ≤ 25,000 memory rows and the shared 60 s wall budget per run; no designed synchronous call above 120 ms;
  migration 0044 ≈ 0.33 s on the snapshot shape; diagnostics poll adds no memory-table query.
- **Security**: static migration SQL; bound parameters; no new user-controlled SQL text; persisted error text is
  already sanitized by the retention service.
- **Maintainability**: `memory-curator` imports no `cron-scheduler`, `skill-synthesis`, `agent-sdk` or
  `rpc-handlers`; `agent-sdk` and `vscode-lm-tools` depend only on the `memory-contracts` port; one job; no new RPC
  method; every new file owns one nameable concern.
- **Testability**: host reach specs fail without the step; real-SQLite + sqlite-vec integration proves rows leave
  all four tables through `MemoryRetentionService.run`; plan assertions prove index use without `sqlite_stat1`.

## Test plan — acceptance criteria to specs

| AC | Specs (named in the components) |
| --- | --- |
| AC1 age lifecycle, exemptions, no orphans | `memory-lifecycle.store.spec.ts` (predicates, delete pair); integration "Run 1", "Run at T0 + 61 d" |
| AC2 M counted from archival | `0044_memory_lifecycle.spec.ts` (archival backfill); integration "Run at T0 + 30 d" and "First-run back-to-back guard" |
| AC3 used / restore | `memory.store.spec.ts` (`recordUse`, `appendChunks`, insert stamp); `memory-search.service.spec.ts` (no write, topK slice); `memory-prompt-injector.spec.ts`; `memory-namespace.builder.spec.ts`; `memory-rpc.handlers.spec.ts`; `mem-rpc.handlers.spec.ts`; integration "Use at T0 + 10 d" |
| AC4 cap | `memory-lifecycle.service.spec.ts` (order, recall-alone rule, grace); integration "Cap test" |
| AC5 ranking-only salience | `salience-ranking.spec.ts` (SQL/JS parity, ordering); `0044_memory_lifecycle.spec.ts` (rebase); `memory-curator.service.spec.ts` (base at insert, no merge write) |
| AC6 scheduling, decay removal, diagnostics | `memory-retention.service.spec.ts`; `retention-run-budget.spec.ts`; `register.spec.ts` (decay token absent); `diagnostics.service.spec.ts`; `memory-rpc.handlers.spec.ts`; `memory-retention-job.spec.ts` (summary) |
| AC7 preview | `memory-lifecycle.service.spec.ts` (disabled → preview); integration "Disabled"; `storage-health-panel.component.spec.ts` |
| AC8 reachability | `start-thoth-cron.spec.ts` and `cli-engine thoth-runtime.spec.ts` real-service tests; `register.spec.ts`; `memory-retention.integration.spec.ts` lifecycle describe |
| AC9 timing | Component 12 (`memory-lifecycle.timing.local.spec.ts`, created, run, deleted, never committed) |

### 12. Timing verification (senior-tester, AC9)

- Follow `../TASK_2026_440_834c/test-report.md` Task 7.4 (`:252-292`) exactly: snapshot size+mtime before and after;
  fail-if-exists temp dir under `C:\Users\abdal\AppData\Local\Temp\`; every copy named `timing-copy-*`, deleted when
  its series ends; six production pragmas in production order; never `SqliteMigrationRunner`, never `PTAH_DB_PATH`
  under `~/.ptah`, never the live file.
- The snapshot is at migration **41**: apply the static SQL of 42, 43 and 44 in order; load vec from
  `require('sqlite-vec').getLoadablePath()`.
- Measure and report p50 / p95 / max:
  - M1 migration 0044 total duration (target ≤ 1 s).
  - M2 first run: real `MemoryRetentionService.run` with `bootDeferralMs: 0`, real clock → report, archive batch
    durations (≥ 40 batches), total memory lifecycle wall time.
  - M3 age delete: fake `now = run1 + 61 d` → ≥ 30 delete batches of 200 (target max ≤ 120 ms, p95 ≤ 100 ms);
    chunk/FTS docsize/vec rowid orphan counts 0 afterwards.
  - M4 cap eviction: `maxPerWorkspace = 5,000` on a fresh copy aged past grace → ≥ 30 evict batches.
  - M5 preview reads (3 statements) and ranked `list` / `listAll` on the post-run file.
  - M6 `recordUse` of 5 ids × 100 reps.
- Fixed rule: if M3 or M4 max exceeds 120 ms or p95 exceeds 100 ms, report the largest size in {200, 100, 50} that
  passes as `memoryDeleteBatchSize`; if M2 archive p95 exceeds 100 ms, report the largest of {500, 250, 100} that
  passes as the recommended `batchSize` floor for archive. The report does not edit source.
- Harness `libs/backend/memory-curator/src/lib/retention/memory-lifecycle.timing.local.spec.ts` is created, run
  with `npx jest --config libs/backend/memory-curator/jest.config.ts --testPathPatterns=memory-lifecycle.timing.local.spec.ts --runInBand`,
  then deleted; `git status --short -- libs/backend/memory-curator` empty afterwards.

## Risks

- **R1 — concepts FTS drift on real files.** The snapshot's `memory_concepts_fts` is `content=''` (contentless), not
  the source DDL (`0017_memory_schema_v2.ts:36-40`); `memory_id` reads NULL, so `memories_concepts_ad` deletes
  nothing and every deleted memory leaves its concept entries (113,662 entries today). No production reader queries
  the table (only insert and `rebuildConceptsIndex`, `memory.store.ts:232,676-684`). Out of scope for this phase; it
  does not affect AC1's chunk/FTS/vec tables. Recommend a follow-up task (rebuild the table to the source DDL, or
  delete the write-only index). The integration spec uses the source DDL, so it cannot see this drift.
- **R2 — cap deletes start at day 7, not day 60**, for workspaces above 25,000 evictable rows (`ptah-extension`:
  ~5.6k rows on the snapshot shape). This is the cap's purpose; Decision D1.
- **R3 — first run archives ~22–23k rows.** Archival is reversible (use restores) and search still returns archival
  rows, but ranked lists move them down. Decision D2.
- **R4 — vec unavailable pauses deletes** (a DELETE would throw `no such module: vec0`). The existing `memory:forget`
  RPC has the same failure today (`memory.store.ts:431-435`); not changed here.
- **R5 — migration boot cost ≈ 0.33 s** inside the migration transaction after the existing pre-migration backup.
- **R6 — unscoped `memory:list` loses its index**: 45.9 ms instead of 9.7 ms on 31k rows. It shrinks as the
  lifecycle deletes rows.
- **R7 — `better-sqlite3` numbers are unmeasured** (A2); phase 1 hit a 487 ms WAL-checkpoint outlier in one of 350
  purge batches. Halving does not fix a checkpoint stall.
- **R8 — use recording writes on the prompt path.** One indexed UPDATE (≤ ~6 ms) during session start on Electron's
  main thread; failures swallowed.
- **R9 — the wizard `key-files` seed** (recall, unpinned) archives after 30 days unless used; a reseed then inserts a
  new recall row because `findBySubjectAndTier(subject, 'recall')` does not see the archival copy
  (`memory-writer.adapter.ts:55`). The archival copy is deleted later. Harmless duplication, no data loss.
- **R10 — two hosts sharing the file**: unchanged from phase 1 (slot claim + `BEGIN IMMEDIATE`; busy → `partial`).

## Decisions for Gate 2

1. **D1 — defaults.** (Recommended) N=30, M=60, cap 25,000 evictable rows per workspace with a 7-day cap grace.
   Alternatives: cap 50,000 (no cap eviction on today's data; age rule only); cap 10,000 (~20k evicted from day 7).
2. **D2 — first run.** (Recommended) Ship `memory.lifecycle.enabled = true`: the first idle run archives
   ~22–23k rows and deletes nothing; the storage panel shows the preview for the next run. Alternative: ship
   `false` (preview only) until the user sets `memory.lifecycle.enabled: true` in `~/.ptah/settings.json`.
3. **D3 — what "used" means.** (Recommended) Injected hits, MCP `ptah.memory.search` hits, `memory:get`,
   `mem:getObservations`, curator merge. Not: session-start roster, UI search list, `mem:searchIndex`, skill-digest
   probes, corpus priming. Alternative: keep today's "any `searchRich` candidate" (inflated, loop-shaped).
4. **D4 — hit-based promotion.** (Recommended) Delete `recall → core` promotion (hits ≥ 10) and `core → recall`
   demotion with the decay job; tier `core` comes only from writers, pin is the user's keep. Alternative: keep
   promotion as a lifecycle exemption (58 rows qualify today; they would never archive).
5. **D5 — corpus members.** (Recommended) Exempt from archive, delete and cap (a delete cascades out of
   `corpus_memories` silently). Alternative: subject to the lifecycle. Today there are 0 corpus rows.
6. **D6 — decay diagnostics.** (Recommended) Delete `lastDecayAt` / `lastDecayStats`, `'decay-run'` and the "Last
   decay sweep" tile; lifecycle numbers live in the storage panel. Alternative: repurpose the tile for the lifecycle
   run (two places show the same run).

## Team-leader handoff

- **Recommended executors**:
  - Components 1, 2, 3 (backend parts), 4, 5, 6, 7 (backend), 8, 9, 11: `backend-developer` — SQL, DI, ports and
    specs on established patterns.
  - Component 10: `frontend-developer` — two template rows, deletions, fixtures.
  - Component 12 and final suite: `senior-tester`.
- **Complexity**: HIGH. Destructive SQL on user data, a boot-path migration that rewrites a column, a port change
  across four libs, and three reach seams that must stay in step.
- **Dependencies and ordering** (component level):
  - 1 before 2, 3, 4, 11 (schema and harness).
  - 8's DTO additions and settings keys and 3's port (memory-contracts only) before 5, 6 and the consumers of 3.
  - 2 and 3's `memory-curator` part share `memory.store.ts`, `memory-search.service.ts`, `di/register.ts` → one group.
  - 4, 5, 6, 7's `memory-curator` part after 2+3 (shared `di/*`, `memory.store.ts` `markWorkspacesChanged`).
  - 3's `agent-sdk` / `vscode-lm-tools` parts after the port; independent of `memory-curator` code.
  - 9 after 6.
  - 10 must land BEFORE 7's `shared` field removal (the frontend stops reading `lastDecay*` first), and after 8's
    additions.
  - 7's `shared` + `rpc-handlers` removal and 3's `rpc-handlers` recording share `memory-rpc.handlers.ts` → one group.
  - 12 last.
- **File-disjoint grouping hint** (team-leader owns final batches):
  1. persistence-sqlite: Component 1.
  2. contracts + settings + DTO additions: `memory-contracts` port/token/barrel/CLAUDE.md; `file-settings-keys.ts`;
     `rpc-curator-diagnostics.types.ts` ADDITIONS only. Parallel with group 1.
  3. memory-curator ranking + use: Components 2 and 3 (`memory-curator` files, wizard-seed-noop spec). After 1, 2.
  4. memory-curator lifecycle: Components 4, 5, 6, 7 (`memory-curator` files), 11 items 3-4 (harness, integration,
     register spec), `memory-curator/CLAUDE.md` (Public API, Internal Structure — drop `SalienceScorer` /
     `MemoryDecayJob` lines, add lifecycle entries, add a Guidelines bullet for the lifecycle invariants). After 3.
  5. agent-sdk + vscode-lm-tools recorder consumers (Component 3). After 2; parallel with 3 and 4.
  6. thoth-runtime + cli-engine + electron wizard spec: Component 9, 11 items 1-2. After 4.
  7. frontend: Component 10. After 2; before 8.
  8. rpc-handlers + shared removal: Component 3 (`memory:get`, `mem:getObservations`) and Component 7 (`shared`
     removal, handler mapping). After 4 and 7.
  9. verification: full suite + Component 12.
- **Parallel-safe work**: groups 1 and 2; group 5 with groups 3-4; group 6 with group 7.
- **Files affected**:
  - **CREATE**:
    - `libs/backend/persistence-sqlite/src/lib/migrations/0044_memory_lifecycle.ts`, `0044_memory_lifecycle.spec.ts`
    - `libs/backend/memory-contracts/src/lib/memory-usage-recorder.port.ts`
    - `libs/backend/memory-curator/src/lib/salience-ranking.ts`, `salience-ranking.spec.ts`
    - `libs/backend/memory-curator/src/lib/retention/memory-lifecycle.store.ts`, `memory-lifecycle.store.spec.ts`
    - `libs/backend/memory-curator/src/lib/retention/memory-lifecycle.service.ts`, `memory-lifecycle.service.spec.ts`
    - `libs/backend/memory-curator/src/lib/retention/memory-lifecycle-config.ts`
    - `libs/backend/memory-curator/src/lib/retention/retention-run-budget.ts`, `retention-run-budget.spec.ts`
  - **DELETE**:
    - `libs/backend/memory-curator/src/lib/memory-decay.job.ts`, `memory-decay.job.spec.ts`
    - `libs/backend/memory-curator/src/lib/salience-scorer.ts`
  - **MODIFY**:
    - persistence-sqlite: `migrations/index.ts`; eight ratchet specs (0028, 0030, 0038, 0039, 0040, 0041, 0042, 0043)
    - memory-contracts: `src/lib/tokens.ts`, `src/index.ts`, `CLAUDE.md`
    - memory-curator: `memory.store.ts`, `memory.store.spec.ts`, `memory-search.service.ts`,
      `memory-search.service.spec.ts`, `memory-curator.service.ts`, `memory-curator.service.spec.ts`,
      `diagnostics.service.ts`, `diagnostics.service.spec.ts`, `diagnostics.types.ts`, `di/tokens.ts`,
      `di/register.ts`, `di/register.spec.ts`, `src/index.ts`, `retention/memory-retention.service.ts`,
      `retention/memory-retention.service.spec.ts`, `retention/memory-retention.types.ts`,
      `retention/memory-retention-config.ts`, `retention/observation-retention.store.ts`,
      `retention/observation-retention.store.spec.ts`, `retention/memory-retention.integration.spec.ts`,
      `retention/retention-sqlite.test-support.ts`, `CLAUDE.md`
    - agent-sdk: `src/lib/helpers/memory-prompt-injector.ts` + spec
    - vscode-lm-tools: `src/lib/code-execution/ptah-api-builder.service.ts`,
      `namespace-builders/memory-namespace.builder.ts` + specs
    - rpc-handlers: `handlers/memory-rpc.handlers.ts`, `handlers/memory-rpc.handlers.spec.ts`,
      `handlers/mem-rpc.handlers.ts`, `handlers/mem-rpc.handlers.spec.ts`
    - platform-core: `src/file-settings-keys.ts`
    - shared: `src/lib/types/rpc/rpc-curator-diagnostics.types.ts`
    - thoth-runtime: `memory-retention-job.ts`, `memory-retention-job.spec.ts`, `start-thoth-cron.spec.ts`, `CLAUDE.md`
    - cli-engine: `src/lib/bootstrap/thoth-runtime.spec.ts`
    - memory-curator-ui: `components/diagnostics/storage-health-panel.component.ts` + spec,
      `memory-diagnostics-accordion.component.ts` + spec, `event-feed.component.ts`,
      `services/memory-diagnostics-state.service.ts` + spec, `services/memory-diagnostics-rpc.service.spec.ts`,
      `components/memory-curator-tab.component.spec.ts`
    - apps: `apps/ptah-extension-vscode/src/integration/wizard-seed-noop.spec.ts`,
      `apps/ptah-electron/src/integration/wizard-seed.integration.spec.ts`
  - **No change (verified)**: `start-thoth-cron.ts` and CLI `thoth-runtime.ts` production code (job registration
    unchanged); `libs/shared/src/lib/types/rpc.types.ts` and `vscode-core` `ALLOWED_METHOD_PREFIXES` (no new
    method); VS Code DI manifests (memory handlers expected absent); `memory-writer.adapter.ts` (already stores a
    base); `IMemoryReader` / `IMemoryLister` signatures.
- **Verification points**:
  - References to confirm while implementing: `observation-retention.store.ts:568-619` (transaction helper,
    `RetentionStepError`); `memory-retention.service.ts:319-339,407-435` (closures being replaced, step condition,
    catch); `0019_memory_chunks_vec_cleanup.ts:15-19` (trigger name); `mem-rpc.handlers.ts` constructor (store
    injection for `recordUse`).
  - Invariants: no statement writes `salience` after insert; no statement sets `tier = 'archival'` outside insert and
    `MemoryLifecycleStore.archiveBatch`; every memory DELETE runs inside a batch transaction together with its chunk
    DELETE; no delete while `canDelete()` is false; `memory-curator` imports no `cron-scheduler` / `skill-synthesis`.
  - Data changes: migration 0044 (DDL + two rebase UPDATEs + archival backfill).
  - Commands (use `run-many`; check the "N projects" header equals 11):
    - `npx nx run-many -t test -p @ptah-extension/persistence-sqlite @ptah-extension/memory-contracts @ptah-extension/memory-curator @ptah-extension/agent-sdk @ptah-extension/vscode-lm-tools @ptah-extension/rpc-handlers @ptah-extension/platform-core @ptah-extension/shared @ptah-extension/thoth-runtime @ptah-extension/cli-engine @ptah-extension/memory-curator-ui`
    - same set with `-t typecheck` and `-t lint`
    - app specs: `npx nx run-many -t test -p ptah-electron ptah-extension-vscode` (confirm the project names in each
      `project.json`; the header must say 2 projects)
    - grep: `MemoryDecayJob|SalienceScorer|recordHit|updateSalience|lastDecay|decay-run` in `libs/` and `apps/` → no
      matches.
