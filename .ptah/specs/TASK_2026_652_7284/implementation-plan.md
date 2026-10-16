# Implementation Plan  -  TASK_2026_652_7284

## Summary

Make harness proposals durable and session scoped; return New Project handoff data to its caller; add verified v4 analysis checkpoints and a shared freshness decision; allow both agent and system-prompt generation to gather current workspace facts when analysis is absent or stale. Preserve existing builder, wizard, CLI and messaging features. This is a backend slice with only a small harness-builder adapter.

## Verified facts

- Verified: `proposeConfig` currently validates and broadcasts without a session id or durable write (`libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/harness-namespace.builder.ts:1066-1090`).
- Verified: `harness:start-new-project` enables bundled plugins, composes a seed, then focuses chat, broadcasts a workflow request and disposes the wizard view (`libs/backend/rpc-handlers/src/lib/handlers/harness-rpc.handlers.ts:813-904`).
- Verified: the manifest is version 3 and the current schema has no phase session id or fingerprints (`libs/backend/agent-generation/src/lib/types/multi-phase.types.ts:34-102`).
- Verified: MCP `tools/call` runs inside request-scoped `AsyncLocalStorage` carrying the URL session (`libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts:347-364`; `mcp-request-context.ts:21-76`). The dispatcher already reads `getCallerSessionId()` for dashboard proposals (`protocol-dispatcher.ts:2252-2263`). `PtahAPIBuilder.resolveCallerSdkSessionId()` resolves a tab id through lifecycle to its real SDK id (`ptah-api-builder.service.ts:1035-1066`). This is the identity source for harness proposals.
- Verified: `PtahAPIBuilder` wires the harness namespace with workspace callbacks and a fire-and-forget broadcaster (`ptah-api-builder.service.ts:860-883`). Persistence must be awaited before that broadcaster runs.
- Verified: the current manifest loader accepts only v3 and returns null for invalid versions (`analysis-storage.service.ts:275-294`); fresh `createSlugDir` deletes an existing slug directory (`analysis-storage.service.ts:133-155`). The checkpoint starts a new run for completed/different-model manifests (`analysis-run-checkpoint.ts:48-124`).
- Verified: `InternalQueryHandle` exposes a stream, `abort`, and `close`, with no session property (`libs/backend/agent-sdk/src/lib/internal-query/internal-query.types.ts:116-132`). `isSystemInit` identifies SDK init messages (`agent-sdk/src/lib/types/sdk-types/claude-sdk.types.ts:352-354`). Current analysis stream deliberately uses synthetic `WizardPhaseId.fromPhase` for UI events (`multi-phase-analysis.service.ts:717-768`); it is not the SDK session id.
- Verified: orchestration already self-analyzes when `preComputedAnalysis` is absent (`orchestrator.service.ts:372-399`) and content generation falls back to formatted context without phase files (`content-generation.service.ts:571-587`). `regenerate` currently fails if no analysis directory exists (`enhanced-prompts.service.ts:639-675`), although `runWizard` gathers project/workspace details itself (`enhanced-prompts.service.ts:397-489`).
- Verified: setup RPC registers `wizard:get-resumable-run` and resolves analysis storage from the existing agent-generation token (`setup-rpc.handlers.ts:397-449`). Frontend `AppStateManager.requestHarnessWorkflow` is at `libs/frontend/core/src/lib/services/app-state.service.ts:1383-1392`. The branch comparison requested for TASK_2026_629 returned no `libs/frontend/core/` files; this plan does not need to edit core.
- Verified: no CLI/TUI/messaging-gateway occurrence of either harness broadcast was found by targeted repository search. The Configure Harness event consumer remains (`harness-workflow-message.handler.ts:40-68`).

## Design per objective 1-5

### 1. Session-scoped durable harness proposal

