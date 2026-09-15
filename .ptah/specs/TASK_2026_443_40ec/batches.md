# Batches - TASK_2026_443_40ec

Total tasks: 25 | Batches: 10 | Complete: 8/10

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

Rebase onto PR #513 final head (2026-09-15, orchestrator; `rebase-report.md`):

- New base `9ec3b26e7` (#513 head). Phase 2 head `ab7cf6977`. Old -> new SHAs (every older SHA in this file is
  pre-rebase): `3be25c0ec` -> `489fe26f6` (docs); `0ecab63b3` -> `a1f173a5d` (Batch 2); `87cda19ef` -> `01402b3b3`
  (Batch 1); `a6c92e4c2` -> `88797e8d2` (Batch 4); `eca8e3e4b` -> `2ed2f95d5` (docs); `d85851962` -> `8866acec2`
  (Batch 3); new `f555ae393` (docs, Batch 3 revision record).
- Conflict: `libs/backend/memory-contracts/CLAUDE.md` (docs), both sides kept.
- Semantic break fixed in `ab7cf6977` (`test(memory-curator): drop the salience scorer argument from specs rebased
  onto PR 513`): the #513 harnesses `memory-curator.admission.spec.ts` and `memory-curator.service.spec.ts` still
  passed the removed `SalienceScorer` constructor argument.
- Post-fix checks (orchestrator): typecheck 7 projects green; tests 7 projects green (platform-core bench flaked once
  in parallel, passed on rerun, R-TL8); lint 0 errors; removed-symbol grep clean; better-sqlite3 via Electron:
  memory-curator 152/152, `0044_memory_lifecycle.spec.ts` 6/6.
- `rebase-report.md` records an earlier intermediate rebase onto `bd149c305`; the orchestrator's final base is
  `9ec3b26e7` and the SHAs above are the final ones.
- What #513 changed under Batches 5-7 (team-leader verified on disk at `ab7cf6977`):
  - `memory-retention.service.ts` is 786 lines. Constructor `:149-167` has a 7th OPTIONAL, LAST param
    `@inject(TOKENS.BACKGROUND_WORK_GOVERNOR, { isOptional: true }) governor: BackgroundWorkAdmission | null = null`.
  - `execute` `:310-489`: `msLeft` `:319`, `rowsUsed` `:334-335`, `hardStop` `:337-345`, `adaptBatch` `:346-354`,
    `governorWarned` + `yieldGovernor` `:356-365` (governor wait, then `hardStop()`; `'aborted'` wins). Each write batch
    is `hardStop()` -> row room -> `await yieldGovernor()` -> batch (purge `:373-399`, quarantine `:408-434`, ledger
    prune `:441-452`). `continueAfterRows` `:439`; reclaim `:455-466` calls `reclaimPages(hardStop, tally,
    yieldGovernor)` `:492-542` (a reclaim stop sets `stop` only if still null, so `row-budget` is kept); catch
    `:467-476`; `finish(...)` `:478-488`.
  - `yieldToGovernor(signal, warned, msLeft)` `:554-591`: fast path when no governor or clear; `maxDeferMs =
    max(1, msLeft())`, skipped when the deadline passed; `AbortError` -> `'aborted'`; any other rejection fails open
    with ONE warn per run, annotated `// degradation-audit: reported - ...` (`:576`).
  - `storageHealth()` `:211` sanitizes `readErrors` with `sanitizeRetentionError` at its return; `readSettings`
    `:738-747`; `toRunDto` `:749`.
  - `thoth-runtime/src/lib/memory-retention-job.ts` resolves service, power monitor and foreground reader inside ONE
    guarded block (skip on failure).
  - `memory-curator.service.ts` gained curator pass admission + network back-off (`CuratorPassAdmission`).
  - `tools/degradation-audit/baseline.json:21` pins `libs/backend/memory-curator` at 20.

Second rebase onto PR #513 `01b155b77` (2026-09-15, orchestrator; #513 CI fully green there):

- `git rebase --onto 01b155b77 9ec3b26e7`, NO conflicts. New head `c31c06959`. Old -> new (every older SHA in this file
  is pre-rebase): `489fe26f6` -> `052965c4b` (docs); `a1f173a5d` -> `5d1685b72` (Batch 2); `01402b3b3` -> `24f0fa0b4`
  (Batch 1); `88797e8d2` -> `b1b362023` (Batch 4); `2ed2f95d5` -> `36d6e8486` (docs); `8866acec2` -> `29f7a602a`
  (Batch 3); `f555ae393` -> `a55f4fb42` (docs); `ab7cf6977` -> `29db8ca38` (test fix); `417251bc2` -> `77269e6d4`
  (docs); `c7f1f02a8` -> `b1712f35d` (Batch 5); `4c970cce5` -> `c31c06959` (docs).
- Checks on `c31c06959` (orchestrator): memory-curator test / typecheck / lint for 1 project green (627 passed, 59
  skipped pre-existing; lint 0 errors / 5 warnings); `degradation-audit:lint` exit 0, memory-curator 20/20;
  better-sqlite3 run (Batch 5 pattern) 43 suites, 686/686. #513's broader POSIX + home-directory sanitizer rules and
  its multi-batch governor and sanitize specs pass against `RetentionRunBudget` unchanged.
- Rebased `memory-retention.service.ts` (team-leader, on disk at `c31c06959`): 702 lines; `sanitizeRetentionError`
  `:91`; constructor `:142-160` (optional governor last, `:159`); `storageHealth()` `:204-...` (local `readErrors`
  `:205`, sanitized at the return `:260-261`); `execute` `:303`; `new RetentionRunBudget({...})` `:319`; quarantine
  step `:374`; `continueAfterRows` `:409`; ledger prune `:411-422`; reclaim `:424-432`; catch `:433-443`;
  `return this.finish(...)` `:444`; `reclaimPages` `:458`; `finish` `:510` (sanitizes failure text `:531`); `writeRun`
  `:610`; `readSettings` `:654`; `toRunDto` `:665`. `'memory-row-budget'` already exists in
  `memory-retention.types.ts:36`. Positional `new MemoryRetentionService(` sites: `memory-retention.service.spec.ts:296`
  and `memory-retention.integration.spec.ts:87` only.

Upstream status (2026-09-16, orchestrator):

- TASK_2026_440_834c (phase 1) is MERGED into main via PR #513 (merge commit `dbffc1938`; `01b155b77` is an ancestor of
  `origin/main`). `origin/main` has since advanced with #518 (TASK_2026_437 main-loop isolation) and #519. The
  orchestrator rebases phase 2 onto `origin/main` after Batch 6 is committed and before Batch 7 starts; Batch 7's line
  references are re-anchored then.
- TASK_2026_446_198a (memory-curator `*.test-support.ts` exclude) is SATISFIED by Batch 5 (`b1712f35d`,
  `tsconfig.lib.json`); its carrier status is set to `done` in this branch.

