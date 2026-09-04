# Batches - TASK_2026_361

Total tasks: 5 | Batches: 5 | Complete: 1/5 (Batch 5 done; Batch 1 in progress)

All executors for this task are CLI agents or Task sub-agents selected by the ORCHESTRATOR. The team-leader recommends executors only and does not spawn them.

## Plan validation

Status: PASSED WITH RISKS

### Plan corrections

- `D:\projects\ptah-extension\.ptah\specs\TASK_2026_361\task-description.md` is absent. This is already acknowledged by the approved plan; `context.md` supplies the settled requirements, so it does not block decomposition.
- The planned new files do not yet exist: `generation-checkpoint.types.ts`, `multi-phase-analysis.service.spec.ts`, and `analysis-storage.service.spec.ts`. They are correctly CREATE items, not omissions.
- `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\analysis-results.component.spec.ts` is absent. The plan says to add or extend an analysis-results component spec as appropriate; Batch 4 therefore explicitly creates it.
- The plan's policy reference resolves to `D:\projects\ptah-extension\libs\backend\harness-sync\src\lib\reconciler\harness-reconciler.gitignore.spec.ts`; it exists and is inspection-only. No harness-sync source or Jest spec belongs in this task.
- Batch 1 owns the shared wire types and Batch 3 owns their handler consumers. This preserves file disjointness; Batch 3 must immediately consume the completed Batch 1 contract before Batch 4 starts.

Assumptions:

- `PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER` is already registered in each affected composition root — verified by the existing port contract and adapter families; Batch 2 must retain the port boundary and must not import an adapter.
- The VS Code provider's `writeFile()` does not itself create parent directories, although the port documentation says it does. Batch 2 must explicitly create the analysis/agent parent directory through the port before every first write path; Electron and CLI already create parents. This is a mitigation requirement, not an adapter change.
- Version-2 analysis manifests remain historical and unavailable for resume. Batch 2 must reject them without deleting them.
- The worktree has unrelated changes. Each later commit must stage only its listed batch paths.

| Risk                                                                                                     | Severity | Mitigation                                                                                                                                        |
| -------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| A checkpoint interrupted during persistence can be malformed and must not be treated as resumable state. | MEDIUM   | Batch 2 validates every manifest with Zod, leaves malformed data untouched, and returns it as unavailable.                                        |
| A second submit/resume request can arrive while one abortable generation is still settling.              | HIGH     | Batch 3 keeps one active controller/owner, rejects or reports the active run without replacing its manifest, and clears it only after settlement. |
| A timeout/cancel can occur between a completed file write and its checkpoint update.                     | MEDIUM   | Batches 2 and 3 stop further work, keep the file, and make resume classify an existing identical file as `unchanged`.                             |
| Full `.claude/skills` tracking can yield harness-sync foreign/blocked findings on another machine.       | MEDIUM   | Batch 5 records the accepted consequence; it changes no reconciliation policy.                                                                    |

Edge cases:

- No SDK result, timeout, or error result with captured text — Batch 2 saves diagnostic text only as `failed`, never `completed`.
- User pause or host restart while a phase/agent is `running` — Batches 2 and 3 normalize it to resumable work without deleting its slug.
- A timed-out generation that wrote one earlier file — Batch 3 waits for settlement, propagates the write, and broadcasts one partial outcome.
- An analysis directory outside the active workspace — Batch 3 rejects it at the Zod/canonicalization boundary.
- A completed/unchanged generation target on resume — Batch 3 skips it; Batch 4 shows the explicit terminal outcome.

## Batch 1: Shared wire contracts and agent-generation type foundations — IMPLEMENTED (uncommitted; see batch-1.report.md)

> Orchestrator note: shared is green (typecheck, lint, 1,216 tests). agent-generation
> typecheck fails only inside Batch-2-owned service files, as expected for a
> contract change. The Batch 1 commit is DEFERRED and folded into the Batch 2
> commit so `agent-generation` compiles at every commit in history.

- Recommended Executor: backend-developer
- Fallback Executor: CLI agent selected by the ORCHESTRATOR
- Execution Mode: sequential
- Rationale: The new shared RPC payload and the agent-generation manifest/outcome types form one coherent public contract. They must be aligned before service and handler implementations begin.
- Tasks: 1 | Depends on: none

