# Implementation Plan - TASK_2026_361

## Summary

Make wizard analysis and generation truthful and resumable. A phase is complete only after an on-time successful SDK result and a durable output; timeout/no-result text remains available for diagnosis but is never eligible for enrichment. Generation receives a real abort signal, records durable per-agent outcomes, and broadcasts the settled outcome rather than a watchdog race. The existing `.ptah/analysis/<slug>` directory becomes the local checkpoint and trace root; it remains git-ignored by design. The repository tracks all requested `.claude` project configuration while retaining every other local `.claude/*` exclusion.

## Inputs and constraints

- Requirements used: `D:\projects\ptah-extension\.ptah\specs\TASK_2026_361\context.md`; `D:\projects\ptah-extension\.claude\agents\software-architect.md`; root and affected-library `CLAUDE.md` files.
- Corrections applied: none. F1--F5 agree with the opened implementation, including the detached timeout race, the completed-on-text fallback, the global-state-only enhanced prompt, and the destructive slug creation.
- Design handoff used: none.
- Missing decision-critical input: `task-description.md` is absent. It does not block this plan because `context.md` supplies the settled scope and user decisions.
- Source is read-only for this task. The only write made by this architect is this plan.

## Verified contracts

| Verified contract                                                                                                                                                               | Location                                                                                                                                                                                                                                                   | Architectural implication                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A phase currently records `completed` when its expected file exists, or when any captured text is written as a fallback.                                                        | `libs/backend/agent-generation/src/lib/services/wizard/multi-phase-analysis.service.ts:214`                                                                                                                                                                | Completion must additionally require a successful SDK result and no per-phase timeout; fallback text must not promote a failed phase.                                             |
| The current capture is fed by UI text events, while the stream processor emits those deltas no more often than every 100 ms.                                                    | `libs/backend/agent-generation/src/lib/services/wizard/multi-phase-analysis.service.ts:501`; `libs/backend/agent-sdk/src/lib/stream-processing/sdk-stream-processor.ts:38`; `libs/backend/agent-sdk/src/lib/stream-processing/sdk-stream-processor.ts:133` | UI events are not a persistence source. Capture complete assistant message text directly from `SDKMessage` instead.                                                               |
| `SdkStreamProcessor` returns result metadata only for a successful `result` message and otherwise logs “Stream ended without result.”                                           | `libs/backend/agent-sdk/src/lib/stream-processing/sdk-stream-processor.ts:77`                                                                                                                                                                              | The analysis wrapper can distinguish a result from an exhausted/aborted stream without parsing logs.                                                                              |
| `PhaseResult` has only terminal statuses and `MultiPhaseManifest` is hard-coded to version 2.                                                                                   | `libs/backend/agent-generation/src/lib/types/multi-phase.types.ts:24`                                                                                                                                                                                      | Add durable lifecycle/checkpoint fields and a version-3 Zod-validated manifest; do not infer a run state from file presence.                                                      |
| `createSlugDir` recursively deletes the slug directory before recreating it.                                                                                                    | `libs/backend/agent-generation/src/lib/services/analysis-storage.service.ts:59`                                                                                                                                                                            | Fresh and resume paths must be separate: resume loads the existing manifest and never calls the destructive create method.                                                        |
| Storage loads phase contents only when their manifest entry is `completed`.                                                                                                     | `libs/backend/agent-generation/src/lib/services/analysis-storage.service.ts:237`                                                                                                                                                                           | Failed partial output remains on disk but is not supplied to consumers; this is the required trust boundary.                                                                      |
| Enhanced prompt state is persisted only through VS Code global state after `generatedPrompt` is assembled.                                                                      | `libs/backend/agent-generation/src/lib/services/enhanced-prompts/enhanced-prompts.service.ts:446`; `libs/backend/agent-generation/src/lib/services/enhanced-prompts/enhanced-prompts-state-store.ts:61`                                                    | Write the local trace before considering `runWizard` successful; preserve global state as the runtime cache, not as the audit trail.                                              |
| Enrichment already includes only manifest entries whose status is `completed`.                                                                                                  | `libs/backend/agent-generation/src/lib/services/enhanced-prompts/enhanced-prompts.service.ts:914`                                                                                                                                                          | No enrichment consumer change is required for honest failed phases.                                                                                                               |
| The analysis results UI already renders `completed`, `failed`, and other statuses separately.                                                                                   | `libs/frontend/setup-wizard/src/lib/components/analysis-results.component.ts:97`                                                                                                                                                                           | No phase-status semantic change is needed in this component; it only gains resume affordances and typed response fields.                                                          |
| Agent generation currently writes every rendered agent through `writeAgent`, and its summary retains only aggregate success/failure counts plus generated agents.               | `libs/backend/agent-generation/src/lib/services/orchestrator.service.ts:490`; `libs/backend/agent-generation/src/lib/types/core.types.ts:598`                                                                                                              | Change the writer result and generation summary to retain a per-agent durable outcome, including unchanged detection and section counts.                                          |
| `ContentGenerationService` already knows which sections were rejected only as warning strings; accepted generated sections are not counted.                                     | `libs/backend/agent-generation/src/lib/services/content-generation.service.ts:352`                                                                                                                                                                         | Return explicit rejected/tailored counts from content generation so warnings never become a lossy counting API.                                                                   |
| `ContentGenerationService` owns a private abort controller for each SDK call and falls back after every caught error.                                                           | `libs/backend/agent-generation/src/lib/services/content-generation.service.ts:220`; `libs/backend/agent-generation/src/lib/services/content-generation.service.ts:404`                                                                                     | Link the caller signal to this controller and rethrow caller cancellation rather than silently writing fallback content after cancellation.                                       |
| The generation handler races `generateAgents()` with a rejecting ten-minute promise; the race does not abort the orchestrator, and propagation runs only in the success branch. | `libs/backend/rpc-handlers/src/lib/handlers/wizard-generation-rpc.handlers.ts:529`; `libs/backend/rpc-handlers/src/lib/handlers/wizard-generation-rpc.handlers.ts:579`                                                                                     | Replace the race with a watchdog that aborts the threaded controller, awaits the settled summary, then propagates whenever `writtenCount > 0`.                                    |
| `GenerationCompletePayload` has only aggregate `generatedCount` and no output path or per-agent details.                                                                        | `libs/shared/src/lib/types/wizard/phase.ts:189`                                                                                                                                                                                                            | Replace the completion payload with outcome-derived counts and agent records; map all UI consumers in the same change.                                                            |
| Existing `wizard:` RPC methods are registered in the shared registry and accepted by the runtime `wizard:` prefix.                                                              | `libs/shared/src/lib/types/rpc.types.ts:770`; `libs/backend/vscode-core/src/messaging/rpc-handler.ts:60`                                                                                                                                                   | The new resume-discovery method stays in the existing namespace. Add it to the shared registry and handler manifest; the allowed-prefix site is verified but needs no new prefix. |
| `SetupRpcHandlers` owns deep analysis/cancel and `WizardGenerationRpcHandlers` owns submit/cancel/retry.                                                                        | `libs/backend/rpc-handlers/src/lib/handlers/setup-rpc.handlers.ts:75`; `libs/backend/rpc-handlers/src/lib/handlers/wizard-generation-rpc.handlers.ts:113`                                                                                                  | Keep query and analysis resume in `SetupRpcHandlers`; keep generation resume and its abort owner in `WizardGenerationRpcHandlers`.                                                |
| The root-scoped analysis runner survives view remounts but its state is in-memory and starts a new deep analysis when no result exists.                                         | `libs/frontend/setup-wizard/src/lib/services/wizard-analysis-runner.service.ts:17`; `libs/frontend/setup-wizard/src/lib/services/wizard-analysis-runner.service.ts:109`                                                                                    | Add startup discovery and a resume state; do not make a component own a long-running operation.                                                                                   |
| Backend file I/O is expected to use the platform file-system port, which exposes read, write, existence, directory, and delete operations.                                      | `libs/backend/platform-core/src/interfaces/file-system-provider.interface.ts:17`                                                                                                                                                                           | Move the touched storage/writer I/O behind `IFileSystemProvider`, preserving the hexagonal boundary in all three hosts.                                                           |
| The harness target marks unowned mismatched desired entries foreign/blocked, but adopts a byte-identical copy.                                                                  | `libs/backend/harness-sync/src/lib/targets/claude-target.ts:459`; `libs/backend/harness-sync/src/lib/targets/claude-target.ts:507`                                                                                                                         | Surface committed managed-skill copies as an accepted consequence of tracking all `.claude/skills`; this task does not weaken ownership rules.                                    |

