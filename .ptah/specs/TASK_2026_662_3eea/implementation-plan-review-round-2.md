# Implementation Plan Re-review, round 2 (final) - TASK_2026_662_3eea (Gate 2, cross-side)

Verdict: REVISE

Scope: the open items 1, 2, 4, 7, 12, 13 and N1-N7; a walk of all 64 batches against current source; the
three keep capabilities; the removal boundary (659 inventory + D2 + D3); and the data step. Method: `rg`
and source reads in the worktree at `271198ced`. No builds or tests were run. Minor items are not raised.

## Status of open items

| # | Status | Evidence |
| --- | --- | --- |
| 1 | Still open | The A-E order fixes the round-1 breaks, but two batches fail their own gates. R1: batch 39 vs 59, the RPC manifest invariant. R2: batches 1 and 63, the pinned latest migration version. |
| 2 | Still open | The three host `rpc-surface` specs become manifest-relative (36-38). That does not cover `assertManifestInvariants` (R1). |
| 4 | Fixed | TH cron/boot are cut in 31, CE callers in 32, TH job files and index in 33, all before 54/55. `rg SKILL_DRAIN_JOBS\|skill-drain-jobs` finds no Electron or VS Code importer. |
| 7 | Fixed | Every live `SKILL_SYNTHESIS_EVENT` user is cut before batch 60: webview 23, core 26, Electron spec 35, RH 39, SS 55, SU 56. `rpc-curator-diagnostics.types.ts:52` is a comment. |
| 12 | Partly open | Batches 57, 59 and 61 change contracts used by projects outside their gates (R3, R5). |
| 13 | Still open | The mcp-bench funnel and judge families and four harness files are in no batch (R4). |
| N1 | Fixed | `di/tokens.ts` is trimmed in 58, after the SS deletion in 55. Batch 54 explicitly keeps tokens. |
| N2 | Fixed, with a gap | The state service and parent are cut in 24, orphans deleted in 56, facade trimmed in 57. Gap: the secondary entry point `src/services.ts` (R6). |
| N3 | Fixed | See row 4. |
| N4 | Fixed | See row 7. |
| N5 | Mostly fixed | TH, CE and Electron are atomic. Batch 63 edits `sqlite-connection.service.ts`, but its spec is in 64, and `0057_drop_skill_pipeline.spec.ts` is listed in both. Moderate: move the spec into 63. |
| N6 | Partly open | See row 12. |
| N7 | Still open | See R4. |

## Keep capabilities, removal boundary, data step

- **Shipped-skill delivery survives.**
  - Batch 12 moves `resolveSkillsRoot` before batch 55 deletes `skill-md-generator.ts`.
  - Every importer uses the package index: VS Code `plugin-activation.ts:17`, Electron `plugin-activation.ts:38`,
    `harness-fs.service.ts:37` and CE `harness-boot.ts:48`.
  - The `skillSynthesis.skillsRoot` key is one of the two retained keys.
- **Pause survives.** `skillSynthesis.enabled` is retained. Batches 17-18 move the switch to `settings:get`/`set`
  before 39 removes `getSettings`/`updateSettings`.
- **Memory-retention foreground gate survives.** The tracker stays in 13 and 55, and its token stays in 58.
  Batch 31 keeps `memory-retention-job.ts`. The memory-curator hits for
  `skillSynthesis.drain.foregroundBackoffMs` (`memory-retention-config.ts:103`,
  `memory-trigger-config.ts:88`) are comments, so removing the key in 61 is safe.
- **Removal boundary.** No removal outside the 659 remove-proposed list, D2 and D3 was found.
- **Data step.**
  - Batch 15 adds a fatal, verified-archive preflight before 0057 is registered (63).
  - When vec is loaded, older vec catch-up runs before the archive.
  - The `skill_candidates_vec` drop is in `vecSql`, and its deferred catch-up requires the archive receipt.
  - If vec exists but cannot load, 0057 does not begin.
  - A test for failure leaving version 56 is required (64). This step is satisfied.

## Remaining findings

### R1. Blocking: batch 39 shrinks the handler `METHODS` while `RPC_METHOD_NAMES` keeps those names until batch 59