### Task 1.1: Define the typed checkpoint, resume, and completion contracts — PENDING

- Plan reference: `implementation-plan.md:220-307, 333-390`
- Files to create:
  - `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\types\generation-checkpoint.types.ts`
- Files to modify:
  - `D:\projects\ptah-extension\libs\shared\src\lib\types\rpc\rpc-setup.types.ts`
  - `D:\projects\ptah-extension\libs\shared\src\lib\types\rpc.types.ts`
  - `D:\projects\ptah-extension\libs\shared\src\lib\types\wizard\phase.ts`
  - `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\types\multi-phase.types.ts`
  - `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\types\core.types.ts`
  - `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\types\enhanced-prompts.types.ts`
  - `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\types\index.ts`
  - `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\interfaces\content-generation.interface.ts`
  - `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\interfaces\agent-file-writer.interface.ts`
- Acceptance criteria:
  - The v3 analysis manifest has lifecycle/run fields, `pending | running | completed | failed | skipped` phase states, and a Zod schema that requires an error for failed phases.
  - A versioned generation checkpoint manifest persists selected inputs, output directory, lifecycle, and terminal per-agent records; it is exported type-only through the agent-generation public barrel.
  - `WizardDeepAnalyzeParams` and `WizardSubmitSelectionParams` accept `resume?: boolean`; `wizard:get-resumable-run` is represented in both the compile-time RPC registry and `RPC_METHOD_NAMES`.
  - `GenerationCompletePayload` and its agent outcomes replace `generatedCount` as the contract, retaining output directory, written/unchanged/failed counts, section counts, warnings/errors, and optional duration/enhanced-prompt usage.
  - Content-generation and writer interfaces accept abort/outcome types without concrete platform imports; `writeAgent()` returns a typed written-or-unchanged result.
- Validation notes: Preserve the deliberate v2 non-resume rule. Do not add a redundant `wizard:` runtime prefix; Batch 3 verifies the existing prefix guard.

### Batch 1 verification

- Test: `npx nx run-many -t test -p @ptah-extension/shared @ptah-extension/agent-generation`
- Typecheck/lint: `npx nx run-many -t typecheck,lint -p @ptah-extension/shared @ptah-extension/agent-generation`
- Confirm no public type is re-exported as a runtime value and no consumer still requires `generatedCount` in the affected project graph.

## Batch 2: Agent-generation persistence, analysis, trace, and abortable services — PENDING

- Recommended Executor: backend-developer
- Fallback Executor: CLI agent selected by the ORCHESTRATOR
- Execution Mode: sequential
- Rationale: Durable manifest ownership, stream semantics, trace persistence, SDK cancellation, and file outcomes are tightly coupled implementation concerns in one backend library.
- Tasks: 1 | Depends on: Batch 1

### Task 2.1: Implement truthful durable analysis and outcome-producing generation services — PENDING

- Plan reference: `implementation-plan.md:109-219, 223-307, 308-330`
- Files to create:
  - `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\wizard\multi-phase-analysis.service.spec.ts`
  - `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\analysis-storage.service.spec.ts`
- Files to modify:
  - `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\analysis-storage.service.ts`
  - `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\wizard\multi-phase-analysis.service.ts`
  - `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\enhanced-prompts\enhanced-prompts.service.ts`
  - `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\content-generation.service.ts`
  - `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\file-writer.service.ts`
  - `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\orchestrator.service.ts`
  - `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\enhanced-prompts\enhanced-prompts.service.spec.ts`
  - `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\content-generation.service.spec.ts`
  - `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\file-writer.service.spec.ts`
  - `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\orchestrator.service.spec.ts`