Third rebase onto `origin/main` (2026-09-16, orchestrator; main includes #513 `dbffc1938`, #518, #519):

- `git rebase origin/main` from `de5fcd6fc`, NO conflicts. New head `a3b2d7c71`. Main's changes since the #513 head
  touch only agent-sdk history helpers and shared rpc-chat / rpc-session types; nothing in memory-curator, thoth-runtime,
  cli-engine, persistence-sqlite or memory-curator-ui.
- Old -> new (every older SHA in this file is pre-rebase): `052965c4b` -> `c395669db` (docs); `5d1685b72` -> `042a25c09`
  (Batch 2); `24f0fa0b4` -> `1cdd777de` (Batch 1); `b1b362023` -> `54d69f619` (Batch 4); `36d6e8486` -> `5dae69c5e`
  (docs); `29f7a602a` -> `fa42f83b2` (Batch 3); `a55f4fb42` -> `c9cefccdf` (docs); `29db8ca38` -> `301909f59` (test
  fix); `77269e6d4` -> `54e77851a` (docs); `b1712f35d` -> `75a8d90ec` (Batch 5); `c31c06959` -> `9718d68b8` (docs);
  `15e0be5da` -> `055a29495` (docs); `2938d0727` -> `83acc8444` (docs); `cce109a0f` -> `82410f33d` (Batch 6);
  `de5fcd6fc` -> `a3b2d7c71` (docs).
- Checks on `a3b2d7c71` (orchestrator): typecheck 9 projects green (memory-curator, shared, memory-curator-ui,
  rpc-handlers, thoth-runtime, cli-engine, agent-sdk, vscode-lm-tools, persistence-sqlite); test 11 projects (the 9 +
  ptah-electron + ptah-extension-vscode) with `--parallel=2`: 10 green, memory-curator 1 failed test in
  `memory-retention.integration.spec.ts` (suite 73.4 s under load); memory-curator alone re-run 643 passed / 59 skipped
  (pre-existing), green. `degradation-audit:lint` exit 0 (memory-curator 20/20); better-sqlite3 run 43 suites, 702/702.
  This is R-TL11 (risk table), handled by Task 7.4.
- Re-anchored on disk at `a3b2d7c71` for Batches 7-8: `thoth-runtime/src/lib/memory-retention-job.ts` 127 lines, summary
  literal `:98` (partial suffix `:100-103`); `start-thoth-cron.spec.ts` `describe('memory retention job')` `:787`
  (handler-reaches-run test `:860`); `cli-engine/src/lib/bootstrap/thoth-runtime.spec.ts`
  `describe('memory retention job (TASK_2026_440 reachability)')` `:456` (reaches-run `:489`, oneshot `:588`);
  `thoth-runtime/CLAUDE.md` retention bullet `:48`; storage panel 352 lines ("Last retention run" `<dl>` `:214-223`,
  "Retention settings" `<dl>` from `:245`); accordion 347 lines (decay tile `:61-66`, `lastDecay` `:226`,
  `lastDecayLabel` `:242-243`); state service 157 lines (`:30`, `:41`, `:68-70`); event feed `:159`.

Cross-batch rule XB2 (added 2026-09-15 with the rebase, binding for Batches 5-10):

- Every NEW `catch` (or `.catch`) that fails open, swallows, or returns a sentinel or default MUST carry a
  `// degradation-audit: optional-capability - <reason>` or `// degradation-audit: reported - <reason>` comment inside
  it (format: `tools/degradation-audit/check-degradation.ts:27-46`; example `memory-retention.service.ts:576`). The
  per-lib baseline must not grow. Every batch that adds or moves such a catch runs `npx nx run degradation-audit:lint`
  (exit 0) and reports it; reviewers reject an unannotated fail-open catch.

Cross-batch rule XB3 (governor, binding for Batches 5-7):

- Every lifecycle write batch (age delete, archive, cap evict) waits on the background-work governor BEFORE the
  batch, exactly like the queue steps: `hardStop()` -> row room -> governor wait (budget-capped `maxDeferMs`) ->
  batch. `'aborted'` from the wait ends the step with `stop = 'aborted'`. Preview reads are not write batches and do
  not wait.

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
| R-TL11 (added 2026-09-16) `memory-retention.integration.spec.ts` (real SQLite + sqlite-vec) is slow (73.4 s under `--parallel=2`) and failed once under load; CI runs affected tests with `--maxWorkers=2` across many projects, so a CI flake is likely | MEDIUM | Task 7.4: find the slow cases, keep every assertion, make the suite load-robust, prove it under parallel load |
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

## Batch 3: memory-curator — ranking-only salience + explicit use recording — COMPLETE (commit d85851962)

- Recommended executor: codex CLI lane (`cli: 'codex'`, role backend-developer)
- Fallback executor: backend-developer subagent
- Execution mode: sequential (Components 2 and 3 share `memory.store.ts`, `memory-search.service.ts`, `di/register.ts`)
- Parallel with: Batch 4 (file-disjoint)
- Rationale: cross-file refactor in one lib with real-SQLite specs; one lane, in order.
- Reviewer: Ollama Cloud lane, code-logic-reviewer -> `code-logic-review-batch-3.md`
- Suggested commit: `feat(memory-curator): batch 3 - rank by salience at query time and record memory use explicitly`
- Tasks: 3 | Depends on: Batch 1 (column `archived_at`), Batch 2 (port + token)

### Task 3.1: Ranking module replaces `SalienceScorer`; three ranked reads; curator stores a base — COMPLETE

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

### Task 3.2: `recordUse` replaces `recordHit`; search loses its hidden write; archival restore — COMPLETE

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

### Task 3.3: Electron wizard-seed integration DDL gains `archived_at` — COMPLETE

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

### Batch 3 revision 1 fix list (resume codex session 01a0a611-011c-7982-ad80-e9fd405f9acf) — COMPLETE (in d85851962)

- Team-leader diff read: only `register.spec.ts` and `memory.store.spec.ts` are newer than the review. M1: both
  recorder token spellings `toBe` the resolved `MEMORY_STORE` (spec registers the existing `NoopTracer` under
  `PLATFORM_TOKENS.TRACER` so the store resolves); m2: real-SQLite case, core + pinned recall keep tier, hits 1,
  `last_used_at` in window, write counters 0. Re-run: test 2 projects (memory-curator 554 passed / 59 skipped
  pre-existing; ptah-electron 553 passed / 4 skipped), memory-curator typecheck green, lint 0 errors / 5 warnings;
  removed-symbol grep: only the negative `Symbol.for('PtahMemorySalienceScorer')` assertion; Electron better-sqlite3
  run on the four suites: 4 suites / 83 passed. Note for later XB1 runs from PowerShell: quote a `|` pattern as
  `'"a|b"'`, otherwise `electron.cmd` treats `|` as a pipe and exits 255 with no output.
  Committed with only the 17 Batch 3 paths; no re-review (spec-only revision).

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

## Batch 5: memory-curator — lifecycle store, run budget, lifecycle service, settings, DI, vec harness — COMPLETE (commit c7f1f02a8, pre-#513-01b155b77 rebase)

- Recommended executor: codex CLI lane (`cli: 'codex'`, role backend-developer)
- Fallback executor: backend-developer subagent
- Execution mode: sequential (store -> budget -> service; shared `di/*`, `memory.store.ts`, harness)
- Parallel with: none in memory-curator (may overlap only Batch 4)
- Rationale: destructive SQL with plan assertions on real SQLite + sqlite-vec; design-sensitive, one lane.
- Reviewer: Ollama Cloud lane, code-logic-reviewer -> `code-logic-review-batch-5.md`
- Suggested commit: `feat(memory-curator): batch 5 - memory lifecycle store, run budget and lifecycle service`
- Tasks: 3 | Depends on: Batch 3 (Batch 1, 2 transitively) and the #513 rebase (`ab7cf6977`)
- Scope change after the rebase (team-leader): Task 5.1 now also moves `MemoryRetentionService.execute` onto
  `RetentionRunBudget` (behaviour-preserving; the governor wait moves into the budget). A budget-only Batch 5 would
  leave a second copy of `yieldToGovernor` for one commit; the swap also brings `memory-retention.service.ts` back
  under the 700 soft ceiling before Batch 6 adds the lifecycle call.

### Task 5.1: Vec-capable test harness + `RetentionRunBudget` (absorbs the governor wait) + limits + tsconfig exclude + service swap — COMPLETE

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
  - MODIFY `src\lib\retention\memory-retention.service.ts` and `memory-retention.service.spec.ts` (service swap below)
- Plan reference: implementation-plan.md:534-541, 573-580, 761-773. AMENDED by the rebase: the plan predates the
  governor, and this task text wins where they differ.
- Pattern to follow (rebased `memory-retention.service.ts` at `ab7cf6977`): `msLeft` `:319`, `rowsUsed` `:334-335`,
  `hardStop` `:337-345`, `adaptBatch` `:346-354`, `governorWarned`/`yieldGovernor` `:356-365`, `yieldToGovernor`
  `:554-591`, per-batch order in purge `:373-399` / quarantine `:408-434` / ledger `:441-452`, `reclaimPages`
  `:492-542`.
- `RetentionRunBudget` design (plain class, constructed once per run by `execute`, not in DI):
  - Constructor takes ONE options object: `{ options: MemoryRetentionRunOptions, limits: MemoryRetentionLimits,
    now: () => number, startedAt: number, logger: Logger, governor: BackgroundWorkAdmission | null, queueBatchSize:
    number, archiveBatchSize: number, deleteBatchSize: number }`. The governor lane stays the constant the service
    uses today (`GOVERNOR_LANE`): move or export it, never duplicate the literal.
  - `msLeft(): number` (deadline `startedAt + limits.maxRunMs`); `hardStop(): RetentionStopReason | null`, same order
    as `:337-345` (abort -> battery -> foreground -> `time-budget`).
  - `waitForGovernor(): Promise<RetentionStopReason | null>`: the MOVED body of `yieldToGovernor` + `yieldGovernor`.
    No governor or `isClear()` -> no wait; `msLeft() <= 0` -> no wait; else `governor.whenClear({ signal, lane,
    maxDeferMs: Math.max(1, msLeft()) })`. `AbortError`, or `signal.aborted` after the wait -> `'aborted'`. Any other
    rejection -> ONE `warn` per budget instance (= per run) and continue, keeping the
    `// degradation-audit: reported - ...` annotation (XB2). Otherwise return `hardStop()`.
  - Row budgets: `queueRowRoom()` / `consumeQueueRows(n)` (`limits.maxRowsPerRun`) and `memoryRowRoom()` /
    `consumeMemoryRows(n)` (`limits.maxMemoryRowsPerRun`), independent.
  - `batchSize(kind: 'queue' | 'archive' | 'delete')`; `observe(kind, durationMs)` halves that kind above
    `slowCallMs`, floor `minBatchSize`, with the same debug log as `adaptBatch`.
  - `yieldToEventLoop(): Promise<void>` via `setImmediate` (reuse the existing helper; never add a second one).
- Service swap (behaviour-preserving): `execute` builds ONE budget (`queueBatchSize = settings.batchSize`,
  `archiveBatchSize = settings.batchSize`, `deleteBatchSize = limits.memoryDeleteBatchSize`). Purge and quarantine run
  `hardStop()` -> `queueRowRoom()` -> `waitForGovernor()` -> batch -> `observe('queue', ...)` -> `consumeQueueRows`.
  Ledger prune runs `hardStop()` then `waitForGovernor()`. `reclaimPages(budget, tally)` uses `budget.hardStop()` and
  `budget.waitForGovernor()`; reclaim step halving stays in `reclaimPages`. DELETE the closures `:319-365`,
  `adaptBatch` and the private `yieldToGovernor` `:554-591` from the service. Reason precedence unchanged (a reclaim
  stop sets `stop` only if still null). Constructor unchanged in Batch 5.
- Validation notes: every existing `memory-retention.service.spec.ts` case, including the #513 governor cases (wait
  before each batch, `maxDeferMs` capped by the remaining budget, AbortError -> `partial` / `aborted`, fail-open warn
  once per run), must pass WITHOUT weakening any assertion. If a spec reached a removed private, re-point it at the
  budget and say so in the report. `memory-retention.service.ts` must end <= 700 lines (report `wc -l`).