- Evidence:
  - The manifest entry takes its methods from the handler: `methods: SkillsSynthesisRpcHandlers.METHODS`
    (`host-profile/manifest.ts:429-432`).
  - `assertManifestInvariants` throws when any registry name has no owner (`manifest.ts:506-531`).
  - It runs on every host boot (`register-rpc-surface.ts:142`) and in `rpc-allowlist.spec.ts`.
  - Every host surface spec also asserts `registered + excluded === RPC_METHOD_NAMES.length`
    (`apps/ptah-extension-vscode/src/di/rpc-surface.spec.ts:211-212`), because `deriveRpcSurface` partitions
    only manifest methods (`register-rpc-surface.ts:58-69`).
- Failure: from batch 39 to batch 58, all three hosts throw "RPC manifest is missing an owner" at boot, and the
  gates of batch 39 fail (RH, VS Code, Electron, CLI container and surface specs). Making the specs
  manifest-relative cannot fix a runtime throw.
- Fix: choose one.
  - Remove the obsolete names from `METHODS` and from the shared `RpcMethodRegistry`/`RPC_METHOD_ENTRIES`,
    the schema and the allowlist in one compile-asserted contract batch. That batch must follow the SU facade
    trim (57), with the 39 handler-body cut kept separate.
  - Or keep the obsolete names in `METHODS` from 39 to 59, served by a stub that raises `RpcUserError`, and
    drop the names in 59 together with the shared entries.

### R2. Blocking: batches 1 and 63 break 15 specs that pin the latest migration at 55

- Evidence: 15 files in `persistence-sqlite/src/lib/migrations/*.spec.ts` assert
  `Math.max(...MIGRATIONS.map(m => m.version))).toBe(55)` (for example `0042_db_integrity_check_state.spec.ts:71`,
  `0045_skill_backlog_cleanup.spec.ts:34`, `0051_skill_lifecycle.spec.ts:31`). Batch 1 owns only the 0056 file,
  its spec and `index.ts`. Batch 63 owns only 0057, its spec and index.
- Failure: the first batch fails its own `persistence-sqlite` test gate, and so does batch 63.
- Fix: batch 1 updates the 15 pins in the same commit. A label such as "mechanical spec-pin exception" is
  enough, or the pins can be replaced with one shared latest-version constant. Batch 63 repeats this for 57.

### R3. Blocking: Providers lane-routing consumers are in no batch while the lane RPC, DTOs and 32 keys are removed

- Evidence:
  - The removal map deletes `setLanes`/`getLanes`, the lane config/provider rows and the 32 lane keys.
  - These live users are in no batch:
    - `libs/frontend/chat/src/lib/settings/providers/routing-map.component.ts:7,13,31,249,286` uses
      `SkillLaneIdDto`, `state.lanes()` and `refreshLanes`;
    - `connection-usage.ts:4-5,34,69,127-160` uses the lane DTOs and `judgeProvider`;
    - `libs/frontend/core/src/lib/services/providers-settings.types.ts:10,90`;
    - `provider-consumer-assignments.component.ts:642-647` uses `skillSynthesis.enhanceTimeoutMs`.
  - Batch 16 owns only `providers-commit`, `providers-settings-state` and `provider-consumer-rows`.
  - The DTOs live in shared (`rpc-curator-diagnostics.types.ts:316-350`).
  - The gates of batches 59 and 61 exclude `core` and `chat`.
- Failure: the `chat` and `core` compile breaks, or the routing map shows a dead lanes section and calls removed
  RPCs. No gate detects either.
- Fix:
  - Extend batch 16, or add a phase-C batch, to cut lane routing and the old timeout key from these four
    files and their specs.
  - Add `@ptah-extension/core` and `@ptah-extension/chat` to the gates of batches 59 and 61.

### R4. Serious: mcp-bench deletions in batch 41 and repoints in 42-43 miss importers