- Acceptance criteria:
  - `AnalysisStorageService` is the only owner of `.ptah/analysis` manifests, generation checkpoints, canonical analysis paths, resumable-run discovery, and enhanced-prompt trace writes. It uses `IFileSystemProvider`, validates all manifest reads through Zod, and never deletes on resume.
  - Analysis checkpoints every lifecycle transition. It captures complete SDK assistant/result text rather than throttled UI deltas; timeout/no-result/error remains failed with a non-empty error even if diagnostic text/file exists; a pause restores active/later work to resumable states.
  - Enhanced prompt generation writes full Markdown and precise JSON trace metadata before state/cache save, using only completed phase IDs and a canonical authorized analysis path or documented fallback root.
  - The orchestration path propagates `AbortSignal` through SDK calls, checks it before each agent and write, rethrows external aborts rather than writing fallback content, returns explicit section counts and terminal per-agent outcomes, and treats equal file bytes as `unchanged`.
  - Parent directories are explicitly created through `IFileSystemProvider` before storage/writer writes, so the VS Code adapter's observed parent-creation gap cannot break this cross-host path.
  - Specs prove success/full-text fallback, timeout/no-result, pause/stale-running resume, malformed-manifest rejection, trace failure, completed-phase filtering, abort preventing later writes, unchanged writes, mixed outcomes, and checkpoint repair through unchanged classification.
- Validation notes: No platform-adapter import or fleet dependency is permitted. A checkpoint write failure stops later work and surfaces an error rather than claiming resumability.

### Batch 2 verification

- Test: `npx nx run-many -t test -p @ptah-extension/agent-generation`
- Typecheck/lint: `npx nx run-many -t typecheck,lint -p @ptah-extension/agent-generation`
- Inspect the three existing adapter families and composition roots to confirm this batch used `PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER` only; do not modify adapters unless separately authorized.

## Batch 2b: Batch-1 code-logic review fixes — COMPLETE (commit 0424addac)

Finding 1 was already resolved by the Batch 2 executor
(`orchestrator.service.ts:53` re-exports the canonical type from
`../types/core.types`). Findings 2, 3 and 4 were applied by the orchestrator.

Deviation on finding 2: `ProjectAnalysisZodSchema` was NOT reused. It validates
raw LLM analysis JSON and normalizes it into `DeepProjectAnalysis`, which is a
different shape from the `ProjectAnalysisResult` the manifest field promises. A
dedicated structural `ProjectAnalysisResultSchema` was added in
`generation-checkpoint.types.ts` and annotated `z.ZodType<ProjectAnalysisResult>`,
so the compiler fails if the schema and the interface drift apart.

Also removed with finding 3: `agents: []` in the early "no selection" summary
(`orchestrator.service.ts:426`) and the `agents: []` fixture in
`core.types.spec.ts:246`, which the reviewer's file list did not name.

Verification: `npx nx run-many -t typecheck,lint -p @ptah-extension/agent-generation
@ptah-extension/shared` clean (0 errors); `npx nx test @ptah-extension/agent-generation`
30/30 suites, 947/947 tests.

Source: `agent-output-code-logic-reviewer.md` (verdict NEEDS_REVISION, 5/10). The
Batch 2 executor was already running and this CLI does not support steering, so
these are applied after Batch 2 lands, before the Batch 1+2 commit. They MUST be
fixed before Batch 3 starts, because Batch 3 imports the affected public types.

1. CRITICAL — one canonical `OrchestratorGenerationOptions`. `src/index.ts:31`
   re-exports the OLD service-local interface (no `abortSignal`/`onAgentOutcome`);
   the new fields exist only in `core.types.ts:593` and `types/index.ts` does not
   export that type. Delete the service-local declaration, import the canonical
   one, export it from `types/index.ts`, point the package root at that symbol,
   and pin it with a compile-time assertion in a spec.
2. SERIOUS — `generation-checkpoint.types.ts:65` `analysisData: z.unknown()`
   while the interface promises `ProjectAnalysisResult`. Validate the nested
   payload (reuse `ProjectAnalysisZodSchema` from `services/wizard/analysis-schema.ts`
   if the shape matches) or reject the whole checkpoint. A corrupt checkpoint must
   not be reported resumable.
3. SERIOUS — remove `GenerationSummary.agents: GeneratedAgent[]`. The only reader
   is `orchestrator.service.spec.ts:576-577`, a test, not production. `outcomes`
   is the single authoritative channel. (This REVERSES the orchestrator's earlier
   "keep it, a consumer exists" instruction to the Batch 2 executor.)
4. MODERATE — `ResumableGenerationRun.analysisDirectory?: string`
   (`libs/shared/.../rpc/rpc-setup.types.ts:160`) conflates "none" with "omitted".
   Make it `analysisDirectory: string | null`, required and nullable.