## Architecture decision

- Chosen approach: version the analysis manifest to v3, add a sibling generation manifest, checkpoint after every durable lifecycle transition, and use the existing `wizard:` RPC family for `resume` operations and resumable-run discovery. Analysis text is captured from complete SDK assistant messages, never from throttled UI deltas. The generation watchdog owns an `AbortController`, passes its signal through the orchestrator and content-generation SDK calls, and waits for the abort to settle before broadcasting one final outcome.
- Rationale: this keeps the analysis directory as the one local source of operational truth, preserves existing dependency direction, and gives the UI a typed recovery query after a host restart. It fixes the observed “failed-but-still-writing” generation and “timed-out-but-completed” analysis outcomes without treating logs or UI streams as state.
- Rejected alternatives:
  - Dropping all text fallback loses useful forensic evidence. Complete assistant messages are unthrottled SDK records, so retaining them in a failed phase file is both useful and honest.
  - Keeping the `Promise.race` and merely delaying completion still permits a background writer after a claimed failure. An abort signal makes the watchdog enforce the stated limit.
  - A new checkpoint library or an import from fleet orchestration would add an unrelated dependency. The local manifest format is sufficient inspiration and remains owned by agent-generation.
  - Persisting checkpoints in frontend signals/global state cannot survive all hosts and process termination. `.ptah/analysis` is workspace-local and already owns analysis artifacts.
  - Compatibility manifests/shims are not introduced. Existing v2 manifests remain historical local data but are not resumable; new runs write v3. This is a deliberate format replacement, not parallel execution paths.
- Assumptions: the three platform file-system adapters honour the port’s `writeFile()` parent-directory contract. The implementer must verify their existing adapter tests before removing direct `fs/promises` usage from the two touched services.
- Effect on existing code: `generatedCount` ceases to be the UI source of truth. Existing aggregate counts remain meaningful in `GenerationSummary`, but the completion UI derives file cards/statuses from explicit outcomes. Failed analysis text remains excluded from both `loadMultiPhase()` and prompt enrichment.

## Component specifications

### 1. Honest multi-phase analysis and durable analysis checkpoint

- Purpose: make each phase result, timeout, cancellation, and restart state truthful and durable.
- Responsibilities:
  - Replace `executePhase(): Promise<string | null>` with an execution outcome containing `resultReceived`, `timedOut`, `assistantText`, and any terminal SDK error.
  - Capture text blocks from complete `assistant` SDK messages, plus the successful result text where supplied. Do not collect `SdkStreamProcessor` emitter text. A successful result may use this complete captured text to create a missing expected phase file; a no-result/timeout may preserve it as a diagnostic file but is still failed.
  - Treat `analysis_timeout`, an exhausted stream without a successful result, and error result messages as `failed` with a non-empty error string even if a phase file exists. User pause is the distinct non-terminal case: normalize the active phase back to `pending`, leave its partial file intact, and leave later phases `pending`.
  - Write v3 `manifest.json` before the first phase, on `pending -> running`, after every `completed`/`failed` transition, and when the run pauses/completes. On resume, normalize stale `running` entries to `pending`, skip only `completed` phases, and continue from the first non-completed one without deleting the slug directory.
  - Retain `skipped` for an explicitly skipped phase; it is non-completed and therefore eligible on a later resume.