**Requirement:** restore preview after reload, merge successive partial updates, keep live delivery. **Chosen:** add a platform-core port `IHarnessProposalStore` and token `PLATFORM_TOKENS.HARNESS_PROPOSAL_STORE`; implement and register one workspace-local JSON store beside `HarnessConfigStore` in rpc-handlers. The vscode-lm-tools namespace receives `getCallerSdkSessionId: () => string | undefined` and `saveProposal: (sessionId: string, update: Partial<HarnessConfig>, complete: boolean) => Promise<HarnessProposal>` from `PtahAPIBuilder`. Resolve the store per tool call through `PLATFORM_TOKENS.DI_CONTAINER`, since `PtahAPIBuilder` is constructed before harness services register in VS Code, Electron and CLI (`ptah-api-builder.service.ts:508-517`; host registration sites listed in review). The store uses the **same host workspace provider** for write and `harness:get-proposal` read; proposal writes do not use `resolveSessionWorkspaceRoot` (`ptah-api-builder.service.ts:872`). This ensures a session with a worktree root can still hydrate through the host RPC. No RPC caller may select the storage root. **Rejected:** a process-global `Map` cannot survive restart; storing the proposal in frontend state leaves the backend unqueryable after reload. **Existing code affected:** `HarnessNamespaceDependencies`, builder wiring, harness RPC registration, shared payload/RPC types, and the handler hydration path.

Proposed shared shapes (new contracts, not claims about current exports):

```ts
interface HarnessProposal {
  version: 1;
  workspaceRoot: string;
  sessionId: string; // real SDK id, never tab id
  configUpdates: Partial<HarnessConfig>;
  isConfigComplete: boolean;
  updatedAt: string;
}
interface HarnessGetProposalParams { sessionId: string }
interface HarnessGetProposalResult { proposal: HarnessProposal | null }
interface HarnessConfigProposedPayload {
  sessionId: string;
  configUpdates: Partial<HarnessConfig>;
  isConfigComplete: boolean;
}
```

Boundary Zod: `z.object({sessionId:z.string().trim().min(1).max(256)}).strict()` for RPC; stored object schema uses `version:z.literal(1)`, ISO datetime, the shared `HarnessConfigUpdatesSchema` (verified `rpc-harness.schemas.ts:369`), and strict status/identity fields. File location: `<host-workspace>/.ptah/harness/proposals/<sha256(sessionId)>.json`; stored identity and root must match the request and provider. Use atomic temporary-write/rename under a per-session serial queue. Across processes acquire a bounded per-session lock file before read/merge/write; recover abandoned locks by expiry, then re-read the latest record. If the lock cannot be acquired, reject the update with no broadcast; a successful commit is last writer by `updatedAt`. Prune records older than 30 days during store access, and delete a proposal after successful apply when that hook is available. Share a pure `mergeHarnessConfigUpdates` function in `libs/shared/src/lib/utils/merge-harness-config-updates.ts` between backend store and frontend state. The existing merge is field-aware: persona/prompt/claudeMd merge nested objects, agents and MCP tool maps merge by key, and skill refs merge by skillId while preserving selected origins (`harness-builder-state.service.ts:325-410`). Persist first, then broadcast the accepted partial update and sessionId. A missing/unresolvable real SDK id returns a tool error and writes/broadcasts nothing; test the normal builder correlation-id path after lifecycle assigns `realSessionId` (`ptah-api-builder.service.ts:1035-1066`). An unavailable broadcaster is nonfatal after persistence. The reader returns null for absence; corrupt files are logged and rejected. `HarnessRpcHandlers.registerGetProposal` is called from `registerHandlers` beside `registerStartNewProject` (`harness-rpc.handlers.ts:351-357`). Frontend filters broadcasts by active real session and fetches proposal at rehydration; `HarnessWorkflowService` already holds a `ClaudeSessionId` (`harness-workflow.service.ts:172`).

### 2. Return New Project handoff

**Requirement:** caller owns navigation and still opens the builder with the seed. **Chosen:** keep validation, plugin enabling/reconcile and seed composition in `HarnessRpcHandlers.registerStartNewProject` (`harness-rpc.handlers.ts:820-854`), then return the handoff. Remove only that RPC's `HARNESS_OPEN_WORKFLOW` broadcast at `harness-rpc.handlers.ts:872`. Extract the relay's request/navigation logic for direct use by Setup Hub. Keep the existing event constant, payload, baseline entry and consumer case while TASK_2026_629 owns the webview and its routing tests; the consumer delegates to the extracted navigation method. This changes the New Project delivery path while retaining compatibility for existing event callers and tests. **Rejected:** keeping dual response/broadcast from this RPC would race and open twice. **Existing code affected:** handler result, shared type, Setup Hub call and the relay. No core edit needed.

