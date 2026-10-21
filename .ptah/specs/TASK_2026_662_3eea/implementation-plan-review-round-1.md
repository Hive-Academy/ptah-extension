# Implementation Plan Re-review, round 1 - TASK_2026_662_3eea (Gate 2, cross-side)

Verdict: REVISE

Scope: the 14 prior findings, the batch-order compile check, the three `keep` capabilities, the
success-signal source and the approved-removal boundary. Method: grep and source reads in the
worktree. No builds or tests were run.

## Prior findings

| # | Status | Evidence |
| --- | --- | --- |
| 1 | Still open (new ordering defects) | Backend host cuts now come before deletions. Two new breaks: tokens.ts is trimmed in batch 32 while doomed files still use the tokens until batches 34-42 (N1), and the frontend deletions 43-46 run after the facade and contract removals in 16b and 21 (N2). |
| 2 | Partly fixed | The DTO and handler are now atomic (batch 7), and the DI pre-alignment in 28-30 is subset-safe. Still open: `apps/ptah-extension-vscode/src/di/rpc-surface.spec.ts:207` asserts `surface.excluded` `toEqual(VSCODE_EXPECTED_ABSENT_METHODS)`, and that list names the removed methods (`:120-128`). Batch 21 shrinks the manifest, but this spec changes only in batch 28 (Electron in 29, CLI `rpc/rpc-surface.spec.ts` in 30), so batches 21-29 commit three red app specs. |
| 3 | Fixed | Batch 22 moves `resolveSkillsRoot` (`skill-md-generator.ts:80`) into `skills-root.ts` and keeps the export in the index. Every consumer imports it from the package index: `harness-fs.service.ts`, `harness-boot.ts`, both `plugin-activation.ts`, and handlers `:2601`. `skillSynthesis.skillsRoot` is one of the two retained keys (49 explicit keys verified, 47 removed). |
| 4 | Coverage fixed, new ordering defect | Every host consumer is now in a batch. But thoth-runtime keeps two files that import doomed symbols until batch 47 (N3). |
| 5 | Fixed | `settings:set` accepts any registered file-based key that is not denied (`settings-rpc.handlers.ts:76-78,172-183`), and `settings:get` reads through the provider (`:127-137`). The pause switch and `assertSkillsNotPaused` (`handlers.ts:2661-2666`) still read `skillSynthesis.enabled`. |
| 6 | Fixed | Batch 2 runs the migration in `loadSync`, before batch 33 removes the old routing. Batch 8 makes the enhancer read the new keys directly, replacing `settings.judgeProvider` at `skill-enhancer.service.ts:804-806`. |
| 7 | Mostly fixed | CLI, IPC, host profiles and the drain constants are now covered. Removing the push constant in batch 15 misses several consumers (N4). |
| 8 | Fixed | Batches 3-4 set `is_error` independently of the grade, with a regression case. |
| 9 | Fixed | `skill_task_grades` is the only source of rates, for all three kinds, through `SkillScorecardService`. Batch 7 must repoint both rate sites: `toCloneSummary` (`handlers.ts:2304-2305`) and `invocationStats` (`:1756`). The removal map cites only `:2305`; add `:1756`. |
| 10 | Fixed | The subtree table covers both libraries. |
| 11 | Fixed | 20 columns, 6 indexes, FK-safe 0057 order, fatal preflight and a test that failure leaves version 56. |
| 12 | Partly fixed | Frontend gates now include typecheck. Splitting spec batches to meet the cap introduced N5, and some gates miss affected projects (N6). |
| 13 | Still open | Several mcp-bench importers are in no batch (N7). |
| 14 | Fixed | Minor; not re-raised. |

## Keep capabilities, success signal and removal boundary

- **Shipped-skill delivery.** Survives. See row 3.
- **Pause switch and its RPC.** Survives. `getSettings` and `updateSettings` give way to `settings:get` and `settings:set` (row 5).
- **Memory-retention foreground gate.** Survives. `memory-retention-job.ts:116-123` checks the token, resolves the tracker and calls `tracker.start()` itself, so removing the drain and cleanup callers (`skill-drain.service.ts:814`, `skill-backlog-cleanup.service.ts:155`) leaves the gate fed. Batches 23 and 32 keep the class, the token and the registration (`register.ts:106,198`).
- **Success signal.** It has one source of truth. The 646 before/after signals are a separate, labelled metric.
- **Removal boundary.** No removal outside the approved list was found. Clarification 1 is retained by default: 0057 keeps the cursor and vec tables. Clarification 2 is retained by default, but N7 shows the default cannot hold for three suites.