- Verified contracts and entry points: `MultiPhaseAnalysisService.analyzeWorkspace()` is the sequential owner (`multi-phase-analysis.service.ts:122`); its per-phase abort timer is already armed before execute (`:421`); `cancelAnalysis()` owns the active master controller (`:353`); storage owns slug paths and manifest/phase reads (`analysis-storage.service.ts:33`, `:80`, `:91`).
- Dependencies: `MultiPhaseAnalysisService -> AnalysisStorageService -> IFileSystemProvider`; it never imports a platform adapter. Prompt/SDK use remains through `InternalQueryService`.
- Integration points: `wizard:deep-analyze` accepts `resume?: boolean`; `wizard:cancel-analysis` requests a graceful pause. Its response returns the same `MultiPhaseAnalysisResponse`, now with v3 lifecycle/run fields and typed phase statuses.
- Failure behaviour: a persistence failure before a phase starts returns an RPC error and starts no SDK work. A checkpoint-write failure after a phase terminal event stops later phases, retains whatever was written, and reports an error rather than claiming resumability. A timeout/no-result continues the existing independent-phase pipeline but remains failed in the manifest.
- Quality requirements: no UI throttling path may affect persisted text; only completed phases are exposed to enrichment. Persisted manifests are parsed with Zod on every read and invalid JSON/version is rejected rather than cast.
- Verification seam: stream fixtures covering success-with-file, success-with-full-text fallback, timeout-with-partial-file, no-result-with-partial-file, user pause, and resume across a stale `running` phase.
- Files:
  - MODIFY `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\wizard\multi-phase-analysis.service.ts`
  - MODIFY `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\types\multi-phase.types.ts`
  - MODIFY `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\analysis-storage.service.ts`
  - CREATE `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\wizard\multi-phase-analysis.service.spec.ts`
  - CREATE `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\analysis-storage.service.spec.ts`

### 2. On-disk enhanced-prompt trace

- Purpose: make every successful enhanced prompt inspectable beside the analysis that informed it.
- Responsibilities:
  - After guidance is generated and its `generatedAt`, config hash, and detected stack are known, write `enhanced-prompt.md` containing the entire `generatedPrompt` and `enhanced-prompt.json` containing `generatedAt`, `configHash`, `detectedStack`, `analysisDirectory` (workspace-relative slug directory or `null`), `analysisPhaseIds`, and `promptLength`.
  - Change `enrichWithMultiPhaseAnalysis()` to return the canonical analysis directory and the completed phase IDs actually loaded, rather than only mutating prompt input. The metadata records what was used, not what happened to exist.
  - Use `IFileSystemProvider` inside `EnhancedPromptsService` for these two writes: it is a platform-core port and avoids extending the reader-only setter contract purely to write a trace. The target is the supplied/canonical analysis slug directory; if no analysis directory exists, use `<workspace>/.ptah/analysis/` for both files with `analysisDirectory: null` and an empty phase list.
  - Write the trace before saving global state/cache. If either trace write fails, return `success: false`, do not update the current state/cache, and leave a clearly logged retryable local partial; a later successful run overwrites both canonical names.
- Verified contracts and entry points: `runWizard()` has `analysisDir` and forms `generatedPrompt` before saving state (`enhanced-prompts.service.ts:312`, `:446`, `:461`); `regenerate()` finds the latest analysis and delegates to `runWizard()` (`:528`, `:557`); the handler already forwards `analysisDir` (`enhanced-prompts-rpc.handlers.ts:300`).
- Dependencies: `EnhancedPromptsService -> IFileSystemProvider`; it retains its read-only analysis-reader relationship for discovery/enrichment and adds no adapter import.
- Integration points: no new public RPC method. Canonicalize and authorize an inbound `analysisDir` in `EnhancedPromptsRpcHandlers` before it reaches the writer; reject paths outside the active workspace’s `.ptah/analysis` root.
- Failure behaviour: only a fully persisted trace and state save is reported as a successful wizard/regeneration. Failed analysis phases remain absent from `analysisPhaseIds` and from the prompt designer input.
- Quality requirements: the metadata contains no prompt body; the Markdown file is the explicit local trace. `.ptah/**` remains git-ignored, so no generated prompt is accidentally committed.
- Verification seam: success with an explicit slug, success with no analysis slug, metadata phase list limited to completed entries, trace-write failure preventing state save, and regenerate using the latest slug.
- Files:
  - MODIFY `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\enhanced-prompts\enhanced-prompts.service.ts`
  - MODIFY `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\types\enhanced-prompts.types.ts`
  - MODIFY `D:\projects\ptah-extension\libs\backend\rpc-handlers\src\lib\handlers\enhanced-prompts-rpc.handlers.ts`
  - MODIFY `D:\projects\ptah-extension\libs\backend\rpc-handlers\src\lib\handlers\enhanced-prompts-rpc.schema.ts`
  - MODIFY `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\enhanced-prompts\enhanced-prompts.service.spec.ts`
  - MODIFY `D:\projects\ptah-extension\libs\backend\rpc-handlers\src\lib\handlers\enhanced-prompts-rpc.handlers.spec.ts`

### 3. Abortable, outcome-honest generation