```ts
type HarnessStartNewProjectResult =
  | { success: true; seedPrompt: string; intake: NewProjectIntake;
      plugins: { enabledBundled: string[]; missingExternal: ExternalPluginRef[];
                 availableSkillIds: string[] }; toolchain?: ToolchainProbeResult }
  | { success: false; error: string };
```

`NewProjectIntake`/`ExternalPluginRef`/`ToolchainProbeResult` should reuse their verified definitions in `rpc-harness.types.ts` and the current seed builder; if either latter type is not exported, use the exact exported data shape instead of introducing duplicate public types. Return only after plugin effects and seed assembly succeed. Setup Hub calls the extracted request-and-navigate behavior currently at `harness-workflow-message.handler.ts:100-141`, preserving same-mode resume, cross-mode abort and request rollback on navigation failure. The caller is the main webview (`app-state.service.ts:63-68`); keep `focusChat` and wizard-panel disposal in the RPC before returning (`harness-rpc.handlers.ts:856-904`). Setup Hub closes the modal only after `requestHarnessWorkflow` and navigation complete (`setup-hub.component.ts:1440-1458`); a navigation failure keeps it open and clears the pending request. Plugin write/reconcile failure remains a failed RPC; optional toolchain/skill discovery keeps current fail-closed fallback (`harness-rpc.handlers.ts:765-795`). Zod still validates intake before side effects (`harness-rpc.handlers.ts:820-823`).

### 3. V4 analysis manifest and SDK session identity

**Requirement:** one SDK chat session per phase, attempt/input/verification recorded durably. **Chosen:** v4 writer and explicit v3 reader. Capture `session_id` from the first SDK message carrying a nonempty ID inside `createTextCapturingStream`; prefer `system/init` when present and assert it agrees with any earlier ID. `isSystemInit` exists (`claude-sdk.types.ts:352-354`), while the stream captures raw messages (`multi-phase-analysis.service.ts:815-846`). A provider that omits init still completes with the first message's ID. Only a stream with no session ID at all leaves the phase unverified and returns a typed failure. Never record synthetic UI phase ID (`multi-phase-analysis.service.ts:717-768`).

```ts
interface PhaseResultV4 {
  status: AnalysisPhaseStatus;
  file: string;
  durationMs: number;
  attempt: number; // increment before every running transition
  sessionId: string | null; // SDK id of this attempt; null before init
  input: { workspaceSha256: string; promptSha256: string;
           priorPhaseSha256: string | null; model: string } | null;
  verification: { status: 'pending' | 'verified' | 'failed';
                  outputSha256: string | null; checkedAt: string | null };
  error?: string;
}
interface MultiPhaseManifestV4 {
  version: 4; runId: string; slug: string; analyzedAt: string;
  updatedAt: string; lifecycle: 'running'|'paused'|'completed'|'failed';
  model: string; totalDurationMs: number;
  workspaceFingerprint: WorkspaceFingerprint;
  phases: Record<MultiPhaseId, PhaseResultV4>;
}
```

Zod: strict v4 object with `version:z.literal(4)`, `attempt:z.number().int().nonnegative()`, `sessionId:z.string().trim().min(1).nullable()`, 64 lowercase hex hashes, `z.record(MultiPhaseIdSchema, PhaseResultV4Schema)`, and refinements: completed  implies  nonnull session, input and verified output hash; failed  implies  nonempty error. Keep the existing v3 schema under an explicit `MultiPhaseManifestV3Schema`; `readManifest` discriminates on `version` and returns `{kind:'current',manifest}` or `{kind:'legacy-v3',manifest}`. Never cast v3 to v4 or synthesize identity/hash. v3 remains displayable as legacy but not freshness-qualified or resumable. An unsupported/malformed version is null without rewriting. Ensure fresh v4 startup does not silently erase a v3 directory: move the v3 directory to a unique archival slug under `.ptah/analysis`, retaining its manifest and phase files for saved-analysis listing, then create the new v4 slug (`analysis-storage.service.ts:133-155,555-579`). This is a data archive required to preserve user output, not a runtime compatibility shim. **Assumption:** the filesystem port supports an atomic directory move; verify its operation and slug consumers before implementation. On v4 resume, compare recorded input fingerprints and verified file bytes before skipping a completed phase; mismatch restarts that phase and descendants, increments attempts, and clears old session/output verification. Checkpoint persists every transition (`analysis-run-checkpoint.ts:140-217`). SDK timeout/abort handling remains (`multi-phase-analysis.service.ts:630-673`).