## Batch 6: ptah-cli consumers of the removed `generatedCount` — COMPLETE

Executed by the orchestrator. The three spec files adopted the new payload
shape, and `phase-runner.spec.ts` now extracts `writtenCount`.

Two things the batch found that were not in its brief:

- `apps/ptah-cli/src/cli/commands/setup.ts` sent the whole
  `MultiPhaseAnalysisResponse` as `analysisData`, which takes a
  `ProjectAnalysisResult`. Batch 3 added a Zod schema that drops the mismatched
  value, so the call was already a no-op with a warn. The field is now not sent
  at all; `analysisDir` fully specifies the analysis. The Batch 3 report named
  this as a Batch 6 clean-up.
- **`apps/ptah-cli/src/di/container.smoke.spec.ts` was failing after the Batch 3
  commit `57302b996`.** Batch 3's verification ran the VS Code and Electron
  composition roots and missed the third one, so that commit shipped with a red
  `ptah-cli` smoke spec. Fixed here with the same `ANALYSIS_STORAGE_SERVICE`
  registration. Rule for later batches: there are exactly THREE
  `container.smoke.spec.ts` files — vscode, electron and cli. A constructor
  change to a shared handler must run all three.

Verification: `npx nx run-many -t typecheck,lint,test -p ptah-cli
--skip-nx-cache` — "Successfully ran targets typecheck, lint, test", 65 suites
passed, 970 tests passed.

## Batch 6 (original brief): ptah-cli consumers of the removed `generatedCount`

The reviewer was right that no batch owned these. Measured with `grep -rn
generatedCount --include=*.ts apps/ libs/`:

- `apps/ptah-cli/src/cli/commands/setup.spec.ts:282,368,553,671`
- `apps/ptah-cli/src/cli/commands/wizard.spec.ts:275,328`
- `apps/ptah-cli/src/cli/wizard/phase-runner.spec.ts:145,146,155`

All three are SPEC files building `setup-wizard:generation-complete` fixtures; no
`ptah-cli` production file reads the field. They must adopt the new payload shape
(`writtenCount`/`unchangedCount`/`failedCount`/`agents`). Executor: CLI agent.
Verify with `npx nx run-many -t typecheck,test -p ptah-cli`. Run after Batch 4.

NOT affected, despite matching the grep:
`libs/frontend/setup-wizard/.../cards/enhanced-prompts-summary-card.component.ts:91,117`
has its own local `generatedCount` computed over enhanced-prompt sections. It is
unrelated to `GenerationCompletePayload`. Do not change it.

## Batch 3: RPC validation, checkpoint orchestration, and final outcome broadcasts — COMPLETE

Executed by a claude CLI agent (report: `batch-3.report.md`). Two writers briefly
raced on this ownership set — the orchestrator started hand-implementing it after
`ptah_agent_status` reported an empty registry. The registry was WRONG: the Ptah
extension host had rebound its MCP server to another workspace, so it answered
from that workspace's registry while this workspace's agent kept running. The
orchestrator discovered the live process (`claude.EXE`, parent `Ptah.exe`),
reverted its own competing handler edits and deleted its competing collaborator
(`wizard-generation-run.controller.ts`), and let the agent finish. Lesson worth
keeping: an empty `ptah_agent_status` is not proof that an agent is dead — check
the process table before assuming a file is yours to write.

Orchestrator fixes applied on top, all fallout the agent itself flagged as
unverified in report §5:

- `apps/ptah-extension-vscode/src/di/container.smoke.spec.ts` and
  `apps/ptah-electron/src/di/container.smoke.spec.ts` — register
  `ANALYSIS_STORAGE_SERVICE`. `EnhancedPromptsRpcHandlers` now injects it at
  constructor position 3, and both smoke containers register exactly the tokens
  the handlers inject, so both apps failed to resolve the handler.
- `apps/ptah-extension-vscode/src/integration/wizard-seed-noop.spec.ts` — the
  storage mock gains `toResponse`, which `wizard:deep-analyze` now answers
  through.