- Purpose: stop generation at the watchdog boundary and report exactly which files changed.
- Responsibilities:
  - Replace the detached `Promise.race` watchdog with one handler-owned `AbortController`. At ten minutes it calls `abort('generation_timeout')`; the background task awaits `generateAgents()` until the aborted SDK stream and orchestrator settle, then sends one completion payload.
  - Thread `abortSignal` through `OrchestratorGenerationOptions`, `ContentGenerationSdkConfig`, and `ContentGenerationService`. Link it to the service-local controller before `InternalQueryService.execute()`, remove the listener in `finally`, and rethrow an external abort so fallback content is not written after a user cancel/watchdog abort.
  - Check the signal before selecting/rendering each agent and before each write. Convert selected but not-started agents at abort time to terminal `failed` records with an explicit “not generated because <reason>” error; this preserves the required three terminal file outcomes without pretending they were written.
  - Change `AgentFileWriterService.writeAgent()` to read the existing target content first. Equal bytes return `{ filePath, status: 'unchanged' }`; otherwise write and return `{ filePath, status: 'written' }`. A write error becomes the orchestrator’s per-agent `failed` outcome. Use the platform file-system port for the compare/write.
  - Have content generation return explicit `rejectedSections` (validator rejections only) and `tailoredSections` (accepted non-empty LLM section replacements only). Carry those values into each agent outcome and aggregate them in the summary/payload.
  - Invoke `propagateGeneratedAgents()` only after the settled summary and whenever `writtenCount > 0`, including a timed-out or user-paused run. Apply the same condition to targeted retry.
- Verified contracts and entry points: file writes are sequential (`orchestrator.service.ts:490`); writer currently unconditionally overwrites (`file-writer.service.ts:74`, `:101`); generated section validator rejection is the source of warnings (`content-generation.service.ts:374`); propagation is intentionally non-fatal (`wizard-generation-rpc.handlers.ts:184`).
- Dependencies: `WizardGenerationRpcHandlers -> AgentGenerationOrchestratorService -> ContentGenerationService/AgentFileWriterService -> IFileSystemProvider`. No handler enters agent-generation internals other than its public types/callbacks.
- Integration points: `wizard:cancel` aborts the active generation controller and retains its checkpoint; it must not clear `isGenerating` before the actual background task finishes. `wizard:retry-item` consumes the same summary-to-payload mapper.
- Failure behaviour: timeout/cancel produces a settled partial summary and `success: false` whenever any agent failed; an unexpected failure before a summary remains an RPC handler failure payload with the known output directory and error. Propagation failure is warning-only after local writes.
- Quality requirements: one completion broadcast per invocation, never a success before the underlying task has stopped; no output file is re-written when content matches exactly.
- Verification seam: fake timer watchdog proves `abort()` reaches the SDK config and no later writes occur; content-equal writer returns unchanged; mixed write outcomes produce accurate totals; timeout with one earlier write propagates; cancel preserves a resumable failure/pending record.
- Files:
  - MODIFY `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\orchestrator.service.ts`
  - MODIFY `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\content-generation.service.ts`
  - MODIFY `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\interfaces\content-generation.interface.ts`
  - MODIFY `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\file-writer.service.ts`
  - MODIFY `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\interfaces\agent-file-writer.interface.ts`
  - MODIFY `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\types\core.types.ts`
  - MODIFY `D:\projects\ptah-extension\libs\backend\rpc-handlers\src\lib\handlers\wizard-generation-rpc.handlers.ts`
  - MODIFY `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\orchestrator.service.spec.ts`
  - MODIFY `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\content-generation.service.spec.ts`
  - MODIFY `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\file-writer.service.spec.ts`
  - MODIFY `D:\projects\ptah-extension\libs\backend\rpc-handlers\src\lib\handlers\wizard-generation-rpc.handlers.spec.ts`

### 4. Resumable analysis and generation

- Purpose: recover a paused or terminated wizard after a host restart using workspace-local, validated checkpoints.
- Responsibilities:
  - Add a v3 analysis manifest with logical `runId`, immutable `analyzedAt`, `updatedAt`, lifecycle (`running | paused | completed | failed`), and every phase initialized as `pending | running | completed | failed | skipped`. Retain `durationMs`, `file`, and required error-on-failure. A resume retains the logical `runId`; a fresh run receives a new one.
  - Add `.ptah/analysis/<slug>/generation-manifest.json` with its own `runId`, linked analysis run ID/directory, selected IDs, canonical generation input needed after restart, output directory, lifecycle (`running | paused | completed | timed-out | failed`), timestamps, and each agent checkpoint (`pending | running | written | unchanged | failed`, file path, counts, optional error). If generation was launched without an analysis slug, use `<workspace>/.ptah/analysis/generation-manifest.json` as the documented local fallback.
  - The submit handler writes the initial generation manifest before launching work and updates it after every per-agent terminal callback. `resume: true` loads it, validates its workspace/analysis location, skips both `written` and `unchanged` agents (including the required already-written set), and re-runs all other agents. It reuses persisted selected IDs and inputs rather than frontend memory.
  - Add `wizard:get-resumable-run` to `SetupRpcHandlers`. It returns the latest resumable analysis response and, when present, its generation checkpoint DTO. It does not mutate disk. Resume uses the existing methods: `wizard:deep-analyze { resume: true }` and `wizard:submit-selection { resume: true }`.
  - Extend `AnalysisStorageService` with the only checkpoint/trace path and serialization operations: create/load/update analysis manifest, create/load/update generation manifest, canonicalize a supplied analysis directory, find the latest resumable run, and write prompt artifacts. Read all manifest files through Zod schemas. It is the persistence boundary, not a new workflow service.
  - Frontend startup discovery lives in root-scoped `WizardAnalysisRunner`, preserving the existing view-lifetime boundary. Its initial discovery sets a resumable signal instead of automatically destroying the prior run. `ScanProgressComponent` shows a small “Resume analysis” action for an incomplete analysis; `AnalysisResultsComponent` shows “Resume generation” for a generation checkpoint and transitions to the existing generation step. Both actions call `WizardRpcService`, never backend code.