- Acceptance (`retention-run-budget.spec.ts`, fake clock + fake governor):
  - stop order; per-kind halving and floors independent across `queue` / `archive` / `delete`; queue and memory row
    budgets independent; `yieldToEventLoop` resolves via `setImmediate`;
  - GOVERNOR: no governor -> resolves with no call; clear governor -> `whenClear` not called; busy governor ->
    `whenClear` called with the lane and `maxDeferMs === Math.max(1, msLeft())`, pinned at two elapsed times (e.g.
    1,000 ms and 59,500 ms into a 60,000 ms budget); deadline passed -> `whenClear` not called and the result is
    `'time-budget'`; `whenClear` rejects `AbortError` -> `'aborted'`; rejects another error twice in one budget ->
    `hardStop()` result both times and exactly ONE `warn`; a new budget instance warns again.

### Task 5.2: `MemoryLifecycleStore` — COMPLETE

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

### Task 5.3: `MemoryLifecycleService` + `memory-lifecycle-config.ts` + `markWorkspacesChanged` + DI — COMPLETE

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
  `MemoryRetentionService.readSettings` `:738-747` (rebased)
- Quality requirements: 5 injected deps exactly (logger, workspace provider, lifecycle store, memory store, limits);
  step order disabled-check -> `canDelete` -> age delete -> archive -> cap (archival with grace first, then recall
  only when `recallEvictable > cap`, excess recomputed from returned counts) -> preview (always unless a hard stop
  ended the step; `forRunAt = nowMs + limits.intervalMs`) -> `markWorkspacesChanged(union of roots)`; each loop
  `hardStop()` -> `memoryRowRoom()` (0 -> `stop = 'memory-row-budget'`) -> `await budget.waitForGovernor()` (XB3;
  any non-null result, including `'aborted'`, ends the step with that stop) -> one batch -> `observe` -> `consume` ->
  `yieldToEventLoop`; `vec-unavailable` warns once per run and leaves `exhausted` true; clamps: archiveAfterDays 7-365,
  deleteAfterDays 7-730, maxPerWorkspace 1,000-1,000,000; settings read failure -> defaults + `warn`.
- Validation notes: `'memory-row-budget'` is added to `RetentionStopReason` in Batch 6; in Batch 5 declare the step
  result's `stop` type so it compiles now (e.g. add the member to `memory-retention.types.ts` here if needed — if
  so, list that file in the report; Batch 6 then only uses it).
- Acceptance (`memory-lifecycle.service.spec.ts`, fake store + clock): step order; disabled -> no writes, preview
  recorded, note `disabled`, exhausted true; vec-unavailable -> archive only + note + exhausted true; row budget ->
  `stop = 'memory-row-budget'`, exhausted false; hard stop mid-step -> no preview; cap order + recall-alone rule;
  grace cutoff passed to the store; `markWorkspacesChanged` receives the union; settings parity: each default
  equals `FILE_BASED_SETTINGS_DEFAULTS` from `@ptah-extension/platform-core`; clamps; GOVERNOR (XB3): with a busy
  governor, no store batch method is called until `whenClear` resolves, and the wait happens once before EACH delete,
  archive and evict batch (count them against batch calls); `AbortError` from the wait mid-step -> `stop =
  'aborted'`, no further batch, no preview; preview reads do not wait. A settings-read catch that falls back to
  defaults carries `// degradation-audit: optional-capability - ...` (XB2).
- Commands (from `W`), for the whole batch:
  - `npx nx run-many -t test -p @ptah-extension/memory-curator` — "for 1 project" (R-TL8 re-run rule applies)
  - `npx nx run-many -t typecheck -p @ptah-extension/memory-curator` — 1 project
  - `npx nx run-many -t lint -p @ptah-extension/memory-curator` — 1 project
  - report the count of skipped tests in the new specs (must be 0)
  - XB2: `npx nx run degradation-audit:lint` (exit 0)
  - XB1 better-sqlite3 run, from `W` in PowerShell (the `|` pattern MUST be double-quoted inside single quotes):
    `$env:ELECTRON_RUN_AS_NODE='1'; & 'D:\projects\ptah-extension\node_modules\.bin\electron.cmd' 'D:\projects\ptah-extension\node_modules\jest\bin\jest.js' --config libs/backend/memory-curator/jest.config.ts --testPathPatterns '"memory-lifecycle|retention-run-budget|memory-retention|observation-retention|di/register.spec|memory.store.spec"' --runInBand`
  - `wc -l libs/backend/memory-curator/src/lib/retention/memory-retention.service.ts` (<= 700)
- Report: `W\.ptah\specs\TASK_2026_443_40ec\batch-5-report.md`