Verification (orchestrator-run, `--skip-nx-cache`): `typecheck`, `lint` and
`test` across `rpc-handlers`, `shared`, `agent-generation`, `ptah-extension-vscode`
and `ptah-electron` — "Successfully ran targets typecheck, lint, test for 5
projects". rpc-handlers 91 suites / 2612 tests, agent-generation 30 / 947,
shared 49 / 1216, vscode 32 suites, electron 4 suites. Zero lint errors.

- Recommended Executor: backend-developer
- Fallback Executor: CLI agent selected by the ORCHESTRATOR
- Execution Mode: sequential
- Rationale: Setup, enhanced-prompt, and generation handlers must atomically consume the completed shared and agent-generation contracts while retaining one owner for each operation/controller.
- Tasks: 1 | Depends on: Batches 1 and 2

### Task 3.1: Expose resume safely and map settled generation outcomes — PENDING

- Plan reference: `implementation-plan.md:160-219, 269-307, 359-390`
- Files to modify:
  - `D:\projects\ptah-extension\libs\backend\rpc-handlers\src\lib\handlers\setup-rpc.handlers.ts`
  - `D:\projects\ptah-extension\libs\backend\rpc-handlers\src\lib\handlers\setup-rpc.schema.ts`
  - `D:\projects\ptah-extension\libs\backend\rpc-handlers\src\lib\handlers\enhanced-prompts-rpc.handlers.ts`
  - `D:\projects\ptah-extension\libs\backend\rpc-handlers\src\lib\handlers\enhanced-prompts-rpc.schema.ts`
  - `D:\projects\ptah-extension\libs\backend\rpc-handlers\src\lib\handlers\wizard-generation-rpc.handlers.ts`
  - `D:\projects\ptah-extension\libs\backend\rpc-handlers\src\lib\handlers\wizard-generation-rpc.schema.ts`
  - `D:\projects\ptah-extension\libs\backend\rpc-handlers\src\lib\handlers\setup-rpc.handlers.spec.ts`
  - `D:\projects\ptah-extension\libs\backend\rpc-handlers\src\lib\handlers\setup-rpc.schema.spec.ts`
  - `D:\projects\ptah-extension\libs\backend\rpc-handlers\src\lib\handlers\enhanced-prompts-rpc.handlers.spec.ts`
  - `D:\projects\ptah-extension\libs\backend\rpc-handlers\src\lib\handlers\wizard-generation-rpc.handlers.spec.ts`
  - `D:\projects\ptah-extension\libs\backend\rpc-handlers\src\lib\handlers\wizard-generation-rpc.schema.spec.ts`
  - `D:\projects\ptah-extension\libs\backend\rpc-handlers\src\lib\rpc-allowlist.spec.ts`
- Acceptance criteria:
  - `SetupRpcHandlers` validates resume/query DTOs with Zod, registers `wizard:get-resumable-run`, owns analysis resume/cancel, and returns a read-only latest resumable analysis plus optional generation DTO.
  - Generation handler validates submit/resume/cancel inputs with Zod, creates/updates the generation manifest before and after each terminal outcome, canonicalizes authorized analysis directories, and resumes only pending/running/failed agent work while skipping written/unchanged files.
  - One handler-owned controller replaces the detached watchdog race. Watchdog or cancel aborts work, waits for the actual settled summary, and emits exactly one completion payload derived from explicit outcomes.
  - Propagation runs after settlement whenever `writtenCount > 0`, including partial timeout/pause and targeted retry; a propagation failure remains warning-only.
  - Concurrent submit/resume requests cannot replace an active controller or mutate the active run's manifest; active state clears only when the background task has settled.
  - Enhanced-prompt RPC validation rejects an analysis directory outside the authorized workspace `.ptah/analysis` root before the trace writer is reached.
  - Specs prove Zod rejection, shared registry/handler ownership, existing `wizard:` prefix acceptance, terminal-file skipping, timeout propagation once, cancel-as-pause, and unauthorized-path rejection.
- Validation notes: Batch 3 consumes the Batch 1 shared files but must not modify them; this maintains file-disjoint ownership. Confirm `ALLOWED_METHOD_PREFIXES` already includes `wizard:` and leave it unchanged.

### Batch 3 verification