### 4. Analysis freshness

**Requirement:** generation and UI agree whether analysis is usable. **Chosen:** one `AnalysisFreshnessService` in agent-generation, using storage's validated read path. `WorkspaceFingerprint = {algorithm:'sha256-v1'; digest:string; capturedAt:string}` hashes canonical relative names and bytes for root package manifests and lockfiles plus sorted top-level file/directory names; exclude `.ptah`, `.git`, dependencies, generated outputs. Add top-level Git HEAD only if the repository's filesystem abstraction exposes it safely; baseline does not require Git. Define `const ANALYSIS_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000` in the freshness service; compare completed manifest `updatedAt` against it. Fresh only when v4 completed, all four outputs verified and present with matching recorded SHA256, fingerprint matches, and age is at most seven days. Status response:

```ts
type AnalysisStatus = { state:'fresh'|'stale'|'missing';
  reason:'ok'|'no-analysis'|'legacy-v3'|'incomplete'|'expired'|
         'workspace-changed'|'output-mismatch'|'unreadable';
  analysisDir:string|null; checkedAt:string; analyzedAt:string|null };
type WizardAnalysisStatusParams = Record<string, never>;
type WizardAnalysisStatusResponse = AnalysisStatus;
```

New read-only `wizard:analysis-status` RPC in `SetupRpcHandlers.registerHandlers` beside `registerGetResumableRun` (`setup-rpc.handlers.ts:163,405-449`); types and source-registration follow `wizard:get-resumable-run` (`rpc.types.ts:1005-1008`). Register `AnalysisFreshnessService` under `AGENT_GENERATION_TOKENS.ANALYSIS_FRESHNESS_SERVICE` in `agent-generation/src/lib/di/tokens.ts` and `di/register.ts`, export it from `agent-generation/src/index.ts`, and resolve it through that token in the RPC and generation entry points. Update `MultiPhaseAnalysisResponse.manifest` in `rpc-setup.types.ts:48-70` to an explicit v3/v4 discriminated union; retain the common phase/status/file fields read by setup-wizard and CLI. `get-resumable-run` otherwise retains pause/retry semantics, except v3 is explicitly not resumable and starts a new v4 run while preserving legacy output. If fingerprint read fails, return stale/unreadable, never a false fresh. Hash only the bounded root metadata set, not the full repository, to keep UI status cheap. **Rejected:** mtime alone misses content replacement and can be coarse; Git HEAD alone misses uncommitted manifest changes. **Existing code affected:** storage and setup RPC, plus both generation entry points.

### 5. Self-gathering generation

**Requirement:** agent generation and system-prompt generation work when analysis is missing/old. **Chosen:** lightweight existing workspace discovery rather than rerun the four-phase analysis. `AgentGenerationOrchestratorService.analyzeWorkspace` obtains project info, monorepo and framework data through its analyzers (`orchestrator.service.ts:566-638`), while `EnhancedPromptsService.runWizard` gathers project/workspace data (`enhanced-prompts.service.ts:397-489`). These facts feed generation even without phase files. The content query runs at the workspace cwd with MCP wiring and 25 turns (`content-generation.service.ts:400-412`); the prompt designer runs at workspace cwd with MCP server access and 10 turns (`enhanced-prompts.service.ts:850-864`). Neither call specifies a restrictive tool allow-list, so available workspace tools remain usable; this is an inference from those query options and must be covered by prompt-input tests. At `wizard:submit-selection`, authorize the caller's analysis path as today (`wizard-generation-rpc.handlers.ts:251-278`), then ask freshness service; pass `preComputedAnalysis` and `analysisDir` only when fresh, otherwise omit both so orchestrator and content generator use current context (`content-generation.service.ts:571-587`). Preserve selected IDs, overrides, checkpoint, resume and retry. Treat caller-supplied analysis data without a validated fresh manifest as untrusted for generation; report stale status to UI, do not reject generation. At `EnhancedPromptsService.runWizard` and `regenerate`, use phase enrichment only for a fresh manifest; otherwise use the existing workspace intelligence path and no analysis directory. Remove the hard failure at `enhanced-prompts.service.ts:658-664`. Existing explicit analysisDir remains path-authorized by `enhanced-prompts-rpc.handlers.ts:231-246`; freshness applies to it too. On discovery failure, return the existing typed generation error, leave prior prompt intact, and do not mark a failed run successful. Preserve SDK timeout/cancel behavior already in generation services. **Rejected:** treating stale files as valid risks wrong stack advice; forcing Setup Wizard violates the user decision.