- Verified contracts and entry points: current analysis RPC returns completed phase files from its manifest (`setup-rpc.handlers.ts:336`); the handler list/manifest derives from `static METHODS` (`setup-rpc.handlers.ts:76`; `rpc-handlers/src/lib/host-profile/manifest.ts:232`); the frontend already owns `multiPhaseResult` in a signal (`setup-wizard-state.service.ts:172`) and submits the resulting analysis directory (`wizard-rpc.service.ts:96`).
- Dependencies: shared owns only RPC/wire DTOs; agent-generation owns disk schemas; rpc-handlers orchestrates calls/persistence callbacks; frontend owns signals and UI. The direction remains frontend -> shared <- backend.
- External-boundary controls: add Zod parameter schemas for new `resume` flags and the query; canonicalize `analysisDir` against the authorized active workspace before reading/writing. Add the shared RPC method to `RpcMethodRegistry`/`RPC_METHOD_NAMES`; `ALLOWED_METHOD_PREFIXES` is the second registration point and is already satisfied by `wizard:` at `rpc-handler.ts:60`, so it is verified but unchanged. Add the method to `SetupRpcHandlers.METHODS`, which feeds the host-profile manifest.
- Failure and rollback: a host termination may leave `running`; resume normalizes that to `pending`. User pause leaves checkpoints intact. A malformed/mismatched checkpoint is not resumed and is reported as unavailable; it is never deleted automatically. If checkpoint persistence fails after an output write, stop before later agents and surface the error; a later resume can safely classify that file as unchanged and repair the manifest.
- Quality requirements: no resume deletes a slug; no skipped/failed analysis content can enter enrichment; resume state is discoverable after a full host restart without relying on frontend memory.
- Verification seam: storage round-trips/rejects v3 manifests; resume invokes only non-completed analysis phases; termination-like stale running state restarts safely; generation resume skips terminal files; query DTO drives both resume buttons; unauthorized analysis directory is rejected.
- Files:
  - CREATE `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\types\generation-checkpoint.types.ts`
  - MODIFY `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\types\index.ts`
  - MODIFY `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\analysis-storage.service.ts`
  - MODIFY `D:\projects\ptah-extension\libs\backend\rpc-handlers\src\lib\handlers\setup-rpc.handlers.ts`
  - MODIFY `D:\projects\ptah-extension\libs\backend\rpc-handlers\src\lib\handlers\setup-rpc.schema.ts`
  - MODIFY `D:\projects\ptah-extension\libs\backend\rpc-handlers\src\lib\handlers\wizard-generation-rpc.handlers.ts`
  - MODIFY `D:\projects\ptah-extension\libs\backend\rpc-handlers\src\lib\handlers\wizard-generation-rpc.schema.ts`
  - MODIFY `D:\projects\ptah-extension\libs\shared\src\lib\types\rpc\rpc-setup.types.ts`
  - MODIFY `D:\projects\ptah-extension\libs\shared\src\lib\types\rpc.types.ts`
  - MODIFY `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\services\wizard-rpc.service.ts`
  - MODIFY `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\services\wizard-analysis-runner.service.ts`
  - MODIFY `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\services\setup-wizard-state.service.ts`
  - MODIFY `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\services\setup-wizard\wizard-internal-state.ts`
  - MODIFY `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\scan-progress.component.ts`
  - MODIFY `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\analysis-results.component.ts`
  - MODIFY associated specs listed in the Test plan below.

### 5. Completion outcome contract and Angular presentation

- Purpose: show whether each selected agent was written, already current, or failed, rather than showing generated-count optimism.
- Responsibilities:
  - Replace `GenerationCompletePayload.generatedCount` with `outputDirectory`, `writtenCount`, `unchangedCount`, `failedCount`, aggregate `rejectedSections`, aggregate `tailoredSections`, `agents: GenerationAgentOutcome[]`, duration, warnings/errors, and enhanced-prompt usage. Each agent contains its ID, absolute target path, terminal status (`written | unchanged | failed`), counts, and required failure detail where applicable.
  - Make `WizardPhaseGeneration.handleGenerationComplete()` map explicit outcomes into `CompletionData` and the existing item-progress signal: written/unchanged are complete, failed is error. Do not infer success from a final progress event.
  - Extend `CompletionData` with the same outcome and aggregate fields. `CompletionComponent` lists explicit outcomes, labels unchanged files as already current, surfaces failures/counts and output directory, and derives cards from those outcomes rather than only streamed completed items. Preserve standalone/OnPush/signals and do not introduce any raw HTML rendering.
- Verified contracts and entry points: generation completion is routed through `WizardPhaseGeneration` (`wizard-phase-generation.ts:90`); completion currently derives files from in-memory progress items (`completion.component.ts:304`); every wizard message payload is a shared discriminated union (`shared/types/wizard/phase.ts:239`).
- Failure behaviour: a partial/timed-out run reaches the completion/generation UI with successful earlier writes visible and later failed agents explicit; it does not disappear into a generic zero-count failure.
- Verification seam: payload mapping fixtures for written, unchanged, mixed, and timed-out outcomes; component assertions for counts/status labels/output directory.
- Files:
  - MODIFY `D:\projects\ptah-extension\libs\shared\src\lib\types\wizard\phase.ts`
  - MODIFY `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\services\setup-wizard-state.types.ts`
  - MODIFY `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\services\setup-wizard\wizard-phase-generation.ts`
  - MODIFY `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\completion.component.ts`
  - MODIFY `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\services\setup-wizard\wizard-phase-generation.spec.ts`
  - MODIFY `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\completion.component.spec.ts`
  - MODIFY `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\services\setup-wizard-state.service.spec.ts`

### 6. Repository `.claude` tracking policy

- Purpose: make all project-owned agents, commands, skills, and output styles visible to Git, while leaving local Claude configuration ignored.
- Responsibilities:
  - Replace the selective agent/skill exceptions with directory-and-content negations for all four user-selected directories.
  - Delete the later video-showcase/fleet-only skill exception block because it would re-ignore the newly requested complete skills tree. Keep `.claude/workflows` exactly as it is.
  - Record the accepted harness-sync consequence: a committed managed skill copy not owned by another machine’s manifest can be reported foreign/blocked; identical content may be adopted. No reconciliation policy is changed.