- Test: `npx nx run-many -t test -p @ptah-extension/rpc-handlers @ptah-extension/shared`
- Typecheck/lint: `npx nx run-many -t typecheck,lint -p @ptah-extension/rpc-handlers @ptah-extension/shared`
- Confirm the setup-handler static method manifest exposes `wizard:get-resumable-run`, and no handler imports a platform adapter or agent-generation internal service.

## Batch 4: Setup-wizard recovery actions and outcome presentation — COMPLETE

Executed by a claude CLI agent (report: `batch-4.report.md`), exit 0. It
confirmed the pre-start breakage before editing: the lib did not typecheck,
because `wizard-phase-generation.ts:93` still read the removed
`payload.generatedCount`.

The judgment call worth keeping: the `phase === 'complete'` branch in
`handleGenerationProgress` was REMOVED, not bypassed. It marked every pending
item complete on the final progress event, which is the same "infer success
from a progress tick" defect this task exists to remove. Terminal item state
now has one source, `applyAgentOutcomes`.

Orchestrator verification (independent, `--skip-nx-cache`): `typecheck`, `lint`
and `test` for `@ptah-extension/setup-wizard` — 12 suites, 319 tests, all
passing. Downstream consumers `ptah-extension-webview` and
`@ptah-extension/canvas` also pass (3 + 7 suites, 36 + 141 tests). House rules
checked by hand: no `[innerHTML]` anywhere in the lib, and all three touched
components keep `ChangeDetectionStrategy.OnPush`.

Known limit, stated by the executor: no spec drives the full step routing
across a restart end-to-end (welcome → scan → hold → resume). The flow is
covered at the runner and component seams only.

## Batch 4 (original brief): Setup-wizard recovery actions and outcome presentation

- Recommended Executor: frontend-developer
- Fallback Executor: CLI agent selected by the ORCHESTRATOR
- Execution Mode: sequential
- Rationale: Root-scoped startup discovery, wizard state, resume actions, and outcome rendering share Angular signal state and must be implemented and tested together.
- Tasks: 1 | Depends on: Batch 3

### Task 4.1: Surface resumable runs and explicit terminal outcomes in the Angular wizard — PENDING

- Plan reference: `implementation-plan.md:250-307, 308-330, 349-390`
- Files to create:
  - `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\analysis-results.component.spec.ts`
- Files to modify:
  - `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\services\setup-wizard-state.types.ts`
  - `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\services\setup-wizard-state.service.ts`
  - `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\services\setup-wizard\wizard-internal-state.ts`
  - `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\services\setup-wizard\wizard-phase-generation.ts`
  - `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\services\wizard-rpc.service.ts`
  - `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\services\wizard-analysis-runner.service.ts`
  - `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\scan-progress.component.ts`
  - `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\analysis-results.component.ts`
  - `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\completion.component.ts`
  - `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\services\wizard-rpc.service.spec.ts`
  - `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\services\wizard-analysis-runner.service.spec.ts`
  - `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\services\setup-wizard\wizard-phase-generation.spec.ts`
  - `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\services\setup-wizard-state.service.spec.ts`
  - `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\completion.component.spec.ts`
  - `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\scan-progress.component.spec.ts`
- Acceptance criteria:
  - Root-scoped `WizardAnalysisRunner` queries `wizard:get-resumable-run` at startup and stores a resumable signal without automatically deleting/restarting the prior run.
  - `WizardRpcService` calls the typed `resume: true` paths; `ScanProgressComponent` offers analysis resume and `AnalysisResultsComponent` offers generation resume using persisted backend state, not frontend-memory reconstruction.
  - `WizardPhaseGeneration` maps explicit written/unchanged/failed agent outcomes into completion data and item progress. It does not infer success from a final progress event.
  - The completion UI shows output directory, all outcome/count categories, unchanged as already current, and partial failures with earlier writes retained.
  - All modified/new components remain standalone, `ChangeDetectionStrategy.OnPush`, and signal-driven. The existing `ngx-markdown` path is not extended or altered; no raw HTML binding is introduced.
  - Specs prove restart discovery, both resume flags/actions, mixed/timed-out outcome mapping, explicit status labels/counts/path, and state transitions.