## Data migration

Version 3 is parsed with its own unchanged schema and surfaced as legacy/read-only. It is never treated as a v4 phase with inferred sessionId or hashes. A resume request for v3 starts a distinct fresh v4 run; preserve the v3 directory for saved-analysis viewing. The v4 writer is atomic at every checkpoint and new proposal files are schema-checked on read. Existing live proposal state has no durable format, so there is nothing to backfill; a new accepted proposal creates its record. Generation manifests remain their existing version and location (`analysis-storage.service.ts:5-8`).

## Batches

File-disjoint handoff; each batch touches at most six files and two libraries. Each command is scoped to its changed projects; the team-leader may split further but must not combine heavy checks.

| Batch | Files owned (specs count as files) | Verification command |
| --- | --- | --- |
| S shared proposal/status shapes first | new `shared/src/lib/types/rpc/rpc-harness-proposal.types.ts` (proposal and get-proposal shapes only), `shared/src/lib/types/rpc/rpc-harness.schemas.ts`, `shared/src/lib/types/rpc/rpc-setup.types.ts`, new `shared/src/lib/utils/merge-harness-config-updates.ts`, `shared/src/lib/utils/index.ts` (export merge utility), `shared/src/index.ts` (export proposal types; already re-exports utils) | `npx nx run-many -t typecheck,test,lint -p @ptah-extension/shared --parallel=1` |
| P proposal port | `platform-core/src/di/tokens.ts`, new `platform-core/src/interfaces/harness-proposal-store.interface.ts`, `platform-core/src/index.ts` (port export) | `npx nx run-many -t typecheck,test,lint -p @ptah-extension/platform-core --parallel=1` |
| A proposal store | new `rpc-handlers/src/lib/harness/config/harness-proposal-store.service.ts` + spec, `rpc-handlers/src/lib/harness/di.ts` | `npx nx run-many -t typecheck,test,lint -p @ptah-extension/rpc-handlers --parallel=1` |
| C New Project result, RPC map and harness handler | `shared/src/lib/types/rpc/rpc-harness.types.ts` (change `HarnessStartNewProjectResult` here, with the handler), `shared/src/lib/types/rpc.types.ts`, `shared/src/lib/types/rpc/host-source-registry.baseline.ts` (add new RPC; keep existing open-workflow entry); `rpc-handlers/src/lib/handlers/harness-rpc.handlers.ts` + spec; register `harness:get-proposal` in the handler method list before binding it; remove only the New Project broadcast | `npx nx run-many -t typecheck,test,lint -p @ptah-extension/shared @ptah-extension/rpc-handlers --parallel=1` |
| D1 direct builder handoff | `harness-builder/src/lib/components/setup-hub.component.ts` + spec, `services/harness-rpc.service.ts`, new `services/harness-workflow-request.service.ts` (extract request/navigation logic) | `npx nx run-many -t typecheck,test,lint -p @ptah-extension/harness-builder --parallel=1` |
| D2 proposal consumer and compatibility relay | `harness-builder/src/lib/services/harness-workflow-message.handler.ts` + spec; `shared/src/lib/types/messages/payload-map.ts` (add required sessionId to config-proposed payload only); keep the open-workflow relay case, event constant and payload, delegating its navigation to the D1 service | `npx nx run-many -t typecheck,test,lint -p @ptah-extension/harness-builder @ptah-extension/shared --parallel=1` |
| D3 shared merge adoption | `harness-builder/src/lib/services/harness-builder-state.service.ts` | `npx nx run-many -t typecheck,test,lint -p @ptah-extension/harness-builder --parallel=1` |
| B MCP writer | `vscode-lm-tools/src/lib/code-execution/namespace-builders/harness-namespace.builder.ts` + spec, `code-execution/ptah-api-builder.service.ts` + spec, `code-execution/mcp-core/protocol-dispatcher.ts` + its spec | `npx nx run-many -t typecheck,test,lint -p @ptah-extension/vscode-lm-tools --parallel=1` |
| E manifest schema/storage | `agent-generation/src/lib/types/multi-phase.types.ts`, `services/analysis-storage.service.ts` + spec, `services/wizard/analysis-run-checkpoint.ts` | `npx nx run-many -t typecheck,test,lint -p @ptah-extension/agent-generation --parallel=1`; then `npx nx run-many -t typecheck,test,lint -p @ptah-extension/setup-wizard ptah-cli --parallel=1` |
| F analysis run/freshness DI | `agent-generation/src/lib/services/wizard/multi-phase-analysis.service.ts` + spec, new `services/analysis-freshness.service.ts` + spec, `src/lib/di/tokens.ts`, `src/lib/di/register.ts` | `npx nx run-many -t typecheck,test,lint -p @ptah-extension/agent-generation --parallel=1` |
| G status RPC/export | `agent-generation/src/index.ts`, `rpc-handlers/src/lib/handlers/setup-rpc.handlers.ts` + spec | `npx nx run-many -t typecheck,test,lint -p @ptah-extension/agent-generation @ptah-extension/rpc-handlers --parallel=1` |
| H agent generation fallback | `rpc-handlers/src/lib/handlers/wizard-generation-rpc.handlers.ts` + spec; `agent-generation/src/lib/services/orchestrator.service.ts` + spec | `npx nx run-many -t typecheck,test,lint -p @ptah-extension/rpc-handlers @ptah-extension/agent-generation --parallel=1` |
| I prompt/content fallback | `agent-generation/src/lib/services/content-generation.service.ts` + spec, `services/enhanced-prompts/enhanced-prompts.service.ts` + spec | `npx nx run-many -t typecheck,test,lint -p @ptah-extension/agent-generation --parallel=1`; then `npx nx run-many -t typecheck,test,lint -p @ptah-extension/setup-wizard ptah-cli --parallel=1` |