- Exact replacement block for current lines 149--160:

```gitignore
# ============================================
# Claude Code configuration (local except shared project configuration)
# ============================================
.claude/*

# These project-owned assets are committed in full. Everything else under
# `.claude/` (including settings.local.json and worktrees) remains ignored.
!.claude/agents/
!.claude/agents/**
!.claude/commands/
!.claude/commands/**
!.claude/skills/
!.claude/skills/**
!.claude/output-styles/
!.claude/output-styles/**
```

- Exact replacement for the current later skill exception area (current lines 197--207): delete that restricted `video-showcase`/`fleet-orchestration` block entirely. The following existing block remains byte-for-byte unchanged:

```gitignore
!.claude/workflows/
!.claude/workflows/**
```

- Follow-up staging command for the team after the ignore edit: `git add .gitignore .claude/agents .claude/commands .claude/skills .claude/output-styles`.
- Verification seam: `git check-ignore -v` shows no ignore rule for representative paths in each of the four tracked directories and still shows `.claude/settings.local.json`/`.claude/worktrees/...` ignored. This is policy-only; do not add a brittle harness-sync Jest test that couples a reusable library to this repository’s root ignore policy.
- Files:
  - MODIFY `D:\projects\ptah-extension\.gitignore`

## Exact type and schema changes

### Agent-generation disk and execution contracts

```ts
type AnalysisPhaseStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

interface PhaseResult {
  status: AnalysisPhaseStatus;
  file: string;
  durationMs: number;
  error?: string; // required by the v3 Zod refinement when status === 'failed'
}

interface MultiPhaseManifest {
  version: 3;
  runId: string;
  slug: string;
  analyzedAt: string;
  updatedAt: string;
  lifecycle: 'running' | 'paused' | 'completed' | 'failed';
  model: string;
  totalDurationMs: number;
  phases: Record<MultiPhaseId, PhaseResult>;
}

interface MultiPhaseAnalysisOptions {
  // existing fields
  resume?: boolean;
}
```

`MultiPhaseManifestSchema` validates the v3 JSON on read. New `GenerationCheckpointManifestSchema` validates the sibling checkpoint before a resume:

```ts
interface GenerationAgentCheckpoint {
  agentId: string;
  filePath: string;
  status: 'pending' | 'running' | 'written' | 'unchanged' | 'failed';
  rejectedSections: number;
  tailoredSections: number;
  error?: string;
}

interface GenerationCheckpointManifest {
  version: 1;
  runId: string;
  analysisRunId?: string;
  analysisDirectory?: string;
  createdAt: string;
  updatedAt: string;
  lifecycle: 'running' | 'paused' | 'completed' | 'timed-out' | 'failed';
  outputDirectory: string;
  selectedAgentIds: string[];
  input: { threshold?: number; variableOverrides?: Record<string, string>; model?: string; analysisData?: ProjectAnalysisResult };
  agents: Record<string, GenerationAgentCheckpoint>;
}
```

`ContentGenerationSdkConfig` and `OrchestratorGenerationOptions` gain `abortSignal?: AbortSignal`. Content generation returns `{ content, warnings, rejectedSections, tailoredSections }`. `IAgentFileWriterService.writeAgent()` changes from `Result<string, Error>` to `Result<{ filePath: string; status: 'written' | 'unchanged' }, Error>`.

`GenerationSummary` retains useful aggregates but replaces `GeneratedAgent[]` as the result detail with terminal `GenerationAgentOutcome[]`, adds `outputDirectory`, `writtenCount`, `unchangedCount`, `failedCount`, `rejectedSections`, `tailoredSections`, and a terminal lifecycle. The handler passes an `onAgentOutcome` callback through generation options to persist each checkpoint transition without coupling the orchestrator to RPC storage.

### Shared RPC and UI contracts

```ts
interface WizardDeepAnalyzeParams {
  model?: string;
  resume?: boolean;
}

interface WizardSubmitSelectionParams {
  // existing fields
  resume?: boolean;
}

interface WizardGetResumableRunResponse {
  analysis: MultiPhaseAnalysisResponse | null;
  generation: ResumableGenerationRun | null;
}

interface GenerationAgentOutcome {
  agentId: string;
  filePath: string;
  status: 'written' | 'unchanged' | 'failed';
  rejectedSections: number;
  tailoredSections: number;
  error?: string;
}

interface GenerationCompletePayload {
  success: boolean;
  outputDirectory: string;
  writtenCount: number;
  unchangedCount: number;
  failedCount: number;
  rejectedSections: number;
  tailoredSections: number;
  agents: GenerationAgentOutcome[];
  duration?: number;
  errors?: string[];
  warnings?: string[];
  enhancedPromptsUsed?: boolean;
}
```

Add `'wizard:get-resumable-run'` to `RpcMethodRegistry` and the `RPC_METHOD_NAMES` object in `libs/shared/src/lib/types/rpc.types.ts`, add it to `SetupRpcHandlers.METHODS` and registration, and add Zod schemas in the handler siblings. The compile-time registration point therefore changes; the runtime guard point, `ALLOWED_METHOD_PREFIXES` in `libs/backend/vscode-core/src/messaging/rpc-handler.ts`, is already satisfied by `wizard:` and must be explicitly confirmed in review, not redundantly modified. `CompletionData` mirrors the output directory, aggregates, and agent outcomes; remove its obsolete `generatedCount` field.

## Integration architecture

