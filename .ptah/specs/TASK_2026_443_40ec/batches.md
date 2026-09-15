# Batches - TASK_2026_443_40ec

Total tasks: 25 | Batches: 10 | Complete: 3/10

Worktree: `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle` (branch
`feat/task-439-phase2-memory-lifecycle`, base 5e34e39cc). Below, `W` means that absolute path; every lane prompt
must expand it to the full absolute path. Requirements source: `../TASK_2026_439_1310/tribunal/verdict.md`
section A + `context.md` (no task-description.md). Plan: `implementation-plan.md` (Gate 2 APPROVED 2026-09-15,
recommended option of D1-D6).

## Execution order and parallelism

```
Wave 1:  Batch 1 (persistence-sqlite: migration 0044)   ||  Batch 2 (memory-contracts port + platform-core settings keys)
Wave 2:  Batch 3 (memory-curator: ranking + explicit use)  needs 1, 2   ||  Batch 4 (agent-sdk + vscode-lm-tools recorder consumers)  needs 2
Wave 3:  Batch 5 (memory-curator: lifecycle store, budget, service, config, DI, harness)   needs 3
Wave 4:  Batch 6 (retention integration + shared DTO + REACHABILITY: DI reach + real-SQLite integration)   needs 5 (and 4 committed)
Wave 5:  Batch 7 (REACHABILITY: Electron + CLI hosts, job summary)   ||   Batch 8 (frontend storage rows + decay UI removal)   needs 6
Wave 6:  Batch 9 (decay removal: memory-curator + shared + rpc-handlers; rpc-handlers use recording)   needs 7, 8
Wave 7:  Batch 10 (CLAUDE.md drift fix -> full verification -> AC9 timing on a temp copy)   needs 9
```

- Max lanes in flight: 2 (waves 1, 2, 5), under the cap of 3.
- No batch edits a `project.json`. Batch 5 edits `libs/backend/memory-curator/tsconfig.lib.json` (not the project
  graph), so no `npx nx reset` is needed anywhere. Do NOT run `nx reset` in this worktree at all.
- Commit per batch after an accepting review, with only that batch's files. Never skip hooks. Never push, merge
  or commit to main.

## Defaults chosen by team-leader (orchestrator said: use judgment within the Gate 0.1 roster)

- Implementation executor: codex CLI lane (`{ cli: 'codex', role: 'backend-developer' }`, or
  `role: 'frontend-developer'` for Batch 8). Fallback: the matching subagent.
- Reviewer for every batch: Ollama Cloud ptah-cli lane
  (`{ ptahCliId: 'pc-85830910-3d81-4248-84c1-4fa52752dd19', modelTier: 'opus', role: 'code-logic-reviewer' }`),
  deliverable `code-logic-review-batch-N.md` in the task folder. Fallback: code-logic-reviewer subagent. The
  reviewer is never the codex (GPT) family.
- Every executor writes `batch-N-report.md` into the task folder: per task, files changed (absolute), the three
  command outputs with their "Running target ... for N projects" header lines, and how each listed risk was handled.
  Executors never edit `batches.md` and never commit.
- Timing (Task 10.3) and the full verification run (Task 10.2): senior-tester subagent, not a codex lane.
  Reasons: (1) the temp-copy procedure has hard safety rules (never open the live DB or the snapshot with SQLite;
  size/mtime proofs; non-`ptah` names) and phase 1's first timing run was invalid because the harness skipped the
  production pragmas (`../TASK_2026_440_834c/batches.md` Task 7.2 result), so this needs the executor that already
  carries that procedure; (2) the copy lives under `C:\Users\abdal\AppData\Local\Temp` and reads
  `C:\Users\abdal\.ptah\state`, outside the worktree, which a sandboxed CLI lane may not be allowed to touch or may
  touch without the supervision the rule needs. Fallback for 10.2 only: a codex lane (no out-of-worktree access).
  10.3 has no lane fallback: if the senior-tester fails, return to the orchestrator.

## Deviations from the architect's grouping hint (with evidence)

1. **The required DTO fields move out of the contracts batch into Batch 6, together with their producer.**
   Evidence: the only producer of `MemoryStorageHealthDto` / `MemoryRetentionRunDto` is
   `memory-curator/src/lib/retention/memory-retention.service.ts:199,656`. Adding required `memoryLifecycle` /
   `memoriesArchived|Deleted|Evicted` in hint group 2 would leave `@ptah-extension/memory-curator` red until group
   4 (same trap as phase 1 Deviation 1). Batch 2 therefore touches no `libs/shared` file at all.
2. **Batch 6 also patches two typed frontend spec fixtures** so `@ptah-extension/memory-curator-ui` tests stay
   green from that commit: `storage-health-panel.component.spec.ts:12-13` (factory typed `MemoryStorageHealthDto`)
   and `memory-diagnostics-accordion.component.spec.ts:45,144` (`signal<MemoryStorageHealthDto | null>` + literal).
   Fixture fields only; Batch 8 owns every behavioural frontend change. rpc-handlers diagnostics fixtures
   (`memory-rpc.handlers.spec.ts:113-140,605`) are untyped `jest.fn().mockResolvedValue` literals and need nothing.
3. **Component 7 (decay removal) is ONE batch (9), all four libs together, after the frontend batch.** Evidence:
   `memory-rpc.handlers.ts:532-541` reads `snapshot.lastDecayAt` / `lastDecayStats` from memory-curator's
   `MemoryDiagnosticsSnapshot`, and returns an object literal typed `MemoryDiagnosticsResult` (excess-property
   check). Removing the fields in memory-curator (hint group 4) breaks rpc-handlers until hint group 8; removing
   them in shared breaks the handler literal and `memory-diagnostics-state.service.ts`. So the memory-curator
   decay deletion, diagnostics fields, shared fields and handler mapping land in one commit, after Batch 8 stops
   the frontend from reading them.
4. **`apps/ptah-electron/src/integration/wizard-seed.integration.spec.ts` (`archived_at` in the hand-written DDL)
   moves from Component 9 to Batch 3.** Batch 3 makes `insertMemoryWithChunks` bind `archived_at`; that spec
   (`:119-133`) would fail from the Batch 3 commit onward otherwise.
5. **`apps/ptah-extension-vscode/src/integration/wizard-seed-noop.spec.ts` moves to Batch 9.** It mocks both tokens
   by `Symbol.for(...)` literals (`:41-42`), not by import, so Batch 3 does not break it; one edit when the decay
   token also goes.
6. **Hint group 4 is split into Batch 5 (new collaborators, DI-registered but not yet called) and Batch 6
   (retention-service integration + the reachability proofs).** Group 4 was ~25 files across two concerns; the
   split keeps each batch one sitting and gives the reachability proofs a batch of their own to be judged on.
7. **`register.spec.ts` DI assertions are spread over the batch that creates or deletes each token**: recorder
   registered + scorer absent (Batch 3), lifecycle store/service registered (Batch 5), resolved retention service
   run carries `memoriesArchived` (Batch 6), decay job absent (Batch 9).
8. **`libs/backend/memory-curator/tsconfig.lib.json` gains `"src/**/*.test-support.ts"` in `exclude` (Batch 5).**
   Evidence: the lib typecheck compiles `src/**/*.ts` excluding only `*.spec.ts` / `*.test.ts`; Batch 5 extends
   `retention/retention-sqlite.test-support.ts` with `node:sqlite` extension loading and `sqlite-vec`. When Batch 5
   commits, backlog TASK_2026_446_198a can close.

## Plan validation

Status: PASSED WITH RISKS

Verified on disk (2026-09-15, this worktree, HEAD 5e34e39cc):

- Highest migration 43; the eight ratchet specs assert `toBe(43)` at exactly the plan's lines (0028:78, 0030:33,
  0038:86, 0039:60, 0040:73, 0041:57, 0042:65, 0043:48).
- Removed-symbol footprint (`MemoryDecayJob|SalienceScorer|MEMORY_SALIENCE_SCORER|recordHit|updateSalience|lastDecay|decay-run`):
  only memory-curator, rpc-handlers (handler + spec), shared (`rpc-curator-diagnostics.types.ts`),
  memory-curator-ui (tile, state, event feed, four specs) and `wizard-seed-noop.spec.ts`. No TUI or cli-engine
  consumer. Matches the plan.
- memory-curator's `MemoryCuratorEventKind` is its own union (`diagnostics.types.ts:5-8`), not shared's; removing
  `'decay-run'` there first is type-safe, removing it in shared first is not (Deviation 3).
- Writer adapter always stores `sessionId: null` and raw salience 0.6/1.0 (`memory-writer.adapter.ts:77,83`): the
  migration rebase predicate `session_id IS NOT NULL` does not hit writer rows.
- `MemoryRetentionLimits.intervalMs` exists (`memory-retention-config.ts:94`) for the preview `forRunAt`;
  `RetentionStopReason` has `'row-budget'` (`memory-retention.types.ts:30-35`).
- `MEMORY_LISTER` registered with `useToken` at `di/register.ts:112` (recorder precedent).
- `MemRpcHandlers` holds only logger, rpcHandler and `MEMORY_TOKENS.MEMORY_SEARCH` (`mem-rpc.handlers.ts:42-46`): it
  must gain an injection for recording (Task 9.2). `MemoryRpcHandlers` already holds `store` (`:132`).
- `MemoryPromptInjector` constructor: logger, reader, lister, workspace, optional corpus (`:87-95`); single `new`
  site in its spec. `new MemoryRetentionService(` sites: service spec + integration spec only.
- Reach spec describes exist: `start-thoth-cron.spec.ts:787` `describe('memory retention job')`,
  `cli-engine thoth-runtime.spec.ts:456` `describe('memory retention job (TASK_2026_440 reachability)')`.
- Typecheck targets use `tsconfig.lib.json` (specs excluded); typed spec fixtures therefore fail under Jest, not
  under `typecheck` (Deviation 2 exists for that reason).
- Project names confirmed in each `project.json`: `@ptah-extension/persistence-sqlite`, `memory-contracts`,
  `memory-curator`, `agent-sdk`, `vscode-lm-tools`, `rpc-handlers`, `platform-core`, `shared`, `thoth-runtime`,
  `cli-engine`, `memory-curator-ui` (all `@ptah-extension/` prefixed), and apps `ptah-electron`,
  `ptah-extension-vscode`.
- The worktree has no `node_modules`; Node resolution walks up to `D:\projects\ptah-extension\node_modules`, which
  holds `sqlite-vec` and `sqlite-vec-windows-x64` (0.1.6). Phase 1 ran the same way.
- File sizes: `memory-retention.service.ts` 693 lines (Batch 6 must stay near the 700 soft ceiling by moving the
  closures out, not by growing); `memory-search.service.ts` 957, `memory-curator.service.ts` 1046 (both shrink).