Order S, P, A, C, D1, D2, D3, B, E, F, G, H, I. Each batch depends only on prior batches. S defines proposal/status contracts, schemas and the exported merge utility, while leaving the existing New Project result unchanged. P exports the port and token before A. C changes `HarnessStartNewProjectResult` in the same batch as its handler, and adds both RPC map/registry entries and the handler method list before binding the new handler. D1 extracts direct navigation; D2 retains the event relay and its transport while extending only the proposal payload before B broadcasts with the new shape. D3 adopts the shared merge. No earlier batch requires the new New Project success fields, and each producer/consumer pair is compiled together or after its contract. Every named file has one owning batch; each row is at most six files and two libraries. The two consumer commands verify contract impact and run sequentially after the owning batch.

## Test plan per batch

S: compile proposal/status RPC contracts, Zod schemas, exported merge utility and field-aware merge behavior; the old New Project result remains valid. P: compile exported port and token. A: concurrent partial writes, same-session merge, distinct-session isolation, restart read, corrupt record rejection, 30-day pruning, two-process lock behavior. C: RPC map/registry agreement, intake validation before plugin effects, enabled/missing plugin diagnostics in return, required New Project result fields emitted by the handler, no New Project event, get-proposal reads same root as writer. D1: successful request/navigation, same-mode resume, cross-mode abort, navigation failure clears request and keeps modal open. D2: legacy open-workflow event still navigates, config-proposed event is filtered by matching real session, reload hydrates only matching session. D3: frontend merge matches backend partial-update merge. B: builder correlation ID resolves after lifecycle assigns real SDK ID; absent ID rejects before write/broadcast; persisted-then-broadcast ordering, including required sessionId (F17). E: exact v3 read-only path, paused-v3 new-v4 resume, malformed/unsupported versions, v4 round-trip, no erasure of v3, attempt transition and verified hash; compile setup-wizard and CLI consumers. F: init ID versus synthetic UI ID, non-Anthropic stream without init succeeds from first message ID, entirely absent ID fails, output mismatch invalidates downstream, expiry/fingerprint matrix, read error is stale. G: status RPC validates request and does not mutate disk; no workspace is missing. H: missing/stale analysis still generates from workspace and gathered context reaches the content prompt, fresh analysis retains richer path, unauthorized path rejected, checkpoint/resume preserved. I: regenerate without analysis, stale explicit/latest analysis ignored, gathered context reaches prompt designer, forced cache invalidation, fresh phase enrichment, workspace discovery failure preserves prior state; compile CLI consumer. Do not run any verification in this architecture task.

## Risks