1. A fresh deep analysis creates a v3 manifest with all phases pending; a resume query finds an unfinished manifest and the UI explicitly calls `wizard:deep-analyze` with `resume: true`.
2. For each phase, the service checkpoints `running`, streams UI-only events, captures complete assistant text from SDK messages, then checkpoints `completed`, `failed`, or `paused`. Only completed files reach RPC response, analysis results, and enhanced-prompt enrichment.
3. Enhanced prompt generation receives the canonical analysis directory, records the exact completed phase IDs it used, writes the Markdown/JSON trace through `IFileSystemProvider`, then saves state/cache.
4. Submit selection creates/updates a generation manifest and starts one abortable orchestrator. Per-agent callback checkpoints its terminal outcome. The watchdog/cancel controller stops future SDK/write work and waits for the final aggregate.
5. The handler propagates if at least one agent was actually written, writes/broadcasts one outcome payload, and leaves a paused/timed-out manifest discoverable.
6. After a restart, `WizardAnalysisRunner` asks `wizard:get-resumable-run`; `ScanProgressComponent` offers analysis resume, while `AnalysisResultsComponent` offers generation resume using persisted selection/input. Completion renders explicit final outcomes.

## Architecture-level quality requirements

- Functional: no phase that timed out or lacked a successful result appears as completed; no failed partial phase text enriches an enhanced prompt; each completion payload identifies output directory and every selected agent’s terminal outcome.
- Performance: retain the 100 ms UI throttle; persistence capture must not subscribe to it. Checkpoint writes occur once per lifecycle transition, not per stream delta.
- Security: validate all new RPC input with Zod; canonicalize `analysisDir` under the authorized workspace; use `IFileSystemProvider`; no raw AI HTML rendering is added.
- Maintainability: one storage owner for `.ptah/analysis` artifacts; no fleet dependency; no platform-adapter import; public type exports remain type-only where applicable.
- Testability: fake timers and abortable SDK handles prove watchdog behavior; in-memory file-system fakes prove checkpoint/trace paths; frontend signal tests prove restart discovery and explicit resume choices.

## Test plan

| Work item                           | Specs to add or extend                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Required behaviours                                                                                                                                                                                       |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Honest analysis + resume checkpoint | CREATE `agent-generation/src/lib/services/wizard/multi-phase-analysis.service.spec.ts`; CREATE `agent-generation/src/lib/services/analysis-storage.service.spec.ts`                                                                                                                                                                                                                                                                                                                                     | no-result/timeout is failed with error, complete assistant capture is preserved but excluded, pause/resume does not delete slug, stale running resumes, malformed manifest is rejected.                   |
| Enhanced-prompt trace               | EXTEND `agent-generation/src/lib/services/enhanced-prompts/enhanced-prompts.service.spec.ts`; EXTEND `rpc-handlers/src/lib/handlers/enhanced-prompts-rpc.handlers.spec.ts`                                                                                                                                                                                                                                                                                                                              | slug/fallback trace paths, exact JSON metadata, trace write failure, only completed phases used, unauthorized analysis directory rejected.                                                                |
| Abortable generation/outcomes       | EXTEND `agent-generation/src/lib/services/content-generation.service.spec.ts`; EXTEND `agent-generation/src/lib/services/file-writer.service.spec.ts`; EXTEND `agent-generation/src/lib/services/orchestrator.service.spec.ts`; EXTEND `rpc-handlers/src/lib/handlers/wizard-generation-rpc.handlers.spec.ts`                                                                                                                                                                                           | signal reaches SDK and halts writes, writer distinguishes unchanged, section counts survive, timeout partial run propagates exactly once, cancel is a pause.                                              |
| Shared/RPC resume contract          | EXTEND `rpc-handlers/src/lib/handlers/setup-rpc.handlers.spec.ts`; EXTEND `rpc-handlers/src/lib/handlers/setup-rpc.schema.spec.ts`; EXTEND `rpc-handlers/src/lib/handlers/wizard-generation-rpc.schema.spec.ts`; EXTEND `rpc-handlers/src/lib/rpc-allowlist.spec.ts`                                                                                                                                                                                                                                    | registry/manifest ownership, Zod rejection, resumable query DTO, analysis resume and generation terminal-file skipping.                                                                                   |
| Angular resume/outcomes             | EXTEND `setup-wizard/src/lib/services/wizard-rpc.service.spec.ts`; EXTEND `setup-wizard/src/lib/services/wizard-analysis-runner.service.spec.ts`; EXTEND `setup-wizard/src/lib/services/setup-wizard/wizard-phase-generation.spec.ts`; EXTEND `setup-wizard/src/lib/services/setup-wizard-state.service.spec.ts`; EXTEND `setup-wizard/src/lib/components/completion.component.spec.ts`; ADD/EXTEND component specs for `scan-progress.component.ts` and `analysis-results.component.ts` as appropriate | restart discovery displays the right action, resume calls correct RPC flags, outcome mapping preserves failed/unchanged statuses, completion displays explicit path/counts.                               |
| `.gitignore` policy                 | No Jest spec: use repository-policy acceptance checks rather than couple `harness-sync` to this workspace’s root ignore file.                                                                                                                                                                                                                                                                                                                                                                           | `git check-ignore -v` for each newly tracked directory and still-ignored local files; inspect `harness-reconciler.gitignore.spec.ts` only to confirm harness-generated ignore behavior remains unrelated. |

Run the relevant suites with `npx nx run-many -t test -p @ptah-extension/agent-generation @ptah-extension/rpc-handlers @ptah-extension/setup-wizard @ptah-extension/shared`; confirm Nx reports all four projects. Add `@ptah-extension/harness-sync` only if its existing policy spec is deliberately changed.

## File-by-file change list for file-disjoint execution

### Backend: agent-generation