### Batch 5 revision 1 fix list (resume codex session 01a0a68d-0d3f-72f3-b6e0-ae66a9d0f132) — COMPLETE (in c7f1f02a8)

- Team-leader diff read: M1 singleton `readErrors` field deleted; `overCapWorkspaces` returns `{ workspaces,
  readErrors }` and `readPreview` returns counts + its own `readErrors` from local arrays; `overCap` null only when its
  own read failed; `MemoryLifecycleStepResult.readErrors` always present and fed by cap + preview reads. M2 store and
  service read-failure specs added. m4 dead reassignment gone (recall still decided from `recallEvictable`). m5 doc
  paragraph restored. Every SQL constant in `memory-lifecycle.store.ts:11-60` still matches plan :442-503; the batch
  methods, `deletePair` and `inTransaction` are unchanged in shape; `memory-retention.service.spec.ts` untouched. No
  second review (diagnostics path only).
- Team-leader re-run: memory-curator test 1 project 623 passed / 59 skipped (pre-existing; 0 skip markers in the new
  specs); typecheck + lint green (0 errors, 5 pre-existing warnings); `degradation-audit:lint` exit 0, memory-curator
  20 ok (baseline 20); better-sqlite3 via Electron 43 suites / 682 passed; `memory-retention.service.ts` 700 lines.
  Committed with only the 18 Batch 5 files (11 modified, 7 new).