## New findings

### N1. Blocking: batch 32 trims `di/tokens.ts` while doomed files still use those tokens

- Evidence: `skill-synthesis.service.ts`, `queue/skill-drain.service.ts`, `gates/`, `digest/` and `cleanup/` inject `SKILL_QUEUE_STORE`, `SKILL_SYNTHESIS_SERVICE`, `SKILL_JUDGE_SERVICE`, `SKILL_PROMOTION_SERVICE`, `SKILL_BUDGET_STORE` and `SKILL_BACKLOG_CLEANUP_STORE`. Examples: `skill-drain.service.ts:671`, `skill-backlog-cleanup.service.ts:119`. Those files are deleted only in batches 34-42.
- Failure: the typecheck of `@ptah-extension/skill-synthesis` in batch 32's own gate fails.
- Fix: in batch 32, remove registrations and exports only. Trim `tokens.ts` in the last skill-synthesis deletion batch (42), as the prior fix item 6 required.

### N2. Blocking: frontend orphans outlive the facade and contract removals

- Evidence:
  - `components/diagnostics/*`, `skill-pipeline-status.component.ts` and `suggestions/skill-suggestions-view.component.ts` import `skill-diagnostics-*`, `skill-synthesis-live` and `skill-synthesis-state` services.
  - `skill-diagnostics-rpc.service.ts:29-66` calls `'skillSynthesis:diagnostics' | 'analyzeNow' | 'setTriggers' | 'getTriggers'` through `call<T extends RpcMethodName>` (`claude-rpc.service.ts:129`).
  - The suggestions view uses `state.suggestions` and `refreshSuggestions` (`:416-454`), which call `rpc.listSuggestions` (state service `:467-580`).
- Failure:
  - Batch 16b cannot remove facade methods while the kept state service still calls them (`:178-694`) for orphans that live until batch 44.
  - After batch 21, the first frontend gate (batch 43, skill-synthesis-ui typecheck) fails on `skill-diagnostics-rpc.service.ts`, which survives until batch 46.
- Fix:
  - Move the deletions in 43-46 directly after batch 16, which cuts the tab imports, and before 16b.
  - Batch 12 or 16 must explicitly strip the removed-method calls from `skill-synthesis-state.service.ts`.

### N3. Blocking: thoth-runtime's skill job files survive past the skill-synthesis export and source removals

- Evidence:
  - `thoth-runtime/src/lib/skill-drain-jobs.ts` imports `DrainTier` (`queue/skill-drain.service.ts:212`).
  - `skill-backlog-cleanup-job.ts` imports `SkillBacklogCleanupService` (`cleanup/skill-backlog-cleanup.service.ts:75`), `BacklogCleanupReport` and `SKILL_BACKLOG_CLEANUP_SERVICE`.
  - `thoth-runtime/src/index.ts:17-32` re-exports both files.
  - Both are deleted only in batch 47.
- Failure: thoth-runtime does not compile from batch 32 (exports) or batches 35 and 38 (sources) through 46. None of those gates includes thoth-runtime.
- Fix: run batch 47 directly after batch 26, which removes the cli-engine use of `SKILL_DRAIN_JOBS`, and before batch 32.

### N4. Blocking: batch 15 removes `MESSAGE_TYPES.SKILL_SYNTHESIS_EVENT` while consumers remain

- Evidence: these files still use the constant when batch 15 lands:
  - `libs/frontend/core/src/lib/services/back-office-activity.service.ts:111,177` and its spec, which are in no batch;
  - `apps/ptah-electron/src/ipc/ipc-bridge.window-availability.spec.ts:58`, also in no batch;
  - `skill-synthesis-live.service.ts:80,93` (until batch 46);
  - `event-wire.ts` and `skill-synthesis.service.ts` (until batch 42);
  - `handlers.ts:801` (until batch 21).