- The MCP URL may carry a tab id. Use `resolveCallerSdkSessionId` and reject unresolved identity (`ptah-api-builder.service.ts:1035-1066`); never persist under the tab id.
- `createSlugDir` currently deletes existing output (`analysis-storage.service.ts:133-155`); distinct run naming or archive must be verified against all slug consumers before v3 migration is implemented.
- Builder workflow holds a real `ClaudeSessionId` (`harness-workflow.service.ts:172`); use it for proposal hydration and event filtering, and test reload before any new tool call.
- Current explicit system-prompt enrichment uses raw `JSON.parse` (`enhanced-prompts.service.ts:1001-1015`). Route through validated storage/freshness decision; retain path authorization and avoid secret-bearing error logs.
- Cross-library DI token registration must be available in VS Code, Electron and CLI hosts. `registerHarnessServices` currently binds `HarnessConfigStore` (`harness/di.ts:44-57`); verify all host bootstrap sequences invoke it before the MCP namespace is used.
- The branch comparison found no core overlap with TASK_2026_629; avoid canvas/chat/webview files entirely.

## Decisions

| Decision | Options and evidence | Reversible? |
| --- | --- | --- |
| Persist proposals in backend workspace store via platform port | Chosen over frontend-only replay: namespace currently only broadcasts (`harness-namespace.builder.ts:1078-1081`), and platform token pattern exists (`ptah-api-builder.service.ts:230-236`). | Yes; format versioned. |
| Return New Project seed instead of broadcast on that RPC | Chosen over dual delivery: current host broadcast plus caller success can race (`harness-rpc.handlers.ts:866-904`); its only producer is this RPC (`:872`). The existing event transport stays for compatibility until TASK_2026_629 merges. | Yes; transport can be restored. |
| Explicit v4/v3 discriminator | Chosen over accepting v3 as v4: v3 has no session/hash fields (`multi-phase.types.ts:34-102`). | No for new writes; legacy reader retained. |
| Bounded metadata fingerprint and seven-day age | Chosen over Git-only/mtime-only: current manifest has no workspace identity (`multi-phase.types.ts:49-68`); hashing all source would be too expensive for UI reads. | Yes; algorithm tagged. |
| Lightweight self-discovery | Chosen over rerunning four phases: existing orchestrator and prompt service already gather workspace details (`orchestrator.service.ts:372-399`; `enhanced-prompts.service.ts:397-489`). | Yes. |

## Proposed Removals

None. Keep the existing `HARNESS_OPEN_WORKFLOW` transport and consumer in this slice; only its New Project producer changes to an RPC return.

## Deferred review items

After TASK_2026_629 merges, review removal of the unused `HARNESS_OPEN_WORKFLOW` transport. Change `libs/shared/src/lib/types/messages/message-constants.ts:194`, `libs/shared/src/lib/types/messages/payload-map.ts:199-200,417`, `libs/shared/src/lib/types/rpc/host-source-registry.baseline.ts:515`, and `libs/frontend/harness-builder/src/lib/services/harness-workflow-message.handler.ts:40-141` with its spec. Update `apps/ptah-extension-webview/src/app/unit5-message-routing.spec.ts:74,209,236` (TASK_2026_629-owned) and retarget the Electron e2e event injection cases to the New Project RPC result in `apps/ptah-electron-e2e/src/specs/harness/new-project.spec.ts:95`, `new-project-dotnet.spec.ts:109`, `new-project-question-routing.spec.ts:91`, and `tasks/message-handlers-eager.spec.ts:107`. Recheck all producers and consumers before deleting the transport. This deferred cleanup is not a user-visible capability removal.

## Revision log

Round 1: F1..F11 addressed (ordered shared/port/store/RPC batches and complete file ownership; direct New Project navigation; setup-wizard/CLI checks; one proposal root; correlation-ID test; missing-init and paused-v3 tests; retention and cross-process lock; workspace-query evidence and prompt-input tests; focus/dispose and modal ordering; merge utility in shared utils). F12: UTF-8 text normalized. The round-1 relay-removal proposal was superseded by F13.

Round 2: F13-F17 addressed (F13 keeps the event constant, payload, baseline entry, relay and dependent tests until TASK_2026_629 merges; C removes only the New Project producer; F14 moves the required result type into C with its handler and rechecks batch order; F15 adds CLI parity rows; F16 exports the merge utility from shared utils and the proposal types from the root barrel; F17 needs no order change because the namespace broadcast is untyped, with a B regression for sessionId).