- Review (Ollama Cloud, `code-logic-review-batch-5.md`): APPROVED 8/10, 0 blocking/serious, 2 moderate, 3 minor.
  All nine confirmation items CONFIRMED: the swap preserves behaviour (`memory-retention.service.spec.ts` unchanged,
  all seven #513 governor cases intact), the store SQL matches the plan, exemptions are in every predicate, AC2 counts
  from `archived_at`, XB1/XB2/XB3 hold, and the destructive-safety sweep found no defect.
- Team-leader decision: NOT committed until M1, M2, m4 and m5 are fixed. Reasons:
  - M1 is a real defect, not just a diagnostics nicety. `readErrors` is a field on a DI SINGLETON
    (`memory-lifecycle.store.ts:124`) that only grows, one entry per failed read, for the life of the Electron
    process. Batch 6 feeds lifecycle read errors into `storageHealth()`, so stale entries would reach the panel as if
    current. `readPreview` also decides `overCap` by comparing the singleton array's length before and after
    (`:262-264`), which breaks as soon as anything else pushes to it.
  - M2: `overCapWorkspaces` failing returns `[]`, which makes the cap step do nothing. That is the safe direction for
    deletes, but it is unpinned, so a regression that turns a read failure into `0` (or into a thrown write) passes
    the suite. Deletion-adjacent code gets the Batch 3/4 precedent.
  - m4 (dead reassignment in the cap loop) and m5 (a deleted accurate doc paragraph) are cheap and in files this
    revision already touches.
  - m3 (`canDelete()` lets a `connection.db` throw propagate) is ACCEPTED here and CARRIED into Task 6.1 as an
    acceptance item: the retention run must map that throw to `failed`, release the single-flight flag, and run no
    lifecycle batch.
- Scope: only the Batch 5 files listed below. Do not touch `memory-retention.service.spec.ts` (PR #513 rebase is
  pending on it).

1. M1 — replace the singleton `readErrors` field with per-call results, following the precedent
   `observation-retention.store.ts:224,424` (a local array returned in the result object):
   - `overCapWorkspaces(cap)` returns `{ workspaces: readonly OverCapWorkspace[]; readErrors: readonly string[] }`.
   - `readPreview(...)` returns its counts plus `readErrors: readonly string[]` built from a local array; `overCap` is
     `null` exactly when its own over-cap read failed (decided from the local result, not an array length).
   - Delete the `readErrors` class field. `MemoryLifecycleService` passes the preview's `readErrors` out in
     `MemoryLifecycleStepResult` (add `readErrors: readonly string[]`, always present, empty when none) so Batch 6 can
     surface them; a failed `overCapWorkspaces` in the cap step also contributes its message to that array.
   - Keep the XB2 annotations on every catch you move.
2. M2 — specs:
   - `memory-lifecycle.store.spec.ts` (real SQLite): force each read to fail (for example drop or rename
     `corpus_memories` inside the spec DB, or close the handle; bind every parameter, XB1) and assert
     `overCapWorkspaces` returns `workspaces: []` plus one message; `readPreview` returns `null` for exactly the
     failed counts (not `0`) and one message per failed read; a second call after the DB is repaired returns
     `readErrors: []` (proves no carry-over).
   - `memory-lifecycle.service.spec.ts` (fakes): an `overCapWorkspaces` failure makes the cap step run no evict batch,
     does not throw, keeps `exhausted` as the rest of the step decides, and puts the message in the step result's
     `readErrors`; a preview read error reaches the step result.
3. m4 — `memory-lifecycle.service.ts:151-162`: drop the unused reassignment of `archivalExcess` (do not change the
   approved AC4 rule: recall eviction is still decided from `recallEvictable` alone).
4. m5 — restore the accurate doc paragraph about the hourly cron tick that the swap removed from
   `memory-retention.service.ts` (text only; the file must stay <= 700 lines).
5. XB1 and XB2 as before.
- Commands (from `W`): `npx nx run-many -t test -p @ptah-extension/memory-curator` (1 project); typecheck and lint
  (1 project each); `npx nx run degradation-audit:lint` (exit 0); the quoted better-sqlite3 run from Batch 5's
  command list; `wc -l` of `memory-retention.service.ts`.
- Report: append `## Revision 1` to `batch-5-report.md` with the diff summary, all command results and `git diff
  --stat`. Write `batch-5-r1.done` last. Do not edit `batches.md`. Do not commit.
- Acceptance by team-leader: diff read against items 1-4 plus a full re-run. Items 1-2 change production code on the
  diagnostics path only (no delete, archive or exemption SQL may change); if any lifecycle SQL constant or delete
  path changes, a second review round is required.

### Batch 5 verification

- XB1: every spec that prepares SQL binds every named and positional parameter (passes under better-sqlite3 and node:sqlite).
- Store, budget, service, config, harness, exclude on disk; vec loads (0 skipped); plan assertions pass; reviewer
  accepts. TASK_2026_446_198a closable after commit.
- XB2: degradation-audit lint exit 0; every new or moved fail-open catch annotated. XB3: governor wait before every
  lifecycle batch pinned by spec; the service swap keeps every #513 governor spec green unchanged.

---

## Batch 6: retention integration + shared DTO + REACHABILITY PROOF (DI reach, real-SQLite integration) — COMPLETE (commit cce109a0f, pre-origin/main rebase)

- Recommended executor: codex CLI lane (`cli: 'codex'`, role backend-developer)
- Fallback executor: backend-developer subagent
- Execution mode: sequential (service change -> DTO -> DI reach -> integration)
- Parallel with: none
- Rationale: couples producer, wire DTO and typed fixtures in one commit (Deviations 1-2); carries two of the four
  blocking reach proofs.
- Reviewer: Ollama Cloud lane, code-logic-reviewer -> `code-logic-review-batch-6.md`. The reviewer must run the
  mutation checks listed in Tasks 6.3 and 6.4 (or read the executor's evidence of them) before accepting.
- Suggested commit: `feat(memory-curator,shared): batch 6 - run the memory lifecycle inside memory retention`
- Tasks: 4 | Depends on: Batch 5 (`b1712f35d`) on the `01b155b77` rebase (head `c31c06959`)

### Task 6.1: `MemoryRetentionService` runs the lifecycle step; run record + report + storage health — COMPLETE

- Dir: `W\libs\backend\memory-curator\src\lib\retention\`
  - MODIFY `memory-retention.service.ts` (already on `RetentionRunBudget` after Task 5.1): inject
    `MEMORY_TOKENS.MEMORY_LIFECYCLE_SERVICE` as the 7th param, BEFORE the optional governor, which stays LAST and
    optional (8 params; update the two positional sites `memory-retention.service.spec.ts:296` and
    `memory-retention.integration.spec.ts:87`); constructor at `:142-160`; after quarantine (quarantine step `:374`), when
    `stop === null || stop === 'row-budget'`, `await lifecycle.runStep(budget, startedAt)` with the SAME budget, so the
    lifecycle obeys the run's governor wait, wall budget and `maxDeferMs` cap (XB3); its `stop` sets the run's stop if
    still null; ledger prune + reclaim keep their `continueAfterRows` condition (`:409`, ledger `:411-422`, reclaim
    `:424-432` at `c31c06959`); `completed` (decided in `finish` `:510`) also requires `exhausted`; `writeRun` gets counters, note, preview; `storageHealth()` (`:204`) adds `memoryLifecycle`
    from live settings + state row (no memory-table query); the last run's lifecycle `readErrors` are appended to its
    local `readErrors` (`:205`) so they leave through the existing `sanitizeRetentionError` map (`:260-261`).
  - MODIFY `memory-retention.types.ts` (`'memory-row-budget'` already present at `:36`;
    `MemoryRetentionRunReport` + `memoriesArchived`, `memoriesDeleted`, `memoriesEvicted`, `lifecycleNote`)
  - MODIFY `observation-retention.store.ts` (`RetentionRunRecord` / `RetentionState` / `WRITE_RUN_SQL` /
    `READ_STATE_SQL` + nine 0044 columns; preview `null` keeps the previous value, same rule as
    `avg_processed_row_bytes`) and `observation-retention.store.spec.ts`
  - MODIFY `memory-retention.service.spec.ts` (update the `new MemoryRetentionService(` site)
- Plan reference: implementation-plan.md:607-632
- Carried from `code-logic-review-batch-5.md` m3: a throw from `MemoryLifecycleStore.canDelete()` (for example
  `connection.db` unavailable) inside `runStep` ends the run `failed`, releases the single-flight flag and dispatches
  no lifecycle batch; pin it in `memory-retention.service.spec.ts`. The step result's `readErrors` (Batch 5 revision 1)
  feed `storageHealth()` through `sanitizeRetentionError`.
- Quality requirements: `run` still never rejects; flag cleared in `finally`; lifecycle `RetentionStepError`
  goes through the existing catch (`:433-443`; busy -> `partial`, else `failed`; failure text sanitized in
  `finish` `:531`); file stays <= ~720 lines (R-TL10; 702 before this batch — if it passes 720, move a nameable
  piece such as the `storageHealth` mapping behind the facade rule rather than compressing code); `memoryLifecycle` read errors go through the same `sanitizeRetentionError` mapping as
  `readErrors`; XB2 annotations on any new fail-open catch.
- Acceptance (service spec, fakes): lifecycle called once per executed run with a `RetentionRunBudget` and a number;
  NOT called for any skip gate (each gate a case); called after a queue `row-budget` stop; not called after
  `time-budget`; `partial` when not exhausted with the lifecycle stop token; counters persisted; preview `null`
  keeps previous; `storageHealth().memoryLifecycle` shape; GOVERNOR (XB3): the lifecycle receives the run's budget
  (assert identity); a busy fake governor holds the first lifecycle batch until clear; `AbortError` during a lifecycle
  wait ends the run `partial` with `stop = 'aborted'` and no ledger prune or reclaim dispatch after it.

### Task 6.2: Shared wire DTO additions + typed frontend fixture patch — COMPLETE

- Depends on: Task 6.1
- Files:
  - MODIFY `W\libs\shared\src\lib\types\rpc\rpc-curator-diagnostics.types.ts`: `MemoryRetentionRunDto` +
    `memoriesArchived`, `memoriesDeleted`, `memoriesEvicted` (required numbers); new `MemoryLifecyclePreviewDto`;
    `MemoryStorageHealthDto.memoryLifecycle` (required) exactly as plan :663-686. Do NOT remove `lastDecay*` or
    `'decay-run'` here (Batch 9).
  - MODIFY `memory-retention.service.ts` `toRunDto` (`:665` at `c31c06959`) to map the three counters (same file as 6.1).
  - MODIFY fixture fields only (Deviation 2):
    `W\libs\frontend\memory-curator-ui\src\lib\components\diagnostics\storage-health-panel.component.spec.ts`
    (factory :12-50) and `...\memory-diagnostics-accordion.component.spec.ts` (literal near :144).
- Plan reference: implementation-plan.md:655-692
- Validation notes: no RPC method added, so no `rpc.types.ts` method map or `ALLOWED_METHOD_PREFIXES` change.

### Task 6.3: REACHABILITY PROOF — DI graph wires the lifecycle into the registered retention service — COMPLETE

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
- Mutation check (executor runs and reports; nothing committed): temporarily remove the `runStep` call in
  `execute`, run only this spec, confirm it FAILS, restore, confirm it passes; `git diff` of the service identical to
  the intended change afterwards.

### Task 6.4: REACHABILITY PROOF — real SQLite + sqlite-vec integration through `MemoryRetentionService.run` — COMPLETE

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
  - XB2: `npx nx run degradation-audit:lint` (exit 0; memory-curator stays at baseline 20)
  - XB1 better-sqlite3 run, from `W` in PowerShell (keep the double quotes inside the single quotes):
    `$env:ELECTRON_RUN_AS_NODE='1'; & 'D:\projects\ptah-extension\node_modules\.bin\electron.cmd' 'D:\projects\ptah-extension\node_modules\jest\bin\jest.js' --config libs/backend/memory-curator/jest.config.ts --testPathPatterns '"memory-lifecycle|retention-run-budget|memory-retention|observation-retention|di/register.spec|memory.store.spec"' --runInBand`
  - `wc -l libs/backend/memory-curator/src/lib/retention/memory-retention.service.ts`
- Report: `W\.ptah\specs\TASK_2026_443_40ec\batch-6-report.md` (include every mutation-check output). Write
  `batch-6.done` in the task folder as the LAST step. Create no other file in the task folder.

### Batch 6 revision 1 fix list (resume the Batch 6 codex session) — COMPLETE (in cce109a0f)

- Team-leader diff read: M1 `reopenWithoutForeignKeys()` (reloads vec, sets `foreign_keys = OFF`, reads it back,
  throws unless 0) + a committed FK-off T0+61 d integration case through `MemoryRetentionService.run` asserting 0
  memories / chunks / concepts / FTS docsize / vec rowids per deleted id and intact survivors; mutation (only the
  `DELETE_CHUNKS_SQL` `.run` call removed) FAILED (expected 0, received 2) and was restored. m2
  `lifecycleReadErrors = []` set before `runStep`, with a spec. m4 `toBe` identity between the queue phase's budget
  and the lifecycle's. `memory-lifecycle.store.ts` and `memory-lifecycle.service.ts` unchanged since `b1712f35d`
  (empty `git diff`); no second review.
- Team-leader re-run: test 6 projects green (memory-curator 643 passed / 59 skipped pre-existing; rpc-handlers 3002
  passed / 33 skipped pre-existing; shared 1520; memory-curator-ui 184; thoth-runtime 187; cli-engine 90); typecheck 6
  projects green; lint 3 projects 0 errors (warnings pre-existing); `degradation-audit:lint` exit 0, memory-curator 20
  (baseline 20); better-sqlite3 via Electron 43 suites / 702 passed; `memory-retention.service.ts` 663 lines,
  `memory-storage-health.ts` 158 lines. Committed with only the 14 Batch 6 files (13 modified + the new
  `memory-storage-health.ts`).

- Report (`batch-6-report.md`): 6-project test / typecheck green, 3-project lint green, degradation-audit 20/20,
  better-sqlite3 700/700, both reach suites 19/19 with 0 skipped, facade 662 lines. Mutation A (remove `runStep`)
  failed both reach specs as required. Mutation B (remove the explicit chunk DELETE) was masked by the FK cascade and
  failed only with foreign keys switched off for that one uncommitted run.
- Review (Ollama Cloud, `code-logic-review-batch-6.md`): APPROVED 8/10, 0 blocking/serious, 1 moderate, 3 minor.
  Reachability, AC2 at T0+30 d / T0+61 d, Task 6.1 wiring, carried m3, `storageHealth()` sanitizing and XB1/XB2 all
  CONFIRMED.
- Deviations ACCEPTED by team-leader:
  - `retention/memory-storage-health.ts` (158 lines) extracted under the facade rule; reviewer verdict CORRECT (one
    nameable concern, public class / token / signatures unchanged; service now 662 lines). It joins the Batch 6 commit.
  - `libs/backend/thoth-runtime/src/lib/memory-retention-job.spec.ts` fixture fields for the newly required report
    counters (fixture only; forced by the typed factory). It joins the Batch 6 commit; Batch 7 edits the same file
    after it.
- Team-leader decision: NOT committed until M1, m2 and m4 are fixed (Batch 3/4/5 precedent). Reasons:
  - M1 touches the "no orphan chunks" guarantee. The plan chose an explicit chunk DELETE precisely so correctness does
    not depend on `foreign_keys = ON` (plan Architecture decision, "Relying on the FK cascade alone" rejected). With
    every fixture on `foreign_keys = ON`, a chunk DELETE that is issued but deletes nothing (weakened predicate, bad
    bind) passes the whole suite.
  - m2 is a one-line correctness fix on the diagnostics channel; m4 is a one-assertion spec that pins the shared-budget
    rule XB3 depends on.
  - m3 (`nextDueAt` precedence for an unproducible state) ACCEPTED, no change.
- Scope: only Batch 6 files. No change to any SQL constant in `memory-lifecycle.store.ts`, to `deletePair` or to any
  delete / archive / evict path (otherwise a second review round).

1. M1 — `retention/retention-sqlite.test-support.ts`: add `reopenWithoutForeignKeys()` (mirrors `reopenWithoutVec`
   `:259-262`: close and reopen the same file, vec still loaded, `PRAGMA foreign_keys = OFF`, read the pragma back and
   throw if it is not 0). `retention/memory-retention.integration.spec.ts`: add one committed case that runs the
   T0 archive run, then reopens WITHOUT foreign keys and runs the T0+61 d delete run through
   `MemoryRetentionService.run`, asserting for every deleted id: 0 rows in `memories`, 0 in `memory_chunks`, 0 FTS
   docsize rows and 0 vec rowids (by chunk rowid), plus the survivor checks. Mutation check (report, not committed):
   remove the chunk DELETE from `deletePair`, this new case FAILS with FKs off; restore and show `git diff` is clean
   for `memory-lifecycle.store.ts`. XB1: bind every parameter.
2. m2 — `retention/memory-retention.service.ts:377-378`: set `this.lifecycleReadErrors = []` immediately BEFORE the
   `runStep` call (not only after it returns). Spec in `memory-retention.service.spec.ts`: a run whose lifecycle
   returns `readErrors: ['x']`, then a run whose lifecycle throws, then `storageHealth().readErrors` does not contain the
   sanitized `x`.
3. m4 — `memory-retention.service.spec.ts` (row-budget case or the budget-identity case): capture the budget the fake
   quarantine/queue phase observed (or expose it through the fake governor / fake store call) and assert
   `lifecycle.calls[0].budget` is `toBe` that same instance.
4. XB2: no new unannotated fail-open catch.
- Commands (from `W`): the Batch 6 command set unchanged (6-project test and typecheck, 3-project lint,
  `degradation-audit:lint`, the quoted better-sqlite3 run, `wc -l` of the service).
- Report: append `## Revision 1` to `batch-6-report.md` with the diff summary, all command results, the mutation
  output and `git diff --stat`. Write `batch-6-r1.done` LAST. Create no other file in the task folder. Do not edit
  `batches.md`. Do not commit. Never run `nx reset`.
- Acceptance by team-leader: diff read against items 1-3 plus a full re-run; no re-review while the diff stays in
  scope.

### Batch 6 verification

- XB1: every spec that prepares SQL binds every named and positional parameter (passes under better-sqlite3 and node:sqlite).
- Lifecycle step called from `execute`; closures gone; DTO fields present with producer; typed fixtures patched;
  two reach proofs pass and were shown to fail under mutation; 6-project runs green; reviewer accepts.

---

## Batch 7: REACHABILITY PROOF — Electron + CLI hosts reach the lifecycle; job summary; integration-suite load robustness — COMPLETE (commit d5cb191b4)

- Recommended executor: codex CLI lane (`cli: 'codex'`, role backend-developer)
- Fallback executor: backend-developer subagent
- Execution mode: sequential (summary first; both host specs assert its text)
- Parallel with: Batch 8 (file-disjoint: this batch edits `libs/backend/thoth-runtime`, `libs/backend/cli-engine` and,
  for Task 7.4 only, `libs/backend/memory-curator/src/lib/retention/memory-retention.integration.spec.ts` +
  `retention-sqlite.test-support.ts`; Batch 8 edits only `libs/frontend/memory-curator-ui`). Mutation checks edit
  memory-curator production files temporarily; memory-curator-ui does not compile memory-curator, so Batch 8 is
  unaffected.
- Rationale: the two host reach proofs the user named as blocking; production host code is unchanged by design.
- Reviewer: Ollama Cloud lane, code-logic-reviewer -> `code-logic-review-batch-7.md`
- Suggested commit: `test(thoth-runtime,cli-engine,memory-curator): batch 7 - prove both hosts reach the memory lifecycle step`
- Tasks: 4 | Depends on: Batch 6 (`82410f33d`) on the origin/main rebase (`a3b2d7c71`)

### Task 7.1: Retention job summary names memory counts + thoth-runtime CLAUDE.md — COMPLETE

- Files: MODIFY `W\libs\backend\thoth-runtime\src\lib\memory-retention-job.ts` (`:98` summary literal; keep the partial suffix `:100-103`;
  `purged <p> processed, quarantined <q> stuck, archived <a> / deleted <d> / evicted <e> memories, reclaimed <r> pages`),
  `memory-retention-job.spec.ts`, `W\libs\backend\thoth-runtime\CLAUDE.md` (retention job bullet `:48` names the lifecycle
  step and the new summary text)
- Plan reference: implementation-plan.md:694-708
- Validation notes: #513 moved service, power monitor and foreground reader resolution into ONE guarded block in
  `memory-retention-job.ts`; keep it and change only the summary text. The reach specs construct the real service in
  the Batch 6 constructor order (lifecycle 7th, governor optional 8th). No change to job id `@ptah/memory-retention`, name, handler name, cron `17 * * * *`, gating or
  failure channel; `start-thoth-cron.ts` and CLI `thoth-runtime.ts` production code stay untouched (plan :1014).

### Task 7.2: REACHABILITY PROOF — Electron host (`startThothCron`) — COMPLETE

- Depends on: Task 7.1
- File: MODIFY `W\libs\backend\thoth-runtime\src\lib\start-thoth-cron.spec.ts`, inside
  `describe('memory retention job')` (:787): new test
  `the registered handler runs the memory lifecycle step through a real MemoryRetentionService`
- Plan reference: implementation-plan.md:737-748 (exact construction)
- Test: register under `MEMORY_TOKENS.MEMORY_RETENTION_SERVICE` a REAL `MemoryRetentionService` (import from
  `@ptah-extension/memory-curator`) with a fake `ObservationRetentionStore` (purge `{ deleted: 0, exhausted: true }`,
  quarantine 0, `readState` null), fake reclaimer (`autoVacuumMode: 0`), `{ db: {} }` connection, defaults workspace
  provider, limits `{ ...MEMORY_RETENTION_LIMITS, bootDeferralMs: 0 }`, spy lifecycle
  `{ runStep: jest.fn().mockResolvedValue({ archived: 4, deleted: 2, evicted: 1, exhausted: true, stop: null, note: null, preview: null, readErrors: [] }) }`
  (constructor order after Batch 6: logger, workspace, sqlite, reclaimer, store, limits, lifecycle, governor optional;
  pass `null` or omit the governor; the budget's governor wait then fast-paths);
  `startThothCron`; take the `memory:retention` handler; invoke with a fake ctx; assert `runStep` called once with a
  `RetentionRunBudget`-shaped object and a number, and the summary contains `archived 4 / deleted 2 / evicted 1 memories`.
- Failure it MUST detect: handler not registered for `@ptah/memory-retention`; handler does not call `service.run`;
  `run` does not call `runStep`; summary drops the memory counts.
- Mutation checks (report; nothing committed; restore and prove with `git diff` on the touched files):
  (a) remove the `lifecycle.runStep(...)` call from `MemoryRetentionService.execute` -> this test FAILS;
  (b) remove the `service.run(...)` call from the handler in `memory-retention-job.ts` -> this test FAILS.

### Task 7.3: REACHABILITY PROOF — CLI host (`activateThoth`) — COMPLETE

- Depends on: Task 7.1
- File: MODIFY `W\libs\backend\cli-engine\src\lib\bootstrap\thoth-runtime.spec.ts`, inside
  `describe('memory retention job (TASK_2026_440 reachability)')` (:456): the same real-service test through
  `activateThoth(container, 'runtime', logger)`; the existing `oneshot` registers-nothing test stays.
- Plan reference: implementation-plan.md:749-751
- Failure it MUST detect: same four as Task 7.2, for the CLI runtime tier.
- Mutation checks: the same (a) and (b) as 7.2 must also make this CLI test FAIL (run both host specs under each
  mutation).

### Task 7.4: R-TL11 — make the real-SQLite integration suite load-robust — COMPLETE

- Files: MODIFY `W\libs\backend\memory-curator\src\lib\retention\memory-retention.integration.spec.ts`; MODIFY
  `retention-sqlite.test-support.ts` only if a faster seed helper is needed (e.g. one transaction per seed batch).
  No production file.
- Steps:
  1. Measure: `npx jest --config libs/backend/memory-curator/jest.config.ts --runTestsByPath libs/backend/memory-curator/src/lib/retention/memory-retention.integration.spec.ts --verbose --runInBand`
     and record every test's duration; name the slowest cases and why (seed volume, per-row inserts outside a
     transaction, vec blob generation, repeated reopen, reclaim).
  2. Fix without removing or weakening any assertion, preferring in order: wrap seeding in one transaction per case
     (and prepare statements once); share an expensive fixture file where cases do not mutate each other's rows;
     smaller seed counts ONLY where the plan does not fix them (the cap cases need the 1,000 clamp floor and stay at
     1,006 / 1,010 rows; the plan's 40/10/2/2/2/5 main seed stays); split a very long case into two `it` blocks that
     share a documented setup; last resort, an explicit per-test timeout on the slow case with a one-line comment giving
     the measured duration and the reason.
  3. Re-measure and report before/after per-test durations.
- Acceptance: identical assertion set (report the `expect(` count before and after for the file); the suite green
  under node:sqlite and under better-sqlite3; the load proof below green twice in a row.
- Load proof (report both runs, with headers): `npx nx run-many -t test -p @ptah-extension/memory-curator @ptah-extension/rpc-handlers --parallel=2 --skip-nx-cache`
  ("for 2 projects"), run twice.
- Commands (from `W`), for the whole batch:
  - `npx nx run-many -t test -p @ptah-extension/thoth-runtime @ptah-extension/cli-engine` — "for 2 projects"
  - same with `-t typecheck` and `-t lint` — 2 projects each
  - `git diff --stat -- libs/backend/thoth-runtime/src/lib/start-thoth-cron.ts libs/backend/cli-engine/src/lib/bootstrap/thoth-runtime.ts` is empty
  - Task 7.4: `npx nx run-many -t test -p @ptah-extension/memory-curator` (1 project) and the load proof above (2 projects, twice)
  - `npx nx run degradation-audit:lint` (exit 0)
  - XB1 better-sqlite3 run from `W` in PowerShell (keep the double quotes inside the single quotes):
    `$env:ELECTRON_RUN_AS_NODE='1'; & 'D:\projects\ptah-extension\node_modules\.bin\electron.cmd' 'D:\projects\ptah-extension\node_modules\jest\bin\jest.js' --config libs/backend/memory-curator/jest.config.ts --testPathPatterns '"memory-retention.integration|memory-lifecycle|di/register.spec"' --runInBand`
- Report: `W\.ptah\specs\TASK_2026_443_40ec\batch-7-report.md` (include every mutation-check output and the Task 7.4
  before/after durations). Write `batch-7.done` last; create no other file in the task folder.

### Batch 7 result

- Report (`batch-7-report.md`): 7 files. Host test / typecheck / lint green for 2 projects; memory-curator 643 passed /
  59 skipped; the `--parallel=2 --skip-nx-cache` load proof passed twice; degradation-audit green; the integration suite
  went 20.2 s -> 12.5 s with `expect(` unchanged at 159; mutations A (remove `lifecycle.runStep`) and B (remove
  `service.run` in the handler) each failed BOTH host proofs; the restore proof shows `memory-retention.service.ts`,
  `start-thoth-cron.ts` and cli-engine `thoth-runtime.ts` unchanged.
- Review (Ollama Cloud, `code-logic-review-batch-7.md`): APPROVED 8/10, 0 blocking/serious/moderate, 2 minor. The
  reviewer re-ran both proofs, counted `expect(` on HEAD and in the tree, and confirmed the only production diff is the
  `:98` summary literal.
- Team-leader decision: ACCEPTED and committed.
  - Minor 1 (mutation B's adjusted source text is not quoted in the report): recorded, no action. The restore proof and
    the independent re-run cover it.
  - Minor 2 (`seedMemories` in `retention-sqlite.test-support.ts:394-396` runs `raw.exec('ROLLBACK')` inside the catch,
    so a throwing ROLLBACK replaces the original seed error): CARRIED into Task 9.1 as a one-line test-support fix
    (wrap the ROLLBACK in its own try/catch and always rethrow the original error, the same rule
    `MemoryLifecycleStore.inTransaction` already follows).
- Team-leader re-run: thoth-runtime + cli-engine test / typecheck / lint 2 projects green (5 suites / 91 passed and 19
  suites / 188 passed; lint 0 errors); memory-curator under `--parallel=2` beside rpc-handlers 643 passed / 59 skipped;
  `degradation-audit:lint` exit 0 (memory-curator 20/20, cli-engine 12/12); `git diff --stat` empty for
  `start-thoth-cron.ts`, cli-engine `thoth-runtime.ts` and `memory-retention.service.ts`; `expect(` 159 at HEAD and 159
  in the tree; better-sqlite3 via Electron 43 suites / 702 passed. Committed with only the 7 Batch 7 files.
- R-TL12 (new, recorded): the FIRST load-proof run failed `rpc-handlers` `skills-sh/skills-sh-source-root.service.spec.ts`
  on a 15 s timeout. PRE-EXISTING and unrelated: this task never touches that file (last changed in `2e13ce0d6`
  `feat(harness-sync)`), it passes alone (20/20), and the identical load proof passed on the immediate re-run (3002
  passed). Treat it like R-TL8: on failure re-run, or run with `--parallel=1`, and record both runs. Batch 10 must not
  read it as a phase 2 regression.

### Batch 7 verification

- XB1: every spec that prepares SQL binds every named and positional parameter (passes under better-sqlite3 and node:sqlite).
- Both host tests pass and failed under mutations (a) and (b); production host files unchanged; R-TL11 load proof
  green twice with the assertion count unchanged; reviewer accepts.

---

## Batch 8: memory-curator-ui — lifecycle rows in the storage panel; decay tile removed — COMPLETE (commit 51ce3d58e)

- Recommended executor: codex CLI lane (`cli: 'codex'`, role frontend-developer)
- Fallback executor: frontend-developer subagent
- Execution mode: sequential (one lib, shared fixtures)
- Parallel with: Batch 7 (file-disjoint: `libs/frontend/memory-curator-ui` only)
- Rationale: two template rows + deletions + fixtures; must land before Batch 9 removes the shared fields.
- Reviewer: Ollama Cloud lane, code-logic-reviewer -> `code-logic-review-batch-8.md`
- Suggested commit: `feat(memory-curator-ui): batch 8 - show memory lifecycle results and preview; drop the decay tile`
- Tasks: 2 | Depends on: Batch 6 (`82410f33d`) on the origin/main rebase (`a3b2d7c71`)

### Task 8.1: Storage panel rows — COMPLETE

- Files: MODIFY `W\libs\frontend\memory-curator-ui\src\lib\components\diagnostics\storage-health-panel.component.ts`
  and `storage-health-panel.component.spec.ts`
- Plan reference: implementation-plan.md:709-731
- Implementation details: "Last retention run" list (:214-223) row `Memories` ->
  `archived <a> · deleted <d> · evicted <e>` via `formatCount`; "Retention settings" list (`<dl>` from `:245`) row
  `Memory lifecycle` -> `archive after <N> d · delete after <M> d · cap <cap>` then on the same `dd`: preview
  `next run: <x> to archive · <y> to delete · up to <z> over cap`, or `preview after the first run` (null preview),
  or `off (preview only)` (disabled), or `deletes paused: vector extension unavailable` (`vec-unavailable`);
  `data-testid="storage-memory-lifecycle"`.
- Quality requirements: OnPush unchanged; text (not colour) carries the note; no settings writes.
- Acceptance: spec renders both rows for a populated DTO, null preview, disabled, vec-unavailable.

### Task 8.2: Remove decay tile, state and event tone — COMPLETE

- Files (all under `W\libs\frontend\memory-curator-ui\src\lib\`):
  `components\diagnostics\memory-diagnostics-accordion.component.ts` (tile :61-66, `lastDecay` :226,
  `lastDecayLabel` :242-243) + spec (:30,65,99,131; assert `[data-testid="last-decay-run"]` absent);
  `services\memory-diagnostics-state.service.ts` (:30,41,68-70) + spec (:69-73 including the `'decay-run'` event at :73, :132);
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
  - XB2: `npx nx run degradation-audit:lint` (exit 0; memory-curator-ui stays at baseline 15)
- Report: `W\.ptah\specs\TASK_2026_443_40ec\batch-8-report.md`. Write `batch-8.done` last; create no other file in
  the task folder.

### Batch 8 result

- Report (`batch-8-report.md`): 9 files, all in `libs/frontend/memory-curator-ui`; test 188/188 (the first run's two
  failures were fixed in-batch without weakening assertions, review item 6); typecheck + lint green;
  degradation-audit memory-curator-ui 15/15; no non-spec `lastDecay` / `decay-run` reads.
- Review (Ollama Cloud, `code-logic-review-batch-8.md`): APPROVED 8/10, 0 blocking/serious, 1 moderate, 4 minor.
- Team-leader decision: ACCEPTED and committed; nothing to fix inside Batch 8.
  - Moderate 1 (`event-feed.component.ts:164-165` lost `default: return assertNever(ev.kind)` and now returns `'info'`)
    cannot be fixed while the shared union still contains `'decay-run'`, which Batch 8 must not remove (Deviation 3).
    It is CARRIED into Task 9.1, where the union loses `'decay-run'` in the same commit.
  - Minors 2-4 (spec-only; they live in the files Task 9.1 already touches in memory-curator-ui) are CARRIED into
    Task 9.1 instead of a separate revision round while Batch 7 is running. Minor 5 (untyped rpc spec fixtures) is
    recorded for Batch 9.
  - UI behaviour note: `vec-unavailable` shows the pause message in place of a populated preview. The plan lists the
    four texts as alternatives ("or"), so this is per plan; Task 9.1 pins it with a spec.
- Team-leader re-run (memory-curator-ui only; the Batch 7 lane was still editing backend libs): test / typecheck /
  lint for 1 project green (17 suites / 188 passed; lint 0 errors, 27 pre-existing warnings); degradation-audit
  memory-curator-ui 15 (baseline 15); non-spec grep for `lastDecay|decay-run` under `libs/frontend`: no match.
  Committed with only the 9 Batch 8 files.

### Batch 8 verification

- XB1: every spec that prepares SQL binds every named and positional parameter (passes under better-sqlite3 and node:sqlite).
- Rows render all four states; decay UI gone; commands green; reviewer accepts.

---

## Batch 9: Decay removal across memory-curator, shared, rpc-handlers, memory-curator-ui; rpc-handlers use recording — IN_PROGRESS

- Recommended executor: codex CLI lane (`cli: 'codex'`, role backend-developer)
- Fallback executor: backend-developer subagent
- Execution mode: sequential (one atomic cross-lib removal; `memory-rpc.handlers.ts` shared by both tasks)
- Parallel with: none (starts after Batches 7 and 8 return, so no host test run compiles memory-curator mid-edit)
- Rationale: Deviation 3 — the removal is only type-safe as one commit.
- Reviewer: Ollama Cloud lane, code-logic-reviewer -> `code-logic-review-batch-9.md`
- Suggested commit: `refactor(memory-curator,shared,rpc-handlers): batch 9 - delete the unscheduled decay job and record use on memory reads`
- Tasks: 2 | Depends on: Batches 3, 7 (`d5cb191b4`) and 8 (`51ce3d58e`)

### Task 9.1: Delete `MemoryDecayJob` and decay diagnostics everywhere — IN_PROGRESS

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
- Carried from `code-logic-review-batch-7.md` minor 2: in
  `W\libs\backend\memory-curator\src\lib\retention\retention-sqlite.test-support.ts:394-396`, wrap the
  `raw.exec('ROLLBACK')` inside the seed catch in its own try/catch and always rethrow the ORIGINAL error, so a
  failing rollback cannot mask the seed failure (same rule as `MemoryLifecycleStore.inTransaction`).
- Carried from `code-logic-review-batch-8.md` (all in memory-curator-ui; the commit set for Batch 9 grows by these
  files, and `@ptah-extension/memory-curator-ui` is already in the Batch 9 test / typecheck set; add it to the lint set):
  - Moderate 1: in `W\libs\frontend\memory-curator-ui\src\lib\components\diagnostics\event-feed.component.ts`, restore
    `import { assertNever } from '@ptah-extension/shared'` and `default: return assertNever(ev.kind);` in the same
    commit that removes `'decay-run'` from `MemoryCuratorEventKind` in shared. Typecheck must prove the switch is
    exhaustive again.
  - Minor 2: `storage-health-panel.component.spec.ts` case: `lastNote: 'vec-unavailable'` with a populated preview
    renders exactly `deletes paused: vector extension unavailable` in the lifecycle dd (the preview text is absent).
  - Minor 3: promote the three status assertions that use `toContain` to `toBe` on the full, trimmed dd text.
  - Minor 4: a spec asserts the `Memories` row is absent when `retention.lastRun` is null.
  - Minor 5: the rpc diagnostics spec fixtures in `memory-diagnostics-rpc.service.spec.ts` are untyped literals; when
    Task 9.1 removes `lastDecayAt` / `lastDecayStats` there, type the fixture as `MemoryDiagnosticsResult` so a future
    field change fails at compile time.
- Acceptance: grep `MemoryDecayJob|MEMORY_DECAY_JOB|lastDecay|decay-run|recordDecayEvent|MemoryDecayStats` under
  `W\libs` and `W\apps` returns nothing.

### Task 9.2: `memory:get` and `mem:getObservations` record use — IN_PROGRESS

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
  - `npx nx run-many -t lint -p @ptah-extension/memory-curator @ptah-extension/shared @ptah-extension/rpc-handlers @ptah-extension/memory-curator-ui` — 4 projects
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
  - XB2: `npx nx run degradation-audit:lint` (exit 0, baseline not raised)
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