- Failure: core, Electron, skill-synthesis-ui, rpc-handlers and skill-synthesis stop compiling. Batch 15's gate covers only the webview and shared.
- Fix:
  - In batch 15, cut only the webview `MESSAGE_HANDLERS` provider.
  - Remove the constant and payload-map entry in a late shared batch, next to 50a.
  - Add the `back-office-activity` skill branch and its spec, plus the Electron spec, to an earlier batch.

### N5. Serious: split spec batches commit a production change without its spec

- Evidence: 25/25a (`boot-thoth-runtime.ts` vs `boot-thoth-runtime.spec.ts`), 26/26a (`register-thoth-libraries.ts` vs its spec and `thoth-runtime-edge.spec.ts`), 27/27a (`wire-runtime.ts` and `skill-repropagation.ts` vs their specs). In each pair, the spec lands one batch after the source.
- Failure: unless each spec passes against both the old and the new code, the gates of 25, 26 and 27 run the stale spec and fail. 16/16a has the same gap across projects (thoth-shell is not gated in 16).
- Fix: merge each pair, recording the cap exception with its reason, or move the spec batch first and state that it is compatible with both versions.

### N6. Serious: some cross-project consumers fall outside the batch gates

- Batch 21 and later:
  - The handler constructor injects, non-optionally, `SKILL_SYNTHESIS_SERVICE`, `SKILL_CANDIDATE_STORE`, `SKILL_DIAGNOSTICS_SERVICE`, `SKILL_QUEUE_STORE` and `SKILL_BUDGET_STORE` (`handlers.ts:353-389`).
  - Methods that stay still use two of them: `previewEnhancement` calls `this.synthesis.readSettings()` (`:1169`), and `toCloneSummary` uses `this.store` (`:2304`).
  - Batch 21 must explicitly drop every doomed import and injection, because `type SkillCandidateStore` at `:40` breaks when batch 42 deletes the file.
  - Add `@ptah-extension/rpc-handlers` to the gates of batches 32 and 42.
- Batch 33:
  - `skills-synthesis-rpc.handlers.spec.ts:2192-2219` checks the platform-core lane defaults key by key against `SKILL_LANE_KEYS` and `SKILL_LANE_DEFAULTS`.
  - Batch 33 removes the 32 lane keys from platform-core, and its gate excludes rpc-handlers.
  - Either remove that parity block explicitly in batch 20, or add rpc-handlers to the batch 33 gate.

### N7. Serious: mcp-bench importers missing, and they conflict with the Clarification 2 default

- Evidence: these files are in no batch, and 48a-48c do not own them:
  - `tools/mcp-bench/.../suites/skills/trigger-human-eval.ts` imports `TriggerEvalService` (`gates/trigger-eval.service.ts:339`, deleted in batch 36) and `SKILL_CANDIDATE_STORE`;
  - `namer-and-trigger.suite.ts` and its spec import `SkillMdGenerator` (`skill-md-generator.ts:146`, deleted in batch 42) and `SkillSynthesisService`;
  - `namer-collisions.ts` imports `MaterializedSkill` and `SkillMdInput`.
- `funnel-di.test-support.ts`, `judge-lane-tap.ts`, `doubles-override.ts` and `recorded-lane-runner.ts` use only retained lane exports. Confirm that this stays true after batch 32.
- Failure:
  - mcp-bench (which has a `typecheck` target, `project.json:259`) breaks at batch 32 and is never repaired.
  - These suites test code that is approved for deletion, so the "retain or repoint to archive fixtures" default of Clarification 2 cannot hold for them.
- Fix:
  - Add the three files to the exact inventory of Clarification 2, as suites that cannot be repointed, and escalate them.
  - Until the answer arrives, hold batches 36 and 42 for `TriggerEvalService` and `SkillMdGenerator`, or get explicit approval to delete these suites.
  - Put the mcp-bench edit before batch 32.

## Required for APPROVED

Fix N1 to N4, and the open part of finding 2: put the three app `rpc-surface` specs in batch 21, which may exceed the cap as the compile-asserted contract batch, or gate batch 21 with them. Then resolve N5 to N7 and add `:1756` to the batch 7 removal map. After that, re-confirm that every batch's gate covers every project whose imports the batch changes.