- CREATE `libs/backend/agent-generation/src/lib/types/generation-checkpoint.types.ts`
- CREATE `libs/backend/agent-generation/src/lib/services/wizard/multi-phase-analysis.service.spec.ts`
- CREATE `libs/backend/agent-generation/src/lib/services/analysis-storage.service.spec.ts`
- MODIFY `libs/backend/agent-generation/src/lib/types/multi-phase.types.ts`
- MODIFY `libs/backend/agent-generation/src/lib/types/core.types.ts`
- MODIFY `libs/backend/agent-generation/src/lib/types/enhanced-prompts.types.ts`
- MODIFY `libs/backend/agent-generation/src/lib/types/index.ts`
- MODIFY `libs/backend/agent-generation/src/lib/interfaces/content-generation.interface.ts`
- MODIFY `libs/backend/agent-generation/src/lib/interfaces/agent-file-writer.interface.ts`
- MODIFY `libs/backend/agent-generation/src/lib/services/analysis-storage.service.ts`
- MODIFY `libs/backend/agent-generation/src/lib/services/wizard/multi-phase-analysis.service.ts`
- MODIFY `libs/backend/agent-generation/src/lib/services/enhanced-prompts/enhanced-prompts.service.ts`
- MODIFY `libs/backend/agent-generation/src/lib/services/content-generation.service.ts`
- MODIFY `libs/backend/agent-generation/src/lib/services/file-writer.service.ts`
- MODIFY `libs/backend/agent-generation/src/lib/services/orchestrator.service.ts`
- MODIFY the four existing agent-generation specs named in the Test plan.

### Backend: RPC handlers and shared contracts

- MODIFY `libs/backend/rpc-handlers/src/lib/handlers/setup-rpc.handlers.ts`
- MODIFY `libs/backend/rpc-handlers/src/lib/handlers/setup-rpc.schema.ts`
- MODIFY `libs/backend/rpc-handlers/src/lib/handlers/enhanced-prompts-rpc.handlers.ts`
- MODIFY `libs/backend/rpc-handlers/src/lib/handlers/enhanced-prompts-rpc.schema.ts`
- MODIFY `libs/backend/rpc-handlers/src/lib/handlers/wizard-generation-rpc.handlers.ts`
- MODIFY `libs/backend/rpc-handlers/src/lib/handlers/wizard-generation-rpc.schema.ts`
- MODIFY `libs/backend/rpc-handlers/src/lib/handlers/setup-rpc.handlers.spec.ts`
- MODIFY `libs/backend/rpc-handlers/src/lib/handlers/setup-rpc.schema.spec.ts`
- MODIFY `libs/backend/rpc-handlers/src/lib/handlers/enhanced-prompts-rpc.handlers.spec.ts`
- MODIFY `libs/backend/rpc-handlers/src/lib/handlers/wizard-generation-rpc.handlers.spec.ts`
- MODIFY `libs/backend/rpc-handlers/src/lib/handlers/wizard-generation-rpc.schema.spec.ts`
- MODIFY `libs/backend/rpc-handlers/src/lib/rpc-allowlist.spec.ts`
- MODIFY `libs/shared/src/lib/types/rpc/rpc-setup.types.ts`
- MODIFY `libs/shared/src/lib/types/rpc.types.ts`
- MODIFY `libs/shared/src/lib/types/wizard/phase.ts`

### Frontend: setup-wizard

- MODIFY `libs/frontend/setup-wizard/src/lib/services/setup-wizard-state.types.ts`
- MODIFY `libs/frontend/setup-wizard/src/lib/services/setup-wizard-state.service.ts`
- MODIFY `libs/frontend/setup-wizard/src/lib/services/setup-wizard/wizard-internal-state.ts`
- MODIFY `libs/frontend/setup-wizard/src/lib/services/setup-wizard/wizard-phase-generation.ts`
- MODIFY `libs/frontend/setup-wizard/src/lib/services/wizard-rpc.service.ts`
- MODIFY `libs/frontend/setup-wizard/src/lib/services/wizard-analysis-runner.service.ts`
- MODIFY `libs/frontend/setup-wizard/src/lib/components/scan-progress.component.ts`
- MODIFY `libs/frontend/setup-wizard/src/lib/components/analysis-results.component.ts`
- MODIFY `libs/frontend/setup-wizard/src/lib/components/completion.component.ts`
- MODIFY the corresponding specs named in the Test plan.

### Repository policy

- MODIFY `.gitignore`

## Team-leader handoff

- Recommended executors: backend-developer owns agent-generation; backend-developer or an RPC-focused worker owns handlers/shared; frontend-developer owns setup-wizard; a small policy change owns `.gitignore`. The files above are grouped to be file-disjoint.
- Complexity: HIGH. The change crosses durable files, SDK cancellation, wire contracts, two handler ownership boundaries, and restart UI state.
- Dependencies and ordering: shared wire contracts must land with handler changes; frontend consumes only that completed contract. Agent-generation checkpoint/output types must land before handlers persist or map them. `.gitignore` is independent.
- Parallel-safe work: repository policy is independent; frontend can prepare against the agreed shared DTO; agent-generation and RPC/shared should not edit the same files.
- Verification points: confirm `wizard:` is still represented in both compile-time registry and runtime prefix guard; verify all affected composition roots already provide `PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER`; run the four-project `run-many` command; use `git check-ignore -v` only after the ignore edit.

## Risks and open questions

- Version-2 manifests are intentionally historical and not resumable under the replacement v3 format. They are local, git-ignored artifacts; if preserving their UI listing is required, that is a separate explicit migration decision rather than an implicit compatibility shim.
- A phase completed after an earlier failed phase is still skipped on resume because the stated rule is “skip completed phases.” This preserves exact resume semantics but may retain an analysis that did not have a predecessor. If product wants dependency invalidation, define it explicitly in a follow-up.
- The current analysis-results component imports `ngx-markdown` directly (`analysis-results.component.ts:16`). This task must not extend that rendering path; any sanitizer migration is separate security work.
- The requested full `.claude/skills` tracking intentionally exposes managed/plugin skill changes in Git and can yield harness-sync foreign/blocked findings on machines whose manifests do not own those copies. That consequence is accepted by the recorded user decision.