- Validation notes: The Batch 3 wire contract is authoritative. Do not add a second markdown sanitizer or migrate unrelated rendering in this task.

### Batch 4 verification

- Test: `npx nx run-many -t test -p @ptah-extension/setup-wizard`
- Typecheck/lint: `npx nx run-many -t typecheck,lint -p @ptah-extension/setup-wizard`
- Confirm `ChangeDetectionStrategy.OnPush` remains on each touched component and all RPC calls stay behind `WizardRpcService`.

## Batch 5: Repository Claude-configuration tracking policy — COMPLETE (commit 84892c088)

> Executed by the orchestrator. Deviations from the plan: (1) the `!.claude/skills/`
> negation was placed AFTER the global `skills/` rule, not in the top block — the
> last matching rule wins, so the plan's placement would have re-ignored skills;
> (2) `.claude/` was added to `.prettierignore` because the pre-commit hook's
> `nx format:write` would reformat wizard/harness-written files and make every
> regeneration show as a diff; (3) commit scope `workspace` is not in the
> commitlint enum, so the commit is unscoped. Verified with `git check-ignore -v`
> (four trees un-ignored; `settings.local.json` and `worktrees/` still ignored).
> 375 files now tracked (agents 15, commands 7, skills 352, output-styles 1).

- Recommended Executor: CLI agent selected by the ORCHESTRATOR
- Fallback Executor: backend-developer
- Execution Mode: parallel
- Rationale: This is a single, mechanical root-policy edit with no source dependency and may run alongside any of Batches 1-4. The executor must not touch harness-sync implementation or tests.
- Tasks: 1 | Depends on: none

### Task 5.1: Unignore all approved project Claude assets and stage their trees — PENDING

- Plan reference: `implementation-plan.md:201-219, 333-390`
- Files to modify:
  - `D:\projects\ptah-extension\.gitignore`
- Staging targets after the ignore edit:
  - `D:\projects\ptah-extension\.claude\agents`
  - `D:\projects\ptah-extension\.claude\commands`
  - `D:\projects\ptah-extension\.claude\skills`
  - `D:\projects\ptah-extension\.claude\output-styles`
- Acceptance criteria:
  - Replace the selective agent/skill exceptions with full directory-and-content negations for the four user-approved `.claude` trees.
  - Remove the later video-showcase/fleet-only exception block; leave `.claude/workflows` byte-for-byte unchanged and retain all other `.claude/*` exclusions, including settings.local and worktrees.
  - Stage exactly the policy file and four approved trees with `git add .gitignore .claude/agents .claude/commands .claude/skills .claude/output-styles`; do not stage unrelated dirty files.
  - Record that managed skill copies can be reported foreign/blocked on another machine. Do not alter harness-sync ownership/reconciliation policy or add a root-ignore Jest test.
- Validation notes: This task is intentionally a policy-only exception to TypeScript verification. Inspect `D:\projects\ptah-extension\libs\backend\harness-sync\src\lib\reconciler\harness-reconciler.gitignore.spec.ts` only to confirm its generated-block concern remains unrelated.

### Batch 5 verification

- Test: Not applicable — repository policy only; no Jest spec is added.
- Typecheck/lint: Not applicable — repository policy only; no TypeScript project changes.
- Run `git check-ignore -v` for representative files under `.claude/agents`, `.claude/commands`, `.claude/skills`, and `.claude/output-styles`; each must be unignored. Confirm `.claude/settings.local.json` and a path under `.claude/worktrees/` remain ignored.

## Commit plan

Stage only the files in the completed batch; existing unrelated worktree changes remain unstaged.

| Batch | Draft conventional commit                                     |
| ----- | ------------------------------------------------------------- |
| 1     | `feat(agent-generation): add wizard checkpoint contracts`     |
| 2     | `feat(agent-generation): persist resumable wizard generation` |
| 3     | `feat(rpc-handlers): expose wizard resume outcomes`           |
| 4     | `feat(setup-wizard): show resumable wizard outcomes`          |
| 5     | `chore(workspace): track shared Claude configuration`         |

Batch 5 is the sole root-policy exception to the usual library-name scope rule; `workspace` accurately scopes its `.gitignore` and repository-configuration-only change. All commits must pass the repository's Husky/commitlint hooks.