- Evidence:
  - Batch 41 deletes `trigger-human-eval.ts` and `namer-and-trigger.suite.ts`, but these still use them:
    - `host-only-imports.spec.ts:40-41` asserts that both paths exist (`:66-69`);
    - `ground-truth/committed-u4-labels.spec.ts:15-18` imports `TRIGGER_EVAL_PANEL` and `triggerLabelSchema`;
    - `host/memory-skills-host.entry.ts:50` imports `NAMER_AND_TRIGGER_SUITES`.
  - The funnel family drives the production pipeline through `registerSkillSynthesisServices`
    (`funnel-lifecycle.spec.ts:62`: "lifecycle suites over production DI"). It is not in any batch:
    - `funnel.suite.ts` and its spec, `funnel-lifecycle.ts` and its spec, `funnel-backlog.ts`, `funnel-fixture.ts`
      and `funnel-di.test-support.ts`;
    - its importers `runner/runner-plan.ts:19`, `host/plan.schema.ts:26`, `host/suite-placement.spec.ts:3-4,69-74`
      and `memory-skills-host.entry.ts:47,49,75,78`.
  - `funnel-host-graph.ts:394-454` resolves the drain, synthesis, curator, promotion and suggestion tokens.
  - The judge-agreement suite measures `SkillJudgeService` (`judge-agreement.suite.ts:765-773`), which is deleted.
    Under D2 it is pipeline-only, not "repoint".
- Failure: batch 41's mcp-bench gate fails. Batches 54, 55 and 58 fail at runtime and compile across the funnel
  family.
- Fix: under D2, batch 41 and its neighbours delete the funnel and judge-agreement suites with their helpers and
  specs. They update `memory-skills-host.entry.ts`, `runner-plan.ts`, `plan.schema.ts`, `suite-placement.spec.ts`,
  `host-only-imports.spec.ts` and `committed-u4-labels.spec.ts`; the last one moves its schema or deletes the
  spec. They keep only lane helpers that do not depend on the pipeline: `judge-lane-tap`, `recorded-lane-runner`
  and `doubles-override`.

### R5. Serious: batches 57 and 61 change contracts whose consumers are outside both the batch and its gate

- Evidence:
  - `libs/frontend/dashboard/src/lib/services/thoth-status.service.ts:385` calls `skillsRpc.listCandidates`, and
    its spec mocks it (`:142-308`). Batch 17 only switches pause (`:325`). Batch 57 trims `listCandidates` with an
    SU-only gate.
  - Batch 61 removes 79 keys. Its gate runs the RH tests, but these RH specs are not in its file list:
    - `settings-rpc.handlers.spec.ts:393,446` writes and validates
      `skillSynthesis.replayValidation.minConfidence` and `judgePanel.disagreementThreshold`;
    - `config-scope-rpc.handlers.spec.ts:243` uses `skillSynthesis.judgeModel`.
  - Also outside the batch: `libs/shared/src/lib/types/rpc/rpc-auth.types.ts:482-522`, the per-key scope metadata
    for the removed keys, and `chat/.../advanced-settings-group.component.spec.ts:343-355`.
- Failure: the dashboard compile breaks without detection at batch 57. Batch 61 fails its own RH gate.
- Fix:
  - Cut the dashboard candidate count in batch 17, or add a C batch for it, and add `dashboard` to the batch 57
    gate.
  - Put the four files above into batch 61, or into a preceding C batch, and add `chat` to the batch 61 gate.

### R6. Serious: batch 56 deletes `SkillSynthesisLiveService`, but the `/services` entry point still exports it

- Evidence:
  - `tsconfig.base.json:111-112` maps `@ptah-extension/skill-synthesis-ui/services` to
    `libs/frontend/skill-synthesis-ui/src/services.ts`, which exports the live service (`:19`).
  - Batch 56 edits nothing outside `SU/lib`, and no batch owns `src/services.ts`.
- Failure: the `skill-synthesis-ui` typecheck in batch 56 fails.
- Fix: batch 24, which already edits `src/index.ts`, drops the live-service export from `src/services.ts`, after
  batch 23 removes the webview importer (`app.config.ts:82`).

## Required for APPROVED

1. Fix R1, R2 and R3.
2. Then fix R4, R5 and R6.
3. Re-run the plan's own G-ledger, extended by the greps above:
   - `RPC_METHOD_NAMES` and manifest owner;
   - `toBe(55)`;
   - `SkillLane*Dto`;
   - `/services` entry;
   - mcp-bench `funnel`/`judge-agreement` importers.

   Confirm that every batch gate names each project whose imports or contracts that batch changes.