Cross-batch rule XB1 (added 2026-09-15 from PR #513 CI, binding for Batches 3-10):

- On Linux CI `better-sqlite3` loads (Node ABI) and throws `TypeError: Missing named parameters` when a statement with
  `@name` params is prepared/run (or wrapped in `EXPLAIN QUERY PLAN`) without binding every one of them
  (`observation-retention.store.spec.ts:83`). Locally the opener falls back to `node:sqlite`, which tolerates it, so
  local runs stay green. Every phase 2 spec that prepares SQL MUST bind every parameter (named and positional) so it
  passes under BOTH bindings; plan-assertion helpers must pass a full bind object. Reviewers reject a spec that
  prepares an unbound `@name` / `?` statement. The phase 1 fix lands on `feat/task-440-memory-retention`; phase 2
  rebases onto it later.
- Local better-sqlite3 run (mandatory verification for every batch with real-SQLite specs: 3, 5, 6, 7, 10; run from
  `W` in PowerShell, parent `node_modules` because the worktree has none):
  `$env:ELECTRON_RUN_AS_NODE='1'; & 'D:\projects\ptah-extension\node_modules\.bin\electron.cmd' 'D:\projects\ptah-extension\node_modules\jest\bin\jest.js' --config <lib>/jest.config.ts --testPathPatterns <pattern> --runInBand`
  Report its Tests line next to the node:sqlite run. A spec whose opener tries better-sqlite3 first then runs on
  better-sqlite3 there.
- Batch 1 check: `0044_memory_lifecycle.spec.ts` has no named parameters; its one parameterised statement (seed
  INSERT) binds all six positional values; the rest is `exec` / `PRAGMA` without params. No hazard.

Assumptions:

- A1 (`require('sqlite-vec').getLoadablePath()` + `node:sqlite` `allowExtension` load in Jest) — verified locally by
  the architect only; checked by the first test of the Batch 5 store spec and the Batch 6 integration describe,
  which THROW (never skip) when vec cannot load.
- A2 (200-row delete max <= 120 ms, 500-row archive p95 <= 100 ms under the production binding) — unverified;
  Task 10.3 measures under `node:sqlite` with production pragmas; the `better-sqlite3` binding stays a field
  residual (phase 1 R-TL9 shape).
- A3 (ranked statements bind `now` in their existing parameter style) — checked by `salience-ranking.spec.ts` and
  the real-SQLite `memory.store.spec.ts` cases in Task 3.1.
- A4 (no writer other than insert and `MemoryLifecycleStore.archiveBatch` sets `tier = 'archival'`) — checked by the
  grep in Task 10.2 and by every reviewer from Batch 5 on.
- A5 (added by team-leader) — the snapshot `C:\Users\abdal\.ptah\state\ptah.pre-migration-20260909T230600Z.sqlite`
  keeps 1,178,537,984 bytes / mtime 2026-09-10 02:06:09 until Task 10.3 copies it; 10.3 records both before and
  after.

| Risk | Severity | Mitigation |
| --- | --- | --- |
| R-TL1 Plan's `recordUse` SQL cannot tell a restore from a plain use: `RETURNING` yields POST-update values, so `(tier = 'recall' AND archived_at IS NULL)` is true for every recall row, the write counter would bump on every prompt injection (cache thrash), and the plan's own spec "bumps the counter only when a row was restored" would fail | HIGH | Task 3.2 MUST use the plan's alternative: inside one transaction, `SELECT DISTINCT workspace_root FROM memories WHERE id IN (SELECT value FROM json_each(@ids)) AND tier = 'archival'`, then the UPDATE (no `RETURNING`); bump only the selected roots. Spec pins both cases |
| R-TL2 Required DTO fields break memory-curator build / memory-curator-ui Jest between commits | HIGH | Deviations 1 and 2: fields + producer + typed fixtures in Batch 6 |
| R-TL3 Decay field removal breaks rpc-handlers or the frontend between commits | HIGH | Deviation 3: one Batch 9 after Batch 8 |
| R-TL4 Electron wizard-seed integration spec fails once `insertMemoryWithChunks` binds `archived_at` | MEDIUM | Deviation 4: DDL column added in Task 3.3 |
| R-TL5 Timing touches the live DB or the snapshot, runs `SqliteMigrationRunner`/`BackupService` near the copy, or measures without production pragmas | HIGH | Task 10.3 procedure (copy only, non-`ptah` names, six pragmas read back, no runner, size/mtime proof, temp dir deleted) |
| R-TL6 Parallel batches share one worktree; one lane's in-flight edits transiently fail the other's run (e.g. Batch 4 tests compile while Batch 3 edits memory-curator) | LOW | Team-leader re-runs each parallel batch's commands after both return, before commit |
| R-TL7 Timing harness `memory-lifecycle.timing.local.spec.ts` gets swept into a Jest run or a commit | MEDIUM | 10.2 runs BEFORE 10.3 creates it; 10.3 deletes it and proves `git status --short -- libs/backend/memory-curator` is empty |
| R-TL8 Pre-existing load flakes: platform-core `file-settings-manager.bench.spec.ts`, memory-curator `boot-scan-runner.spec.ts` abort test (phase 1 R-TL7/R-TL10) | LOW | On failure re-run the same `run-many` with `--parallel=1`; record both runs |
| R-TL9 `retention-sqlite.test-support.ts` with vec loading breaks the lib typecheck | MEDIUM | Deviation 8: `*.test-support.ts` exclude in Task 5.1 |
| R-TL10 `memory-retention.service.ts` passes 700 lines after integration | LOW | Task 6.1 replaces the closures with `RetentionRunBudget` (net shrink expected); reviewer checks line count |
| R1 `memory_concepts_fts` contentless drift on real files leaves concept entries after deletes | MEDIUM | Out of scope (filed follow-up); integration uses source DDL; noted in memory-curator/CLAUDE.md (Task 10.1) |
| R2 Cap deletes start day 7 for workspaces above 25,000 evictable rows | MEDIUM | Decision D1; Task 5.3 grace spec + Task 6.4 cap case |
| R3 First run archives ~22-23k rows | MEDIUM | Decision D2; reversible via use (Task 3.2); preview shown (Task 8.1) |
| R4 Vec unavailable -> a DELETE would throw `no such module: vec0` | HIGH | `canDelete()` gate (Task 5.2) + integration "Vec unavailable" case (Task 6.4) |
| R5 Migration boot cost ~0.33 s | LOW | Task 10.3 M1 target <= 1 s |
| R6 Unscoped `memory:list` loses its index (9.7 -> 45.9 ms) | LOW | Accepted; Task 10.3 M5 re-measures |
| R7 `better-sqlite3` numbers unmeasured | MEDIUM | Per-kind halving (Task 5.1); field residual in Mode 3 summary |
| R8 Use recording writes on the prompt path | LOW | One indexed UPDATE, never throws (Task 3.2); Task 10.3 M6 |
| R9 Wizard `key-files` seed duplicates after archival | LOW | Accepted (plan); no task |
| R10 Two hosts share the file | LOW | Inherited slot claim + `BEGIN IMMEDIATE`; busy -> `partial` (Task 5.2 error mapping) |

Edge cases:

- Cutoff edges use `<`, not `<=` — Task 5.2 spec.
- A memory used after archival and before deletion is restored and not deleted — Tasks 3.2, 6.4 ("Use at T0+10 d").
- M counted from `archived_at`, never from `last_used_at` (back-to-back runs) — Tasks 1.1 (backfill), 6.4.
- Pinned, `core`, corpus members never archived, deleted or evicted — Tasks 5.2, 6.4.
- `workspace_root` NULL and `''` are separate cap groups (`IS @ws`) — Task 5.2.
- Rows archived in this run are never cap-evicted in this run (7 d grace) — Tasks 5.3, 6.4.
- Vec not loaded but vec trigger present — deletes paused, archive continues, run not due-looping — Tasks 5.2, 5.3, 6.4.
- Memory row budget exhausted — `partial` / `memory-row-budget`, backlog, next hourly tick due — Tasks 5.3, 6.1, 6.4.
- Mid-batch failure — both deletes of the batch roll back; earlier batches kept; flag released — Tasks 5.2, 6.4.
- `memory.lifecycle.enabled = false` — no writes, preview still recorded — Tasks 5.3, 6.4, 8.1.
- Duplicate / unknown / empty ids and > 200 ids to `recordUse`; closed connection — Task 3.2.
- Cached search hit records nothing, and a no-reranker host returns `topK`, not `4 × topK` — Task 3.2.
- Hosts without memory (VS Code) resolve the optional recorder to `null` — Tasks 4.1, 4.2.
- `preview: null` in a run record keeps the previous preview — Task 6.1.
- Settings out of range (N < 7, cap < 1,000, non-number) clamp — Task 5.3.

---

## Batch 1: persistence-sqlite — migration 0044 — COMPLETE (commit 87cda19ef)

- 2026-09-15 Mode 2: files verified on disk (SQL matches plan :241-271 verbatim; registry entry 44; 8 ratchets = 44).
  Team-leader re-run: test 1 project, 30 suites passed / 9 skipped (pre-existing better-sqlite3 Electron ABI
  suites); `0044_memory_lifecycle.spec.ts` alone 6 passed, 0 skipped (node:sqlite fallback; binding test fails,
  never skips); typecheck + lint 1 project green.
- Review (Ollama Cloud, `code-logic-review-batch-1.md`): APPROVED 8/10, 0 blocking/serious, 2 moderate, 3 minor.
  Batch stays uncommitted until the fix revision below returns (orchestrator decision: test/comment-only, no second
  review round unless the diff touches shipped SQL in `0044_memory_lifecycle.ts`).
- Q5 (plan-level: the -0.45 rebase is not tier-filtered) — ACCEPTED, team-leader confirms with evidence:
  production `tier: 'core'` writers are only the wizard seeds through the writer adapter
  (`setup-rpc.handlers.ts:965,976`), which stores `sessionId: null` (`memory-writer.adapter.ts:77`), so they are only
  clamped; the curator inserts `input.tier ?? 'recall'` (`memory-curator.service.ts:518`) and no production caller
  passes another tier; the only promoter to `core`/`archival` was the never-scheduled `MemoryDecayJob`, deleted by D4,
  and the snapshot has 2 core rows (pinned, session NULL) and 0 archival rows. No core or archival row with a
  session_id exists or can appear.

- Task-spec docs committed separately: 3be25c0ec (`docs(task-specs)`), before the Batch 2 code commit.

### Batch 1 revision 1 fix list (resume codex lane 01a0a5e8-5146-75d2-bb77-b2bb1f4c7785) — COMPLETE (in 87cda19ef)

- Result (`batch-1-report.md` `## Revision 1`): items 1-5 applied; mutation check detected the deleted clamp UPDATE
  (expected 1, received 1.7), restored. Team-leader re-run: `0044_memory_lifecycle.ts` SQL still identical to plan
  :242-271 (text diff); persistence-sqlite test 1 project 30 passed / 9 skipped (pre-existing), typecheck + lint
  green; 0044 spec 6/6 under node:sqlite AND 6/6 under better-sqlite3 (Electron as Node). No second review (spec and
  comment files only). Committed with only the 11 persistence-sqlite files.

Scope: test and comment files only; `0044_memory_lifecycle.ts` and `index.ts` must NOT change (if they do, a second
review round is required).

1. M1 — `0044_memory_lifecycle.spec.ts`: exercise the clamp UPDATE (`0044_memory_lifecycle.ts:27-29`) with
   out-of-range input: seed a pinned row with salience 1.7 and a `session_id IS NULL` unpinned row with salience -0.2
   (and one > 1, e.g. 1.3), assert 1.0 / 0.0 / 1.0 after 0044. Mutation check (report, not committed): delete that
   UPDATE locally, the new assertion FAILS; restore.
2. M2 — spec:206: pin the `archived_at` backfill scale: record `before = Date.now()` floored to the second before
   `exec`, `after = Date.now()` after; assert `archived_at` is an integer, `% 1000 === 0`, and
   `floor(before/1000)*1000 <= archived_at <= after`.
3. m3 — assert the seeded archival row's salience after 0044 (session NULL, 0.6 -> 0.6) and that its tier stays
   `archival`.
4. m4 — in the eight ratchet specs (0028, 0030, 0038, 0039, 0040, 0041, 0042, 0043), update the stale
   `// 43 since TASK_2026_440 appended 0043_memory_retention.` provenance comment: keep the history line and add
   `// 44 since TASK_2026_443 appended 0044_memory_lifecycle.` (follow each file's existing comment convention).
5. XB1 — keep every prepared statement fully bound (already true; do not regress).
- Commands: `npx nx run-many -t test -p @ptah-extension/persistence-sqlite` (1 project) + typecheck + lint (1 project);
  plus `npx jest --config libs/backend/persistence-sqlite/jest.config.ts --testPathPatterns=0044_memory_lifecycle --verbose`
  showing 0 skipped.
- Report: append a `## Revision 1` section to `batch-1-report.md` with the diff summary, the mutation-check output
  and `git diff --stat` proving only spec files changed.

- Recommended executor: codex CLI lane (`cli: 'codex'`, role backend-developer)
- Fallback executor: backend-developer subagent
- Execution mode: sequential (one task)
- Parallel with: Batch 2 (file-disjoint: this batch edits only `libs/backend/persistence-sqlite`)
- Rationale: static SQL + ratchet bumps + one real-SQLite spec in one lib; self-contained lane prompt.
- Reviewer: Ollama Cloud lane, code-logic-reviewer -> `code-logic-review-batch-1.md`
- Suggested commit: `feat(persistence-sqlite): batch 1 - migration 0044 memory lifecycle column, indexes and salience rebase`
- Tasks: 1 | Depends on: none

### Task 1.1: Migration 0044 (archived_at, indexes, rebase, run-record columns) + ratchet bump — COMPLETE

- Dir: `W\libs\backend\persistence-sqlite\src\lib\migrations\`
  - CREATE `0044_memory_lifecycle.ts`, `0044_memory_lifecycle.spec.ts`
  - MODIFY `index.ts` (append `{ version: 44, name: '0044_memory_lifecycle', sql }`)
  - MODIFY (43 -> 44): `0028_gateway_conversation_workspace_root.spec.ts:78`, `0030_skill_event_metrics.spec.ts:33`,
    `0038_gateway_message_turn_state.spec.ts:86`, `0039_reap_orphaned_queue_rows.spec.ts:60`,
    `0040_skill_candidate_workspace_root.spec.ts:73`, `0041_skill_md_migration_state.spec.ts:57`,
    `0042_db_integrity_check_state.spec.ts:65`, `0043_memory_retention.spec.ts:48`
- Plan reference: implementation-plan.md:231-300 (exact SQL at :241-271)
- Pattern to follow: `0043_memory_retention.ts` + `0043_memory_retention.spec.ts` (registry, no `${`, real-SQLite
  opener with `node:sqlite` fallback that fails, never skips)
- Quality requirements: the SQL text exactly as the plan (drops BEFORE the rebase UPDATEs; not vec-gated; no CHECK
  on `lifecycle_note`); static SQL only.
- Validation notes: do not edit any older migration's SQL or comments (forward-only). The spec seeds rows after
  applying migrations up to 43 (at least 0002, 0017, 0018, 0043 and whatever they require), then applies 0044.
- Acceptance (spec asserts all): version 44 is highest, plain `sql`, no `${`; rebase unmerged curator 0.75 -> 0.30,
  merged 1.9 -> 1.0, 0.5 -> 0.05, `session_id IS NULL` unpinned 0.6 -> 0.6, pinned 1.0 -> 1.0; pre-existing
  `archival` row gets non-null `archived_at`, `recall` rows keep NULL; `idx_memories_salience` and
  `idx_memories_tier` absent; `idx_memories_tier_last_used`, `idx_memories_tier_archived`, `idx_corpus_mem_memory`
  present; `memory_retention_state` has the nine columns with defaults (three counters `0`, six nullable).
- Commands (from `W`):
  - `npx nx run-many -t test -p @ptah-extension/persistence-sqlite` — header "for 1 project"
  - `npx nx run-many -t typecheck -p @ptah-extension/persistence-sqlite` — 1 project
  - `npx nx run-many -t lint -p @ptah-extension/persistence-sqlite` — 1 project
- Report: `W\.ptah\specs\TASK_2026_443_40ec\batch-1-report.md`

### Batch 1 verification

- Files exist with real SQL; 8 ratchets read 44; the three commands pass with the 1-project header.
- Reviewer accepting verdict.

---

## Batch 2: memory-contracts usage-recorder port + platform-core lifecycle settings keys — COMPLETE (commit 0ecab63b3)

- Review (Ollama Cloud, `code-logic-review-batch-2.md`): APPROVED 8/10, 0 blocking/serious/moderate, 2 minor.
  Minor 1 (token literal not spec-pinned) closes in Task 3.2's `register.spec.ts` assertion; minor 2 carried into
  Task 3.2 as an explicit instruction.
- 2026-09-15 Mode 2: files verified on disk. Team-leader re-run: typecheck 2 projects green; test + lint ran
  for platform-core only (32 suites / 580 passed; lint 0 errors, 8 pre-existing warnings in unmodified files).
- ACCEPTED deviation: `@ptah-extension/memory-contracts` defines only `build` + `typecheck`
  (`project.json`); it is a type/token-only lib with no specs, so the 1-project header for test/lint is correct.
  Adding targets would edit a `project.json` (out of scope, needs `nx reset`). Batch 10 headers adjusted.
  Awaiting review `code-logic-review-batch-2.md`.

- Recommended executor: codex CLI lane (`cli: 'codex'`, role backend-developer)
- Fallback executor: backend-developer subagent
- Execution mode: sequential (two small tasks, one lane)
- Parallel with: Batch 1 (file-disjoint: `libs/backend/memory-contracts`, `libs/backend/platform-core` only)
- Rationale: two additive contract edits; no `libs/shared` change here (Deviation 1).
- Reviewer: Ollama Cloud lane, code-logic-reviewer -> `code-logic-review-batch-2.md`
- Suggested commit: `feat(memory-contracts,platform-core): batch 2 - memory usage recorder port and lifecycle settings keys`
- Tasks: 2 | Depends on: none

### Task 2.1: `IMemoryUsageRecorder` port + token + barrel + CLAUDE.md — COMPLETE

- Dir: `W\libs\backend\memory-contracts\`
  - CREATE `src\lib\memory-usage-recorder.port.ts` — `export interface IMemoryUsageRecorder { recordUse(memoryIds: readonly string[]): void; }`
    with the doc contract: never throws; empty or unknown ids are a no-op; a use restores an archival row.
  - MODIFY `src\lib\tokens.ts` — `MEMORY_USAGE_RECORDER: Symbol.for('PtahMemoryUsageRecorder')`
  - MODIFY `src\index.ts` — export the port type
  - MODIFY `CLAUDE.md` — list the port and token
- Plan reference: implementation-plan.md:352-359, 399-402
- Pattern to follow: `src\lib\memory-reader.port.ts:30-45`, `src\lib\tokens.ts:1-10`
- Quality requirements: zero runtime dependencies (the lib is zero-dep); no null implementation (consumers inject
  `isOptional`, plan :101).
- Acceptance: if the lib has a tokens spec, assert the new symbol equals `Symbol.for('PtahMemoryUsageRecorder')`.

### Task 2.2: Four `memory.lifecycle.*` file-based settings keys + defaults — COMPLETE

- File: MODIFY `W\libs\backend\platform-core\src\file-settings-keys.ts` (keys beside `:335-339`, defaults beside
  `:593-598`); MODIFY its spec if one asserts membership (`file-settings-keys.spec.ts`).
- Plan reference: implementation-plan.md:655-660, 564-571
- Keys/defaults: `memory.lifecycle.enabled` true, `memory.lifecycle.archiveAfterDays` 30,
  `memory.lifecycle.deleteAfterDays` 60, `memory.lifecycle.maxPerWorkspace` 25000.
- Pattern to follow: the `memory.retention.*` block at the same lines.
- Commands (from `W`), for the whole batch:
  - `npx nx run-many -t test -p @ptah-extension/memory-contracts @ptah-extension/platform-core` — "for 2 projects"
    (R-TL8: if `file-settings-manager.bench.spec.ts` times out, re-run with `--parallel=1` and record both)
  - same with `-t typecheck` and `-t lint` — 2 projects each
- Report: `W\.ptah\specs\TASK_2026_443_40ec\batch-2-report.md`

### Batch 2 verification

- Port, token, barrel export and four keys/defaults on disk; commands green with 2-project headers; reviewer accepts.

---

## Batch 3: memory-curator — ranking-only salience + explicit use recording — IN_PROGRESS

- Recommended executor: codex CLI lane (`cli: 'codex'`, role backend-developer)
- Fallback executor: backend-developer subagent
- Execution mode: sequential (Components 2 and 3 share `memory.store.ts`, `memory-search.service.ts`, `di/register.ts`)
- Parallel with: Batch 4 (file-disjoint)
- Rationale: cross-file refactor in one lib with real-SQLite specs; one lane, in order.
- Reviewer: Ollama Cloud lane, code-logic-reviewer -> `code-logic-review-batch-3.md`
- Suggested commit: `feat(memory-curator): batch 3 - rank by salience at query time and record memory use explicitly`
- Tasks: 3 | Depends on: Batch 1 (column `archived_at`), Batch 2 (port + token)

### Task 3.1: Ranking module replaces `SalienceScorer`; three ranked reads; curator stores a base — IN_PROGRESS

- Dir: `W\libs\backend\memory-curator\src\`
  - CREATE `lib\salience-ranking.ts`, `lib\salience-ranking.spec.ts`
  - DELETE `lib\salience-scorer.ts`
  - MODIFY `lib\memory.store.ts` (`list` :325-358 named `@rankNow`; `listAll` :364-412 positional `now` after
    filters, before `LIMIT ? OFFSET ?`; doc :360-363 "ranking salience"; DELETE `updateSalience` :524-540),
    `lib\memory.store.spec.ts` (drop `updateSalience` case :186; add real-SQLite rank-order case),
    `lib\memory-search.service.ts` (`listIndexRowsByFilter` :806-828, positional `now` before `LIMIT ?`),
    `lib\memory-search.service.spec.ts` (pure-filter listing orders by rank),
    `lib\memory-curator.service.ts` (insert stores `baseSalience(r.salienceHint, input.salienceBoost)`; merge calls
    `appendChunks` only, no salience write; remove scorer injection :183-184 and import :29),
    `lib\memory-curator.service.spec.ts` (remove the seven scorer mocks :67,286,381,455,698,1324,1657; assert base
    at insert, no salience write on merge),
    `lib\di\tokens.ts` (delete `MEMORY_SALIENCE_SCORER` :16-17), `lib\di\register.ts` (delete registration :72-76,
    header comment :6), `index.ts` (drop `SalienceScorer`/`ScoreInputs` :52-53; export the ranking functions and
    constants)
- Plan reference: implementation-plan.md:302-350, 170-184
- Pattern to follow: statement style already in `memory.store.ts:325-412`
- Quality requirements: `salienceRankOrderBy(placeholder: '?' | '@rankNow')` returns one of two LITERAL strings
  (no interpolation of anything else); expression exactly
  `m.salience * (604800000.0 / (604800000.0 + MAX(0, <p> - m.last_used_at))) + 0.3 * m.hits / (m.hits + 3.0) + m.pinned`
  then `DESC, m.id DESC`; `baseSalience` clamps to [0,1], non-finite -> 0; no statement anywhere writes `salience`
  after insert.
- Acceptance (`salience-ranking.spec.ts`, real SQLite, fails not skips): SQL value equals `rankSalience` within
  1e-9 over rows fresh/7/30/90 d x hits 0/3/50 x pinned 0/1; recent low-base outranks 90-day high-base; pinned
  outranks every unpinned; both placeholder texts differ only by the placeholder; `baseSalience` clamps.

### Task 3.2: `recordUse` replaces `recordHit`; search loses its hidden write; archival restore — IN_PROGRESS

- Depends on: Task 3.1 (same files)
- Dir: `W\libs\backend\memory-curator\src\lib\`
  - MODIFY `memory.store.ts`: class `implements IMemoryLister, IMemoryUsageRecorder`; REPLACE `recordHit`
    (:516-522) with `recordUse(ids)`; `insertMemoryWithChunks` (:174-225) binds
    `archived_at = tier === 'archival' ? now : null`; `appendChunks` (:573-575) SQL
    `SET updated_at = ?, last_used_at = ?, tier = CASE WHEN tier = 'archival' THEN 'recall' ELSE tier END, archived_at = NULL WHERE id = ?`
    and bumps the write counter when it restored an archival target.
  - MODIFY `memory-search.service.ts`: delete `this.store.recordHit(memory.id)` (:360); slice `fused` to `limit`
    after the rerank block (:309,341) so a no-reranker host returns `topK`.
  - MODIFY `di/register.ts`: `MEMORY_CONTRACT_TOKENS.MEMORY_USAGE_RECORDER` with
    `useToken: MEMORY_TOKENS.MEMORY_STORE` (precedent `MEMORY_LISTER` :112-114).
  - MODIFY `di/register.spec.ts`: `isRegistered(MEMORY_CONTRACT_TOKENS.MEMORY_USAGE_RECORDER)` true;
    `isRegistered(Symbol.for('PtahMemorySalienceScorer'))` false.
  - MODIFY `memory.store.spec.ts`, `memory-search.service.spec.ts`.
- Plan reference: implementation-plan.md:352-431
- Validation notes — R-TL1 (MANDATORY deviation from the plan's SQL): do NOT use
  `RETURNING (tier = 'recall' AND archived_at IS NULL)`; RETURNING reports post-update values and is true for every
  recall row. Instead, in one transaction: dedupe ids in JS, cap 200; if empty return;
  `SELECT DISTINCT workspace_root FROM memories WHERE id IN (SELECT value FROM json_each(@ids)) AND tier = 'archival'`;
  then `UPDATE memories SET hits = hits + 1, last_used_at = @now, tier = CASE WHEN tier = 'archival' THEN 'recall' ELSE tier END, archived_at = NULL WHERE id IN (SELECT value FROM json_each(@ids))`;
  after commit, bump the write counter for each selected root only. Catch `unknown`, `warn` once, never throw.
- Carried from `code-logic-review-batch-2.md` (minor 2): also edit
  `W\libs\backend\memory-contracts\src\lib\memory-usage-recorder.port.ts` doc comment with one sentence: duplicate
  ids count once per call and an implementation may cap a call at 200 ids (ids past the cap are ignored). Add this
  file to the Batch 3 commit. Minor 1: the `register.spec.ts` assertion must resolve the token by
  `Symbol.for('PtahMemoryUsageRecorder')` literal as well as by `MEMORY_CONTRACT_TOKENS.MEMORY_USAGE_RECORDER`.
- Acceptance (real SQLite): hits +1 once per distinct id (duplicates in input); `last_used_at` set; archival row ->
  recall + `archived_at` NULL; core/pinned tier unchanged; counter bumped when a row was restored and NOT bumped
  for a plain recall use; empty list and unknown id no-op; >200 ids capped; closed connection swallowed;
  `appendChunks` restores an archival target; insert with `tier: 'archival'` stamps `archived_at`. Search:
  `searchRich` issues no store write (no `recordUse` call) and returns at most `topK` hits without a reranker; a
  cache hit still records nothing.

### Task 3.3: Electron wizard-seed integration DDL gains `archived_at` — IN_PROGRESS

- File: MODIFY `W\apps\ptah-electron\src\integration\wizard-seed.integration.spec.ts` (`:119-133`, add
  `archived_at INTEGER` to the hand-written `memories` DDL). Deviation 4.
- Commands (from `W`), for the whole batch:
  - `npx nx run-many -t test -p @ptah-extension/memory-curator ptah-electron` — "for 2 projects"
  - `npx nx run-many -t typecheck -p @ptah-extension/memory-curator` — 1 project
  - `npx nx run-many -t lint -p @ptah-extension/memory-curator` — 1 project
  - grep `SalienceScorer|MEMORY_SALIENCE_SCORER|recordHit|updateSalience` under `W\libs` returns nothing
    (`wizard-seed-noop.spec.ts`'s `Symbol.for` literal is removed in Batch 9)
  - R-TL8: if `boot-scan-runner.spec.ts` abort test times out, re-run with `--parallel=1` and record both
  - XB1 better-sqlite3 run (Plan validation) for `memory-curator` with `--testPathPatterns "salience-ranking|memory.store.spec|memory-search.service.spec|di/register.spec"`
- Report: `W\.ptah\specs\TASK_2026_443_40ec\batch-3-report.md`

### Batch 3 revision 1 fix list (resume codex session 01a0a611-011c-7982-ad80-e9fd405f9acf) — PENDING

- Review (Ollama Cloud, `code-logic-review-batch-3.md`): APPROVED 8/10, 0 blocking/serious, 1 moderate, minors m1-m4.
  All nine confirmation items CONFIRMED (R-TL1 split with no RETURNING, no read-path writes, salience immutable,
  one ranking expression, topK slice, DI alias, XB1, R-TL4, boundaries).
- Team-leader decision: NOT committed until M1 and m2 are fixed (both spec-only). Batch 4 precedent: M1 guards the
  cache-invalidation guarantee R-TL1 depends on (the recorder must bump the SAME store instance search reads), and
  m2 is an acceptance item Task 3.2 lists ("leaves core/pinned tier unchanged") that has no spec. m1 (`updateTier`
  can set archival without `archived_at`) ACCEPTED: no runner calls `MemoryDecayJob`, and Batch 9 deletes the job
  (and Task 9.1 must delete `updateTier` too if it has no other caller). m3 (cache staleness after plain use) is the
  R-TL1 trade; m4 (decay-job spec thinned) accepted, job deleted in Batch 9.
- Scope: spec files only. `memory.store.ts`, `register.ts` and every other production file must NOT change.

1. M1 — `libs/backend/memory-curator/src/lib/di/register.spec.ts`: resolve and assert identity
   `expect(child.resolve(MEMORY_CONTRACT_TOKENS.MEMORY_USAGE_RECORDER)).toBe(child.resolve(MEMORY_TOKENS.MEMORY_STORE))`
   and the same for `Symbol.for('PtahMemoryUsageRecorder')`. If resolving `MEMORY_STORE` needs a dependency the
   test container lacks, register a minimal stand-in the same way the spec already does for its other tokens and
   say which in the report.
2. m2 — `libs/backend/memory-curator/src/lib/memory.store.spec.ts` (real SQLite): `recordUse` on a `core` row and on a
   pinned `recall` row increments `hits`, sets `last_used_at`, keeps `tier` unchanged and does not bump the write
   counter.
3. XB1 — bind every parameter in any new SQL.
- Commands (from `W`): `npx nx run-many -t test -p @ptah-extension/memory-curator` (1 project) and the XB1 Electron
  better-sqlite3 run on `--testPathPatterns "di/register.spec|memory.store.spec"`; `git diff --stat` must list only
  those two spec files as changed since the revision started.
- Report: append `## Revision 1` to `batch-3-report.md`. Do not edit `batches.md`. Do not commit.
- Acceptance by team-leader: diff read (spec-only); then the full Batch 3 command set re-run; no re-review.

### Batch 3 verification

- XB1: every spec that prepares SQL binds every named and positional parameter (passes under better-sqlite3 and node:sqlite).
- `salience-scorer.ts` gone; ranking module + spec present; `recordUse` implements R-TL1; search has no write;
  commands green with stated headers; reviewer accepts.

---

## Batch 4: agent-sdk + vscode-lm-tools — record use at injection and MCP search — COMPLETE (commit a6c92e4c2)

- Recommended executor: codex CLI lane (`cli: 'codex'`, role backend-developer)
- Fallback executor: backend-developer subagent
- Execution mode: parallel lanes are possible (two libs, no shared file), but recommended as ONE lane with both
  tasks: each task is small and a second lane would raise wave 2 to 3 lanes for little gain.
- Parallel with: Batch 3 (file-disjoint); may overlap Batch 5
- Rationale: consumers depend only on the Batch 2 port; optional injection precedents exist.
- Reviewer: Ollama Cloud lane, code-logic-reviewer -> `code-logic-review-batch-4.md`
- Suggested commit: `feat(agent-sdk,vscode-lm-tools): batch 4 - record memory use for injected and MCP search hits`
- Tasks: 2 | Depends on: Batch 2

### Task 4.1: `MemoryPromptInjector` records injected hits — COMPLETE

- Files: MODIFY `W\libs\backend\agent-sdk\src\lib\helpers\memory-prompt-injector.ts` and
  `memory-prompt-injector.spec.ts`
- Plan reference: implementation-plan.md:387-390, 416-417
- Implementation details: add
  `@inject(MEMORY_CONTRACT_TOKENS.MEMORY_USAGE_RECORDER, { isOptional: true }) private readonly usage: IMemoryUsageRecorder | null = null`
  after `workspace`, before `corpus` (constructor :87-95; update the one `new` site in the spec). In `buildBlock`,
  after the `MIN_SCORE` filter and before returning the block, `this.usage?.recordUse(hits.map((h) => h.memoryId))`
  inside the existing try, only when hits are non-empty.
- Acceptance: receives exactly the injected ids; not called for 0 hits or a short query; a throwing recorder does
  not change the returned block; `buildSessionStartBlock` never calls it; `null` recorder works.

### Task 4.2: MCP `ptah.memory.search` records returned hits — COMPLETE

- Files: MODIFY `W\libs\backend\vscode-lm-tools\src\lib\code-execution\ptah-api-builder.service.ts` (optional
  inject beside `memorySearch` :388-389; pass `getMemoryUsageRecorder` into `buildMemoryNamespace` :754-760),
  `...\namespace-builders\memory-namespace.builder.ts` (`search` calls
  `getMemoryUsageRecorder()?.recordUse(result.hits.map((h) => h.memoryId))` after a successful `reader.search`,
  :221), and both specs.
- Plan reference: implementation-plan.md:391-394, 418
- Validation notes: `code` namespace fallback and skill digest are NOT changed (D3). The dependency getter is
  optional in `MemoryNamespaceDependencies` so other builders/specs compile.
- Acceptance: search records returned ids; `list` does not; a missing recorder (VS Code) is a no-op; a throwing
  recorder does not fail the search.
- Commands (from `W`), for the whole batch:
  - `npx nx run-many -t test -p @ptah-extension/agent-sdk @ptah-extension/vscode-lm-tools` — "for 2 projects"
  - same with `-t typecheck` and `-t lint` — 2 projects each
- Report: `W\.ptah\specs\TASK_2026_443_40ec\batch-4-report.md`

### Batch 4 revision 1 fix list (resume codex session 01a0a601-894b-78b2-bb32-f81e302de4d5) — COMPLETE (in a6c92e4c2)

- Team-leader diff read: items 1-3 only. M1 `catch (error: unknown)` + optional narrow `logger` dep, passed from
  `PtahAPIBuilder`, spec asserts one `warn`; m2 `recordUse` now runs after the block is built (malformed-hit spec:
  `''`, no record); m3 negative specs for MCP reject, injector reject, `buildCorpusBlock`. Re-run: test 2 projects
  (vscode-lm-tools 50 suites / 1161 passed; agent-sdk 104 passed, 2 suites skipped pre-existing), typecheck 2,
  lint 2 (0 errors; `eslint` on the six files alone: 0 warnings). Committed with only the six files; no re-review
  (diff within the fix list).

- Review (Ollama Cloud, `code-logic-review-batch-4.md`): APPROVED 8/10, 0 blocking/serious, 1 moderate, 3 minor.
  Team-leader decision: NOT committed until M1, m2 and m3 are fixed. Reason: the use signal decides which memories
  the lifecycle archives and then DELETES; a recorder failure that leaves no log line turns into silent data loss
  with nothing to diagnose, and the bare `catch {` breaks the repo `catch (error: unknown)` standard. All three are
  small and stay inside the six Batch 4 files. m4 (recording inert until Batch 3 registers the token) needs no action.
- Scope: only the six Batch 4 files. Batch 3 is running in memory-curator; do not touch it and do not run
  memory-curator tests.

1. M1 — `memory-namespace.builder.ts:233-236`: replace the bare `catch {` with `catch (error: unknown)` and log at
   `warn` (message names `ptah.memory.search` use recording; include `error instanceof Error ? error.message :
   String(error)`). Add an optional `logger` (the vscode-core `Logger` type, or a narrow `{ warn(...) }` shape) to
   `MemoryNamespaceDependencies`, following `harness-namespace.builder.ts`'s logger dep; pass the builder's logger
   from `ptah-api-builder.service.ts` where `buildMemoryNamespace` is called (:764). Spec: a throwing recorder keeps
   `result.hits` AND `logger.warn` is called once.
2. m2 — `memory-prompt-injector.ts:117-138`: build the block string first, then call `recordUse` just before the
   `return`, still inside its own inner try/catch, so a rendering throw records nothing. Spec: a hit whose shape
   makes rendering throw (e.g. `chunkText` not a string, cast in the spec) returns `''` and `recordUse` is NOT
   called.
3. m3 — negative specs: (a) MCP `reader.search` rejects -> error envelope and `recordUse` not called;
   (b) injector `reader.search` rejects -> `''` and `recordUse` not called; (c) `buildCorpusBlock` never calls
   `recordUse`.
4. XB1 not applicable (no SQL in these libs).
- Commands (from `W`): `npx nx run-many -t test -p @ptah-extension/agent-sdk @ptah-extension/vscode-lm-tools`
  ("for 2 projects"), same with `-t typecheck` and `-t lint` (2 projects each).
- Report: append `## Revision 1` to `batch-4-report.md` with the diff summary, command headers and results, and
  `git diff --stat` limited to the six files. Do not edit `batches.md`. Do not commit.
- Acceptance by team-leader: line-by-line diff read limited to items 1-3; no re-review unless the diff reaches
  beyond them.

### Batch 4 verification

- XB1: every spec that prepares SQL binds every named and positional parameter (passes under better-sqlite3 and node:sqlite).
- Both recording sites on disk and injected optionally; commands green; reviewer accepts.

---

## Batch 5: memory-curator — lifecycle store, run budget, lifecycle service, settings, DI, vec harness — PENDING

- Recommended executor: codex CLI lane (`cli: 'codex'`, role backend-developer)
- Fallback executor: backend-developer subagent
- Execution mode: sequential (store -> budget -> service; shared `di/*`, `memory.store.ts`, harness)
- Parallel with: none in memory-curator (may overlap only Batch 4)
- Rationale: destructive SQL with plan assertions on real SQLite + sqlite-vec; design-sensitive, one lane.
- Reviewer: Ollama Cloud lane, code-logic-reviewer -> `code-logic-review-batch-5.md`
- Suggested commit: `feat(memory-curator): batch 5 - memory lifecycle store, run budget and lifecycle service`
- Tasks: 3 | Depends on: Batch 3 (Batch 1, 2 transitively)

### Task 5.1: Vec-capable test harness + `RetentionRunBudget` + limits + tsconfig exclude — PENDING

- Dir: `W\libs\backend\memory-curator\`
  - MODIFY `tsconfig.lib.json`: add `"src/**/*.test-support.ts"` to `exclude` (Deviation 8; closes TASK_2026_446_198a)
  - MODIFY `src\lib\retention\retention-sqlite.test-support.ts`: `openRetentionTestDb({ memorySchema: true, vec: true })`
    (opens with `allowExtension: true` under `node:sqlite`, or `loadExtension` under `better-sqlite3`; loads
    `require('sqlite-vec').getLoadablePath()`; `PRAGMA auto_vacuum = INCREMENTAL`, WAL, `foreign_keys = ON`; applies
    static SQL and `vecSql` of migrations 2, 7, 10, 15, 16, 17, 18, 19, 43, 44 in version order via a
    `migrationVecSql(version)` helper); THROWS if vec cannot load (no `it.skip`); `reopenWithoutVec()`;
    `seedMemory(raw, { id, workspaceRoot, tier, pinned, lastUsedAt, archivedAt, sessionId, salience, chunks, concepts, token })`
    inserting memory, chunks (FTS via trigger), one 384-float vec row per chunk, concepts rows.
    Keep the existing opt-out defaults so phase 1 specs are unchanged.
  - CREATE `src\lib\retention\retention-run-budget.ts`, `retention-run-budget.spec.ts`
  - MODIFY `src\lib\retention\memory-retention-config.ts`: `MemoryRetentionLimits` + `MEMORY_RETENTION_LIMITS` gain
    `maxMemoryRowsPerRun: 25_000`, `memoryDeleteBatchSize: 200`, `capEvictionGraceMs: 7 d` (named constants with
    doc comments, like the existing ones)
- Plan reference: implementation-plan.md:534-541, 573-580, 761-773
- Pattern to follow: closures at `memory-retention.service.ts:319-339` and `adaptBatch` (the budget must reproduce
  their exact semantics: stop order abort -> battery -> foreground -> `time-budget`; halve above `slowCallMs`, floor
  `minBatchSize`)
- Validation notes: `RetentionRunBudget` is a plain class, not in DI. Batch 5 does NOT yet change
  `MemoryRetentionService` (Batch 6 swaps the closures). Constructor signature exactly as plan :536.
- Acceptance (`retention-run-budget.spec.ts`): stop order; per-kind halving and floors independent across
  `queue`/`archive`/`delete`; queue and memory row budgets independent; `yield` resolves via `setImmediate`.

### Task 5.2: `MemoryLifecycleStore` — PENDING

- Depends on: Task 5.1 (harness)
- Dir: `W\libs\backend\memory-curator\src\lib\`
  - CREATE `retention\memory-lifecycle.store.ts`, `retention\memory-lifecycle.store.spec.ts`
  - MODIFY `di\tokens.ts` (`MEMORY_LIFECYCLE_STORE = Symbol.for('PtahMemoryLifecycleStore')`), `di\register.ts`
    (singleton), `index.ts` (export class + result types)
- Plan reference: implementation-plan.md:432-529 (exact SQL)
- Pattern to follow: statement cache by db identity + transaction helper + `RetentionStepError` /
  `database-busy` mapping `observation-retention.store.ts:313-330,568-619` (IMPORT `RetentionStepError`, do not
  re-declare)
- Quality requirements: every batch method is ONE `BEGIN IMMEDIATE` ... `COMMIT`, no internal loop; `canDelete()`
  = `vecStatus.available || !triggerExists('memory_chunks_vec_ad')`; the delete pair deletes chunks then memories
  with the repeated `tier <> 'core' AND pinned = 0` predicate inside the same transaction; `archiveBatch` never
  touches `updated_at`; `workspace_root IS @ws`; reads (`overCapWorkspaces`, `readPreview`) never throw and push
  `"<read>: <message>"` into `readErrors`; the two evict SELECTs are literal statements chosen by the tier arg.
- Validation notes: R4 (vec) — the store never runs the delete pair when `canDelete()` is false (service enforces;
  store spec proves `canDelete` truth table). A4 — the only `SET tier = 'archival'` statement in non-spec code.
- Acceptance (real SQLite + vec, first test asserts vec loaded): `EXPLAIN QUERY PLAN` of every SELECT shows
  `USING INDEX idx_memories_tier_last_used` or `idx_memories_tier_archived` (and `idx_corpus_mem_memory` for the
  subquery) with no `sqlite_stat1`; predicates for pinned, core, corpus member, grace, cutoff `<` vs `<=`; delete
  pair leaves 0 rows in `memory_chunks`, `memory_chunks_fts_docsize`, `memory_chunks_vec_rowids`,
  `memory_concepts_fts` for deleted ids and does not touch others; `canDelete` false after `reopenWithoutVec()` with
  trigger present and true with the trigger absent; a thrown memory DELETE rolls back the chunk DELETE of the same
  batch; `SQLITE_BUSY` -> `RetentionStepError('database-busy')`; no statement text contains `SET salience`.

### Task 5.3: `MemoryLifecycleService` + `memory-lifecycle-config.ts` + `markWorkspacesChanged` + DI — PENDING

- Depends on: Task 5.2
- Dir: `W\libs\backend\memory-curator\src\lib\`
  - CREATE `retention\memory-lifecycle.service.ts`, `retention\memory-lifecycle.service.spec.ts`,
    `retention\memory-lifecycle-config.ts`
  - MODIFY `memory.store.ts` (public `markWorkspacesChanged(roots)` calling the private `bumpWriteCounter` per root),
    `di\tokens.ts` (`MEMORY_LIFECYCLE_SERVICE = Symbol.for('PtahMemoryLifecycleService')`), `di\register.ts`
    (singleton), `di\register.spec.ts` (both lifecycle tokens registered), `index.ts` (service, config keys/defaults,
    `MemoryLifecycleStepResult`, `MemoryLifecycleNote`, `MemoryLifecyclePreview`)
- Plan reference: implementation-plan.md:542-606
- Pattern to follow: `memory-retention-config.ts:22-50,114-165` (keys, defaults, clamps);
  `MemoryRetentionService.readSettings` :645-654
- Quality requirements: 5 injected deps exactly (logger, workspace provider, lifecycle store, memory store, limits);
  step order disabled-check -> `canDelete` -> age delete -> archive -> cap (archival with grace first, then recall
  only when `recallEvictable > cap`, excess recomputed from returned counts) -> preview (always unless a hard stop
  ended the step; `forRunAt = nowMs + limits.intervalMs`) -> `markWorkspacesChanged(union of roots)`; each loop
  `hardStop()` -> `memoryRowRoom()` (0 -> `stop = 'memory-row-budget'`) -> one batch -> `observe` -> `consume` ->
  `yield`; `vec-unavailable` warns once per run and leaves `exhausted` true; clamps: archiveAfterDays 7-365,
  deleteAfterDays 7-730, maxPerWorkspace 1,000-1,000,000; settings read failure -> defaults + `warn`.
- Validation notes: `'memory-row-budget'` is added to `RetentionStopReason` in Batch 6; in Batch 5 declare the step
  result's `stop` type so it compiles now (e.g. add the member to `memory-retention.types.ts` here if needed — if
  so, list that file in the report; Batch 6 then only uses it).
- Acceptance (`memory-lifecycle.service.spec.ts`, fake store + clock): step order; disabled -> no writes, preview
  recorded, note `disabled`, exhausted true; vec-unavailable -> archive only + note + exhausted true; row budget ->
  `stop = 'memory-row-budget'`, exhausted false; hard stop mid-step -> no preview; cap order + recall-alone rule;
  grace cutoff passed to the store; `markWorkspacesChanged` receives the union; settings parity: each default
  equals `FILE_BASED_SETTINGS_DEFAULTS` from `@ptah-extension/platform-core`; clamps.
- Commands (from `W`), for the whole batch:
  - `npx nx run-many -t test -p @ptah-extension/memory-curator` — "for 1 project" (R-TL8 re-run rule applies)
  - `npx nx run-many -t typecheck -p @ptah-extension/memory-curator` — 1 project
  - `npx nx run-many -t lint -p @ptah-extension/memory-curator` — 1 project
  - report the count of skipped tests in the new specs (must be 0)
- Report: `W\.ptah\specs\TASK_2026_443_40ec\batch-5-report.md`

### Batch 5 verification

- XB1: every spec that prepares SQL binds every named and positional parameter (passes under better-sqlite3 and node:sqlite).
- Store, budget, service, config, harness, exclude on disk; vec loads (0 skipped); plan assertions pass; reviewer
  accepts. TASK_2026_446_198a closable after commit.

---

## Batch 6: retention integration + shared DTO + REACHABILITY PROOF (DI reach, real-SQLite integration) — PENDING

- Recommended executor: codex CLI lane (`cli: 'codex'`, role backend-developer)
- Fallback executor: backend-developer subagent
- Execution mode: sequential (service change -> DTO -> DI reach -> integration)
- Parallel with: none
- Rationale: couples producer, wire DTO and typed fixtures in one commit (Deviations 1-2); carries two of the four
  blocking reach proofs.
- Reviewer: Ollama Cloud lane, code-logic-reviewer -> `code-logic-review-batch-6.md`. The reviewer must run the
  mutation checks listed in Tasks 6.3 and 6.4 (or read the executor's evidence of them) before accepting.
- Suggested commit: `feat(memory-curator,shared): batch 6 - run the memory lifecycle inside memory retention`
- Tasks: 4 | Depends on: Batch 5 (and Batch 4 committed, so the wave has a clean tree)

### Task 6.1: `MemoryRetentionService` runs the lifecycle step; run record + report + storage health — PENDING

- Dir: `W\libs\backend\memory-curator\src\lib\retention\`
  - MODIFY `memory-retention.service.ts`: inject `MEMORY_TOKENS.MEMORY_LIFECYCLE_SERVICE` (7 deps); `execute` builds
    `RetentionRunBudget` and the purge + quarantine loops use it (closures :319-339 and `adaptBatch` DELETED); after
    quarantine, when `stop === null || stop === 'row-budget'`, `await lifecycle.runStep(budget, startedAt)`; its
    `stop` sets the run's stop if still null; ledger prune + reclaim keep their condition (:407-425); `completed`
    also requires `exhausted`; `writeRun` gets counters, note, preview; `storageHealth()` adds `memoryLifecycle`
    from live settings + state row (no memory-table query).
  - MODIFY `memory-retention.types.ts` (`'memory-row-budget'` if not already added in 5.3;
    `MemoryRetentionRunReport` + `memoriesArchived`, `memoriesDeleted`, `memoriesEvicted`, `lifecycleNote`)
  - MODIFY `observation-retention.store.ts` (`RetentionRunRecord` / `RetentionState` / `WRITE_RUN_SQL` /
    `READ_STATE_SQL` + nine 0044 columns; preview `null` keeps the previous value, same rule as
    `avg_processed_row_bytes`) and `observation-retention.store.spec.ts`
  - MODIFY `memory-retention.service.spec.ts` (update the `new MemoryRetentionService(` site)
- Plan reference: implementation-plan.md:607-632
- Quality requirements: `run` still never rejects; flag cleared in `finally`; lifecycle `RetentionStepError`
  goes through the existing catch (:426-435; busy -> `partial`, else `failed`); file stays <= ~700 lines (R-TL10).
- Acceptance (service spec, fakes): lifecycle called once per executed run with a `RetentionRunBudget` and a number;
  NOT called for any skip gate (each gate a case); called after a queue `row-budget` stop; not called after
  `time-budget`; `partial` when not exhausted with the lifecycle stop token; counters persisted; preview `null`
  keeps previous; `storageHealth().memoryLifecycle` shape.

### Task 6.2: Shared wire DTO additions + typed frontend fixture patch — PENDING

- Depends on: Task 6.1
- Files:
  - MODIFY `W\libs\shared\src\lib\types\rpc\rpc-curator-diagnostics.types.ts`: `MemoryRetentionRunDto` +
    `memoriesArchived`, `memoriesDeleted`, `memoriesEvicted` (required numbers); new `MemoryLifecyclePreviewDto`;
    `MemoryStorageHealthDto.memoryLifecycle` (required) exactly as plan :663-686. Do NOT remove `lastDecay*` or
    `'decay-run'` here (Batch 9).
  - MODIFY `memory-retention.service.ts` `toRunDto` (:656) to map the three counters (same file as 6.1).
  - MODIFY fixture fields only (Deviation 2):
    `W\libs\frontend\memory-curator-ui\src\lib\components\diagnostics\storage-health-panel.component.spec.ts`
    (factory :12-50) and `...\memory-diagnostics-accordion.component.spec.ts` (literal near :144).
- Plan reference: implementation-plan.md:655-692
- Validation notes: no RPC method added, so no `rpc.types.ts` method map or `ALLOWED_METHOD_PREFIXES` change.

### Task 6.3: REACHABILITY PROOF — DI graph wires the lifecycle into the registered retention service — PENDING

- Depends on: Task 6.1
- File: MODIFY `W\libs\backend\memory-curator\src\lib\di\register.spec.ts`
- Plan reference: implementation-plan.md:752-757
- Test: after `registerMemoryCuratorServices` on the real test DB with the lifecycle schema (Batch 5 harness),
  resolve `MEMORY_TOKENS.MEMORY_RETENTION_SERVICE`, run it with gates open (`bootDeferralMs` past, not on battery,
  foreground `Infinity`), and assert the report is a run (not a skip) whose `memoriesArchived` is a number, and that
  a seeded recall row unused past 30 d is `archival` afterwards.
- Failure it MUST detect (state these in the spec's describe/it names or a comment): (a) `MEMORY_LIFECYCLE_SERVICE`
  or `MEMORY_LIFECYCLE_STORE` not registered -> resolve throws; (b) the registered `MemoryRetentionService` does not
  receive the lifecycle collaborator or `execute` does not call `runStep` -> seeded row stays `recall`; (c) report
  lacks lifecycle counters -> `memoriesArchived` undefined.
- Mutation check (executor runs and reports; nothing committed): temporarily comment out the `runStep` call in
  `execute`, run only this spec, confirm it FAILS, restore, confirm it passes; `git diff` of the service identical to
  the intended change afterwards.

### Task 6.4: REACHABILITY PROOF — real SQLite + sqlite-vec integration through `MemoryRetentionService.run` — PENDING

- Depends on: Tasks 6.1-6.3
- File: MODIFY `W\libs\backend\memory-curator\src\lib\retention\memory-retention.integration.spec.ts` — new
  `describe('memory lifecycle — integration (real SQLite + sqlite-vec, fake clock)')`
- Plan reference: implementation-plan.md:758-803 (seed, runs and every case)
- Wiring: real `ObservationRetentionStore`, `SqlitePageReclaimer`, `MemoryStore` (fake embedder, `VecStatusService`
  stand-in with `available` toggled), `MemoryLifecycleStore`, `MemoryLifecycleService`, `MemoryRetentionService`
  with gates open. First test asserts vec loaded (throws otherwise; no skip).
- Cases (all from the plan): Run 1 at T0 (45 archived, `archived_at = T0` exactly on those, 0 deleted, chunk/FTS/vec
  counts unchanged); use at T0+10 d restores; **Run at T0+30 d deletes 0 (AC2)**; Run at T0+61 d deletes 44 with 0
  rows in memories/chunks/FTS docsize/vec rowids/concepts per id, FTS `MATCH 'alphaold1'` empty, vec KNN excludes a
  deleted rowid, survivors intact, `pagesReclaimed` reported, preview non-null; cap test (6 grace-eligible oldest
  archival evicted, 3 in-grace kept, B untouched) and recall variant (10 oldest evicted); first-run back-to-back
  guard; vec unavailable (`completed`, note `vec-unavailable`, archive happened, 0 deleted, no `no such module:
  vec0`, next hourly run `not-due`); budget 25 (`partial` / `memory-row-budget`, next hourly run due and finishes);
  failure mid-delete (report `failed`, batch 1 gone, batch 2 memories AND chunks present, flag released); disabled
  (0 writes, note `disabled`, preview has the counts an enabled run would act on).
- Failure it MUST detect: the lifecycle is built but `run` does not reach it, reaches it without deleting chunks /
  FTS / vec rows, deletes before M days after archival, or deletes with vec unavailable.
- Mutation check (executor runs and reports; nothing committed): with the `runStep` call removed, the Run 1 case
  FAILS; with the chunk DELETE removed from the delete pair, the T0+61 d orphan assertions FAIL. Restore both.
- Commands (from `W`), for the whole batch:
  - `npx nx run-many -t test -p @ptah-extension/memory-curator @ptah-extension/shared @ptah-extension/memory-curator-ui @ptah-extension/rpc-handlers @ptah-extension/thoth-runtime @ptah-extension/cli-engine` — "for 6 projects"
  - same set with `-t typecheck` — 6 projects
  - `npx nx run-many -t lint -p @ptah-extension/memory-curator @ptah-extension/shared @ptah-extension/memory-curator-ui` — 3 projects
  - report skipped count in `register.spec.ts` and the integration spec (must be 0)
- Report: `W\.ptah\specs\TASK_2026_443_40ec\batch-6-report.md` (include both mutation-check outputs)

### Batch 6 verification

- XB1: every spec that prepares SQL binds every named and positional parameter (passes under better-sqlite3 and node:sqlite).
- Lifecycle step called from `execute`; closures gone; DTO fields present with producer; typed fixtures patched;
  two reach proofs pass and were shown to fail under mutation; 6-project runs green; reviewer accepts.

---

## Batch 7: REACHABILITY PROOF — Electron + CLI hosts reach the lifecycle; job summary — PENDING

- Recommended executor: codex CLI lane (`cli: 'codex'`, role backend-developer)
- Fallback executor: backend-developer subagent
- Execution mode: sequential (summary first; both host specs assert its text)
- Parallel with: Batch 8 (file-disjoint: `libs/backend/thoth-runtime`, `libs/backend/cli-engine` only)
- Rationale: the two host reach proofs the user named as blocking; production host code is unchanged by design.
- Reviewer: Ollama Cloud lane, code-logic-reviewer -> `code-logic-review-batch-7.md`
- Suggested commit: `test(thoth-runtime,cli-engine): batch 7 - prove both hosts reach the memory lifecycle step`
- Tasks: 3 | Depends on: Batch 6

### Task 7.1: Retention job summary names memory counts + thoth-runtime CLAUDE.md — PENDING

- Files: MODIFY `W\libs\backend\thoth-runtime\src\lib\memory-retention-job.ts` (:97 summary
  `purged <p> processed, quarantined <q> stuck, archived <a> / deleted <d> / evicted <e> memories, reclaimed <r> pages`),
  `memory-retention-job.spec.ts`, `W\libs\backend\thoth-runtime\CLAUDE.md` (retention job bullet names the lifecycle
  step)
- Plan reference: implementation-plan.md:694-708
- Validation notes: no change to job id `@ptah/memory-retention`, name, handler name, cron `17 * * * *`, gating or
  failure channel; `start-thoth-cron.ts` and CLI `thoth-runtime.ts` production code stay untouched (plan :1014).

### Task 7.2: REACHABILITY PROOF — Electron host (`startThothCron`) — PENDING

- Depends on: Task 7.1
- File: MODIFY `W\libs\backend\thoth-runtime\src\lib\start-thoth-cron.spec.ts`, inside
  `describe('memory retention job')` (:787): new test
  `the registered handler runs the memory lifecycle step through a real MemoryRetentionService`
- Plan reference: implementation-plan.md:737-748 (exact construction)
- Test: register under `MEMORY_TOKENS.MEMORY_RETENTION_SERVICE` a REAL `MemoryRetentionService` (import from
  `@ptah-extension/memory-curator`) with a fake `ObservationRetentionStore` (purge `{ deleted: 0, exhausted: true }`,
  quarantine 0, `readState` null), fake reclaimer (`autoVacuumMode: 0`), `{ db: {} }` connection, defaults workspace
  provider, limits `{ ...MEMORY_RETENTION_LIMITS, bootDeferralMs: 0 }`, spy lifecycle
  `{ runStep: jest.fn().mockResolvedValue({ archived: 4, deleted: 2, evicted: 1, exhausted: true, stop: null, note: null, preview: null }) }`;
  `startThothCron`; take the `memory:retention` handler; invoke with a fake ctx; assert `runStep` called once with a
  `RetentionRunBudget`-shaped object and a number, and the summary contains `archived 4 / deleted 2 / evicted 1 memories`.
- Failure it MUST detect: handler not registered for `@ptah/memory-retention`; handler does not call `service.run`;
  `run` does not call `runStep`; summary drops the memory counts.
- Mutation check (report; nothing committed): with `runStep` removed from `execute` in memory-curator, this test
  FAILS; restore.

### Task 7.3: REACHABILITY PROOF — CLI host (`activateThoth`) — PENDING

- Depends on: Task 7.1
- File: MODIFY `W\libs\backend\cli-engine\src\lib\bootstrap\thoth-runtime.spec.ts`, inside
  `describe('memory retention job (TASK_2026_440 reachability)')` (:456): the same real-service test through
  `activateThoth(container, 'runtime', logger)`; the existing `oneshot` registers-nothing test stays.
- Plan reference: implementation-plan.md:749-751
- Failure it MUST detect: same four as Task 7.2, for the CLI runtime tier.
- Mutation check: same as 7.2.
- Commands (from `W`), for the whole batch:
  - `npx nx run-many -t test -p @ptah-extension/thoth-runtime @ptah-extension/cli-engine` — "for 2 projects"
  - same with `-t typecheck` and `-t lint` — 2 projects each
  - `git diff --stat -- libs/backend/thoth-runtime/src/lib/start-thoth-cron.ts libs/backend/cli-engine/src/lib/bootstrap/thoth-runtime.ts` is empty
- Report: `W\.ptah\specs\TASK_2026_443_40ec\batch-7-report.md` (include mutation-check outputs)

### Batch 7 verification

- XB1: every spec that prepares SQL binds every named and positional parameter (passes under better-sqlite3 and node:sqlite).
- Both host tests pass and failed under mutation; production host files unchanged; reviewer accepts.

---

## Batch 8: memory-curator-ui — lifecycle rows in the storage panel; decay tile removed — PENDING

- Recommended executor: codex CLI lane (`cli: 'codex'`, role frontend-developer)
- Fallback executor: frontend-developer subagent
- Execution mode: sequential (one lib, shared fixtures)
- Parallel with: Batch 7 (file-disjoint: `libs/frontend/memory-curator-ui` only)
- Rationale: two template rows + deletions + fixtures; must land before Batch 9 removes the shared fields.
- Reviewer: Ollama Cloud lane, code-logic-reviewer -> `code-logic-review-batch-8.md`
- Suggested commit: `feat(memory-curator-ui): batch 8 - show memory lifecycle results and preview; drop the decay tile`
- Tasks: 2 | Depends on: Batch 6

### Task 8.1: Storage panel rows — PENDING

- Files: MODIFY `W\libs\frontend\memory-curator-ui\src\lib\components\diagnostics\storage-health-panel.component.ts`
  and `storage-health-panel.component.spec.ts`
- Plan reference: implementation-plan.md:709-731
- Implementation details: "Last retention run" list (:214-223) row `Memories` ->
  `archived <a> · deleted <d> · evicted <e>` via `formatCount`; "Retention settings" list (:245-252) row
  `Memory lifecycle` -> `archive after <N> d · delete after <M> d · cap <cap>` then on the same `dd`: preview
  `next run: <x> to archive · <y> to delete · up to <z> over cap`, or `preview after the first run` (null preview),
  or `off (preview only)` (disabled), or `deletes paused: vector extension unavailable` (`vec-unavailable`);
  `data-testid="storage-memory-lifecycle"`.
- Quality requirements: OnPush unchanged; text (not colour) carries the note; no settings writes.
- Acceptance: spec renders both rows for a populated DTO, null preview, disabled, vec-unavailable.

### Task 8.2: Remove decay tile, state and event tone — PENDING

- Files (all under `W\libs\frontend\memory-curator-ui\src\lib\`):
  `components\diagnostics\memory-diagnostics-accordion.component.ts` (tile :61-66, `lastDecay` :226,
  `lastDecayLabel` :242-243) + spec (:30,65,99,131; assert `[data-testid="last-decay-run"]` absent);
  `services\memory-diagnostics-state.service.ts` (:30,41,68-70) + spec (:69-73,132);
  `components\diagnostics\event-feed.component.ts` (:159 `'decay-run'` case);
  `services\memory-diagnostics-rpc.service.spec.ts` (:64-65,102-103);
  `components\memory-curator-tab.component.spec.ts` (:20)
- Validation notes: the shared DTO still carries `lastDecay*` and `'decay-run'` until Batch 9; after this batch no
  frontend code reads them. Fixtures that are typed `MemoryDiagnosticsResult` may keep `lastDecayAt: null` only if
  the type still requires it — Batch 9 removes it.
- Commands (from `W`), for the whole batch:
  - `npx nx run-many -t test -p @ptah-extension/memory-curator-ui` — "for 1 project"
  - same with `-t typecheck` and `-t lint` — 1 project each
  - grep `lastDecay|decay-run` in `W\libs\frontend` non-spec files returns nothing
- Report: `W\.ptah\specs\TASK_2026_443_40ec\batch-8-report.md`

### Batch 8 verification

- XB1: every spec that prepares SQL binds every named and positional parameter (passes under better-sqlite3 and node:sqlite).
- Rows render all four states; decay UI gone; commands green; reviewer accepts.

---

## Batch 9: Decay removal across memory-curator, shared, rpc-handlers; rpc-handlers use recording — PENDING

- Recommended executor: codex CLI lane (`cli: 'codex'`, role backend-developer)
- Fallback executor: backend-developer subagent
- Execution mode: sequential (one atomic cross-lib removal; `memory-rpc.handlers.ts` shared by both tasks)
- Parallel with: none (starts after Batches 7 and 8 return, so no host test run compiles memory-curator mid-edit)
- Rationale: Deviation 3 — the removal is only type-safe as one commit.
- Reviewer: Ollama Cloud lane, code-logic-reviewer -> `code-logic-review-batch-9.md`
- Suggested commit: `refactor(memory-curator,shared,rpc-handlers): batch 9 - delete the unscheduled decay job and record use on memory reads`
- Tasks: 2 | Depends on: Batches 3, 7, 8

### Task 9.1: Delete `MemoryDecayJob` and decay diagnostics everywhere — PENDING

- Files:
  - DELETE `W\libs\backend\memory-curator\src\lib\memory-decay.job.ts`, `memory-decay.job.spec.ts`
  - MODIFY `W\libs\backend\memory-curator\src\lib\di\tokens.ts` (`MEMORY_DECAY_JOB` :18-19), `di\register.ts`
    (:132-136, header :9), `di\register.spec.ts` (`isRegistered(Symbol.for('PtahMemoryDecayJob'))` false),
    `src\index.ts` (`MemoryDecayJob`, `MemoryDecayStats` exports), `diagnostics.service.ts` (:12,33-34,48,57-58),
    `diagnostics.service.spec.ts`, `diagnostics.types.ts` (`MemoryDecayStats`, two snapshot fields, `'decay-run'`),
    `memory-curator.service.ts` (`recordDecayEvent` :300-306), `memory-curator.service.spec.ts` (:152-160,183)
  - MODIFY `W\libs\shared\src\lib\types\rpc\rpc-curator-diagnostics.types.ts` (`'decay-run'` :4; `lastDecayAt`,
    `lastDecayStats` :173-176)
  - MODIFY `W\libs\backend\rpc-handlers\src\lib\handlers\memory-rpc.handlers.ts` (mapping :532-541) and spec fixtures
    (:117-118,633-634,683)
  - MODIFY `W\apps\ptah-extension-vscode\src\integration\wizard-seed-noop.spec.ts` (drop both `Symbol.for` mocks :41-42)
- Plan reference: implementation-plan.md:634-653, 129-136
- Acceptance: grep `MemoryDecayJob|MEMORY_DECAY_JOB|lastDecay|decay-run|recordDecayEvent|MemoryDecayStats` under
  `W\libs` and `W\apps` returns nothing.

### Task 9.2: `memory:get` and `mem:getObservations` record use — PENDING

- Depends on: Task 9.1 (shared handler file)
- Files: MODIFY `W\libs\backend\rpc-handlers\src\lib\handlers\memory-rpc.handlers.ts` (`memory:get` :245-252 calls
  `this.store.recordUse([params.id])` after a found memory), `memory-rpc.handlers.spec.ts`,
  `mem-rpc.handlers.ts` (inject `MEMORY_CONTRACT_TOKENS.MEMORY_USAGE_RECORDER` — the class holds no store today,
  `:42-46`; call `recordUse(r.memories.map((m) => m.id))` at :145-152), `mem-rpc.handlers.spec.ts`
- Plan reference: implementation-plan.md:395-398, 419-420
- Validation notes: the recorder is registered by memory-curator in every host that registers these handlers; use
  a required injection only if every registration site of `MemRpcHandlers` also registers memory-curator (check
  `register-rpc-surface.ts` / host manifests); otherwise `isOptional: true`. Report which and why.
- Acceptance: `memory:get` (found) and `mem:getObservations` record; `memory:get` (not found), `memory:search`,
  `memory:list`, `mem:searchIndex`, `mem:timeline` do not; recorder failure does not change results.
- Commands (from `W`), for the whole batch:
  - `npx nx run-many -t test -p @ptah-extension/memory-curator @ptah-extension/shared @ptah-extension/rpc-handlers @ptah-extension/memory-curator-ui @ptah-extension/thoth-runtime @ptah-extension/cli-engine` — "for 6 projects"
  - same set with `-t typecheck` — 6 projects
  - `npx nx run-many -t lint -p @ptah-extension/memory-curator @ptah-extension/shared @ptah-extension/rpc-handlers` — 3 projects
  - `npx nx run-many -t test -p ptah-extension-vscode` — "for 1 project"
- Report: `W\.ptah\specs\TASK_2026_443_40ec\batch-9-report.md`

### Batch 9 verification

- XB1: every spec that prepares SQL binds every named and positional parameter (passes under better-sqlite3 and node:sqlite).
- Decay code and fields gone in one commit; both RPC reads record; commands green; reviewer accepts.

---

## Batch 10: Final verification — CLAUDE.md drift fix, full suite + greps, AC9 timing on a temp copy — PENDING

- Recommended executor: 10.1 codex CLI lane (docs); 10.2 and 10.3 senior-tester subagent (see Defaults)
- Fallback executor: 10.1 technical-content-writer or backend-developer subagent; 10.2 codex lane; 10.3 none
  (return to orchestrator)
- Execution mode: sequential, strictly 10.1 -> 10.2 -> 10.3 (10.2 must verify the final docs state; 10.3 creates a
  `*.local.spec.ts` that 10.2's Jest run must never see, R-TL7)
- Rationale: the phase does not close on unit specs; the whole affected set plus timing on production pragmas.
- Reviewer: 10.1 Ollama Cloud lane code-logic-reviewer (docs accuracy against code) -> `code-logic-review-batch-10.md`;
  10.2/10.3 are verification, judged by team-leader against `test-report.md`.
- Commits: 10.1 `docs(memory-curator): batch 10 - document the memory lifecycle and remove decay references`;
  `test-report.md` committed separately after 10.3 passes (`docs: record TASK_2026_443 test report`).
- Tasks: 3 | Depends on: Batch 9

### Task 10.1: `memory-curator/CLAUDE.md` drift fix — PENDING

- File: MODIFY `W\libs\backend\memory-curator\CLAUDE.md`
- Drift on disk today: `:13` "salience scoring, decay job"; `:32` Public API lists `SalienceScorer`,
  `MemoryDecayJob`; `:42-43` Internal Structure describes `salience-scorer.ts` and `memory-decay.job.ts` ("phase 2
  ... wires it"); `:76` "see salience-scorer".
- Required content: replace those with `salience-ranking.ts` (stored salience is an immutable base in [0,1];
  ranking is query-time), `MemoryLifecycleStore` / `MemoryLifecycleService` / `RetentionRunBudget` /
  `memory-lifecycle-config.ts`, new tokens (`MEMORY_LIFECYCLE_STORE`, `MEMORY_LIFECYCLE_SERVICE`, recorder via
  `MEMORY_CONTRACT_TOKENS.MEMORY_USAGE_RECORDER`); extend the retention Guidelines bullet (:83) with one lifecycle
  bullet: the step runs inside `MemoryRetentionService.run` after quarantine; recall unused `archiveAfterDays` (30)
  -> archival with `archived_at`; archival older than `deleteAfterDays` (60) FROM `archived_at` -> deleted with
  chunks (FTS + vec via triggers) in one batch transaction; per-workspace cap 25,000 evictable, archival-first with
  7 d grace; pinned/core/corpus exempt; deletes paused when vec is not loaded; "used" = injected hits, MCP search
  hits, `memory:get`, `mem:getObservations`, curator merge (a use restores archival); the only
  `SET tier = 'archival'` writer is `archiveBatch`; nothing writes `salience` after insert; the R1
  `memory_concepts_fts` drift caveat. Budgets: 25,000 memory rows per run, delete batch 200 (or the value Task 10.3
  reports, updated after 10.3 if different).
- Acceptance: grep `SalienceScorer|MemoryDecayJob|decay job|salience-scorer` in that file returns nothing; every
  named symbol exists in `src/index.ts`.
- Report: `W\.ptah\specs\TASK_2026_443_40ec\batch-10-docs-report.md`

### Task 10.2: Full affected-set run + invariant greps — PENDING

- Depends on: Task 10.1 committed
- Commands (from `W`; record every header; `--parallel=1` re-run rule for R-TL8):
  - `npx nx run-many -t test -p @ptah-extension/persistence-sqlite @ptah-extension/memory-contracts @ptah-extension/memory-curator @ptah-extension/agent-sdk @ptah-extension/vscode-lm-tools @ptah-extension/rpc-handlers @ptah-extension/platform-core @ptah-extension/shared @ptah-extension/thoth-runtime @ptah-extension/cli-engine @ptah-extension/memory-curator-ui` — "for 10 projects" (memory-contracts has no test target; Nx lists it under "do not have a configuration")
  - same set with `-t typecheck` — 11; with `-t lint` — 10 (same reason)
  - `npx nx run-many -t test -p ptah-electron ptah-extension-vscode` — "for 2 projects"
- Greps (under `W\libs` and `W\apps`, excluding `.ptah`):
  - `MemoryDecayJob|SalienceScorer|recordHit|updateSalience|lastDecay|decay-run` -> no matches
  - `SET tier = 'archival'|tier = 'archival',` in non-spec code -> only `memory-lifecycle.store.ts` `archiveBatch`
    (A4); insert path sets tier from its argument
  - `SET salience|salience = ` writes in non-spec, non-migration code -> none (insert binding excepted)
  - `from '@ptah-extension/(cron-scheduler|skill-synthesis|agent-sdk|rpc-handlers)'` in `libs/backend/memory-curator/src` -> none
- Reachability evidence: per-spec pass counts and skipped = 0 for `start-thoth-cron.spec.ts`,
  `cli-engine thoth-runtime.spec.ts`, `memory-curator di/register.spec.ts`, `memory-retention.integration.spec.ts`,
  `memory-lifecycle.store.spec.ts`, `salience-ranking.spec.ts`, `0044_memory_lifecycle.spec.ts`.
- Output: section "## Task 10.2" in `W\.ptah\specs\TASK_2026_443_40ec\test-report.md`

### Task 10.3: AC9 timing on a TEMP COPY of the snapshot (plan Component 12) — PENDING

- Depends on: Task 10.2
- Plan reference: implementation-plan.md:872-894; procedure `../TASK_2026_440_834c/test-report.md` Task 7.4 (:252-292)
- Safety rules (every one is a stop condition):
  - NEVER open, write, rename or delete `C:\Users\abdal\.ptah\state\ptah.sqlite`, `-wal`, `-shm`, or open the
    snapshot `C:\Users\abdal\.ptah\state\ptah.pre-migration-20260909T230600Z.sqlite` with SQLite — only a byte copy
    (`fs.copyFileSync(src, dst, COPYFILE_EXCL)`) reads it. Record its size and mtime before and after (expected
    1,178,537,984 bytes, 2026-09-10 02:06:09).
  - Temp dir by fail-if-exists mkdir under `C:\Users\abdal\AppData\Local\Temp\` (e.g. `task-443-timing-<8 hex>`);
    every copy named `timing-copy-*.sqlite` (never starting with `ptah`); a fresh copy per series; delete each copy
    when its series ends and the dir at the end, confirm gone.
  - Open copies with `node:sqlite` (better-sqlite3 has the Electron ABI) and the six production pragmas in
    production order (`journal_mode = WAL`, `foreign_keys = ON`, `synchronous = NORMAL`, `temp_store = MEMORY`,
    `mmap_size = 268435456`, `busy_timeout = 5000`), READ BACK and recorded; load vec from
    `require('sqlite-vec').getLoadablePath()`.
  - Never construct `SqliteMigrationRunner` or `SqliteBackupService`; never set `PTAH_DB_PATH` under `~/.ptah`.
    The snapshot is at migration 41: apply the static SQL (and `vecSql` where present) of 42, 43, 44 in order from
    `MIGRATIONS`.
- Harness: CREATE `W\libs\backend\memory-curator\src\lib\retention\memory-lifecycle.timing.local.spec.ts`, run
  `npx jest --config libs/backend/memory-curator/jest.config.ts --testPathPatterns=memory-lifecycle.timing.local.spec.ts --runInBand`,
  then DELETE it; `git status --short -- libs/backend/memory-curator` must be empty afterwards.
- Measure p50 / p95 / max: M1 migration 0044 total (target <= 1 s); M2 first real `MemoryRetentionService.run`
  (`bootDeferralMs: 0`, real clock) with archive batch durations (>= 40 batches) and lifecycle wall time; M3 age
  delete at fake `now = run1 + 61 d`, >= 30 delete batches of 200 (max <= 120 ms, p95 <= 100 ms), orphan counts
  chunk / FTS docsize / vec rowid = 0 afterwards; M4 cap eviction `maxPerWorkspace = 5,000` on a fresh copy aged
  past grace, >= 30 evict batches; M5 preview reads (3 statements) and ranked `list` / `listAll`; M6 `recordUse` of
  5 ids x 100 reps. Log whether adaptive halving triggered.
- Fixed rule (report only; source is not edited here): if M3 or M4 max > 120 ms or p95 > 100 ms, report the largest
  of {200, 100, 50} that passes as `memoryDeleteBatchSize`; if M2 archive p95 > 100 ms, report the largest of
  {500, 250, 100} that passes as the archive batch floor. A changed constant becomes a follow-up task (Task 10.4,
  created by team-leader only if needed) with its own lane + review + commit. If even 50 fails, team-leader returns a
  BLOCKER to the architect.
- Output: section "## Task 10.3" in `test-report.md` with environment (Node, SQLite, vec versions, disk), pragmas
  read back, counts, every metric, PASS/FAIL, and the safety proofs (snapshot size/mtime before/after, temp dir
  gone, harness gone).

### Batch 10 verification

- XB1: every spec that prepares SQL binds every named and positional parameter (passes under better-sqlite3 and node:sqlite).
- CLAUDE.md drift fixed and reviewed; 10-project test/lint, 11-project typecheck and 2-app test green with correct headers;
  greps clean; reach specs 0 skipped; AC9 PASS (or Task 10.4 recorded); safety proofs in `test-report.md`; no harness
  file in `git status`.
