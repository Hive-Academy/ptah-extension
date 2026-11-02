# Backend data contract behind Ptah's setup workflows

Read-only audit of what the setup/onboarding backend already emits as **structured
RPC/push data** versus what exists only as **free-form chat stream text**, to decide
whether dedicated non-chat step UIs (stepper, progress list, per-agent status cards,
result review) can be built on the existing contract.

Paths are repo-relative to the worktree root. All findings verified against source.

---

## Workflows

### 1. Workspace scan / deep analysis (`wizard:deep-analyze`)

| Concern | RPC method | Request type (file:line) | Response type (file:line) | Handler (file:line) |
|---|---|---|---|---|
| Run analysis (supports resume) | `wizard:deep-analyze` | `WizardDeepAnalyzeParams` `libs/shared/src/lib/types/rpc/rpc-setup.types.ts:130` | `MultiPhaseAnalysisResponse` `libs/shared/src/lib/types/rpc/rpc-setup.types.ts:209` | `libs/backend/rpc-handlers/src/lib/handlers/setup-rpc.handlers.ts:283` |
| Freshness check | `wizard:analysis-status` | `WizardAnalysisStatusParams` `rpc-setup.types.ts:166` | `AnalysisStatus` `rpc-setup.types.ts:149` | `setup-rpc.handlers.ts:464` |
| Cancel running analysis | `wizard:cancel-analysis` | `WizardCancelAnalysisParams` `rpc-setup.types.ts:281` | `WizardCancelAnalysisResponse` `rpc-setup.types.ts:288` | `setup-rpc.handlers.ts:764` |
| Discover unfinished run | `wizard:get-resumable-run` | `WizardGetResumableRunParams` `rpc-setup.types.ts:313` | `WizardGetResumableRunResponse` `rpc-setup.types.ts:337` | `setup-rpc.handlers.ts:416` |
| List saved analyses | `wizard:list-analyses` | — | `{ analyses: SavedAnalysisMetadata[] }` | `setup-rpc.handlers.ts:822` |
| Load one analysis | `wizard:load-analysis` | `{ filename }` | `MultiPhaseAnalysisResponse` | `setup-rpc.handlers.ts:858` |

**Push events emitted during a run** (broadcast to webviews; no tab routing):

| Message type | Payload type | Fields | Emitter |
|---|---|---|---|
| `setup-wizard:scan-progress` | `ScanProgressPayload` `libs/shared/src/lib/types/wizard/phase.ts:51` | `filesScanned`, `totalFiles`, `detections`, `currentPhase`, `phaseLabel`, `agentReasoning`, `completedPhases`, `currentPhaseNumber`, `totalPhaseCount`, **`phaseStatuses: Array<{id; status: pending|running|completed|failed|skipped}>`** | `libs/backend/agent-generation/src/lib/services/wizard/multi-phase-analysis.service.ts:1006`, `agentic-analysis.service.ts:431` |
| `setup-wizard:analysis-stream` | `AnalysisStreamPayload` `phase.ts:81` | `kind: text|tool_start|tool_input|tool_result|thinking|error|status`, `content`, `toolName`, `toolCallId`, `isError`, `timestamp`, optional `flatEvent` (`FlatStreamEventUnion` for execution-tree rendering) | `multi-phase-analysis.service.ts:1130`, `agentic-analysis.service.ts:447` |

**Terminal signal**: the RPC response itself — `MultiPhaseAnalysisResponse.manifest`
(`MultiPhaseManifestV4` `rpc-setup.types.ts:190`) carries per-phase `PhaseResultV4`
(status, file, durationMs, attempt, sessionId, verification, error) at
`rpc-setup.types.ts:169`, plus `phaseContents` markdown keyed by phase id. Phase ids
are fixed — see `MultiPhaseId`
`libs/backend/agent-generation/src/lib/types/multi-phase.types.ts:20`:
`project-profile`, `architecture-assessment`, `quality-audit`, `elevation-plan`.

> **Dead contract members:** `setup-wizard:analysis-complete`
> (`AnalysisCompletePayload` `phase.ts:134`) and `setup-wizard:available-agents`
> (`AvailableAgentsPayload` `phase.ts:156`) are declared in the shared union
> (`phase.ts:282`) and still handled by the frontend dispatcher
> (`libs/frontend/setup-wizard/src/lib/services/setup-wizard/wizard-message-dispatcher.ts:69`-`73`),
> but **no backend emitter exists** for either (grep over `libs/backend` finds none).

### 2. Agent recommendation (`wizard:recommend-agents`)

| RPC method | Request | Response | Handler |
|---|---|---|---|
| `wizard:recommend-agents` | `{ isMultiPhase: true, analysisDir }` or `{ mode: 'workspace-catalog', tabBinding? }` (`WizardRecommendAgentsCatalogParams` `rpc-setup.types.ts:265`) | `AgentRecommendation[]` `libs/shared/src/lib/types/wizard/recommendations.ts:50` — `agentId`, `agentName`, `relevanceScore`, `matchedCriteria`, `category`, `recommended`, `description?`, `icon?` | `setup-rpc.handlers.ts:499` |

Bounded LLM call (frontend budget 60 s, `wizard-rpc.service.ts:38`). **No push
events** — it is a plain request/response step.

### 3. Agent generation (`wizard:submit-selection`)

| Concern | RPC method | Request / response types | Handler |
|---|---|---|---|
| Pre-run file preview | `wizard:preview-generation` | `WizardPreviewGenerationParams` `rpc-setup.types.ts:353` → `WizardPreviewGenerationResponse` `rpc-setup.types.ts:395` (per-agent `files[]` with `relPath`, `target`, `certainty`, `condition?`, `willOverwrite`) | `wizard-generation-rpc.handlers.ts:1043` |
| Start / resume run | `wizard:submit-selection` | `WizardSubmitSelectionParams` `rpc-setup.types.ts:294` → `WizardSubmitSelectionResponse` `rpc-setup.types.ts:343` with `accepted: SetupGenerationAccepted` `rpc-setup.types.ts:46` (`runId`, `source`, `status:'starting'`, `effectiveProvider`, `effectiveModel`) or typed `rejection` `rpc-setup.types.ts:54` | `wizard-generation-rpc.handlers.ts:290` |
| Run state lookup | `wizard:get-generation-run-state` | `WizardGetGenerationRunStateParams` `rpc-setup.types.ts:605` → `SetupGenerationRunState` `rpc-setup.types.ts:98` (binding, lifecycle status, result facts) | `wizard-generation-rpc.handlers.ts:233` |
| Cancel | `wizard:cancel` | `WizardCancelResponse` `rpc-setup.types.ts:413` | `wizard-generation-rpc.handlers.ts:1261` |
| Retry one failed agent | `wizard:retry-item` | `WizardRetryItemResponse` `rpc-setup.types.ts:431` | `wizard-generation-rpc.handlers.ts:1372` |
| Checkpoint discovery | `wizard:get-resumable-run` | `ResumableGenerationRun` `rpc-setup.types.ts:326` with per-agent `ResumableGenerationAgent` `rpc-setup.types.ts:316` (`agentId`, `filePath`, `status: pending|running|written|unchanged|failed`, `rejectedSections`, `tailoredSections`, `error`) | `setup-rpc.handlers.ts:416` |

**Push events emitted during a run** (all routed by `tabBinding:
SetupGenerationRunBinding` `rpc-setup.types.ts:20` = tabId + workflow +
workspacePath + runId):

| Message type | Payload type | Fields | Emitter |
|---|---|---|---|
| `setup-wizard:generation-stream` | `GenerationStreamPayload` `phase.ts:118` = `AnalysisStreamPayload` + `tabBinding` + `lifecycle` + **`agentId`** (which agent template is being processed) | produced per agent in `libs/backend/agent-generation/src/lib/services/content-generation.service.ts:675`, `:684`, `:711`; broadcast in `wizard-generation-rpc.handlers.ts:1704` |
| `setup-wizard:generation-progress` | `GenerationProgressPayload` `phase.ts:178` | `progress.phase: analysis|selection|customization|rendering|complete`, `progress.percentComplete` (0-100), `progress.currentAgent`, `tabBinding`, `lifecycle:'running'` | progress produced at `libs/backend/agent-generation/src/lib/services/orchestrator.service.ts:359`, `:592`, `:801`, `:868` (`GenerationProgress` `orchestrator.service.ts:92`); broadcast `wizard-generation-rpc.handlers.ts:1735` |
| `setup-wizard:generation-complete` | `GenerationCompletePayload` `phase.ts:215` | `success`, `terminalStatus`, `result: SetupGenerationResultFacts` `rpc-setup.types.ts:65` (per-agent `agentOutcomes`, counts, propagation, committedState), `outputDirectory`, `writtenCount`, `unchangedCount`, `failedCount`, **`agents: GenerationAgentOutcome[]`** `phase.ts:202` (`agentId`, `filePath`, `status: written|unchanged|failed`, `rejectedSections`, `tailoredSections`, `error`), `errors[]`, `warnings[]`, `duration` | broadcast `wizard-generation-run.supervisor.ts:364` (payload assembled `:290`-`346`) |

> `SetupGenerationRunLifecycle` (`starting|running|cancelling|completed|cancelled|
> failed|timed-out`) at `rpc-setup.types.ts:32` is carried on every push and on
> run-state lookups.

### 4. Project guidance / Enhanced Prompts

| Concern | RPC method | Types / handler |
|---|---|---|
| Run | `enhancedPrompts:runWizard` | `EnhancedPromptsRunWizardParams` `rpc-setup.types.ts:491` → `EnhancedPromptsRunWizardResponse` `rpc-setup.types.ts:528` (`success`, `accepted`, `rejection`, `generatedAt`, `detectedStack`, **`summary: EnhancedPromptsSummary`** `rpc-setup.types.ts:516` with per-section `name/wordCount/generated`); handler `enhanced-prompts-rpc.handlers.ts:241` |
| Regenerate | `enhancedPrompts:regenerate` | `rpc-setup.types.ts:562`/`574`; handler `enhanced-prompts-rpc.handlers.ts:504` |
| Cancel | `enhancedPrompts:cancel` | `EnhancedPromptsCancelResponse` `rpc-setup.types.ts:589` (`cancelled`, `outcome`); handler `:132` |
| Run state | `enhancedPrompts:getRunState` | `EnhancedPromptsGetRunStateResponse` `rpc-setup.types.ts:600` (`SetupGenerationRunState|null`); handler `:136` |
| Status / content / download / toggle | `enhancedPrompts:getStatus` `:168`, `getPromptContent` `:918`, `download` `:974`, `setEnabled` `:446` | `EnhancedPromptsGetStatusResponse` `rpc-setup.types.ts:473` |

**Push events during a run:**

| Message type | Payload type | Fields | Emitter |
|---|---|---|---|
| `setup-wizard:enhance-stream` | `EnhancedGenerationStreamPayload` `phase.ts:125` = `AnalysisStreamPayload` + `tabBinding` + `lifecycle` | broadcast `enhanced-prompts-rpc.handlers.ts:1064`; bound runs tag events with `tabBinding` + `lifecycle:'running'` at `:760` |
| (terminal) same `enhance-stream` channel | `kind: 'status'` event with terminal `lifecycle` (`completed|cancelled|failed|timed-out`) | `broadcastGuidanceTerminal` `enhanced-prompts-rpc.handlers.ts:844`-`872` |

> **Dead contract member:** `setup-wizard:error` (`WizardErrorPayload` `phase.ts:249`)
> is in the shared union and the frontend dispatcher, but **no backend emitter
> exists**; bound failures are signalled via the terminal `enhance-stream` status
> event plus `getRunState`.

### 5. New-project intake

| Concern | RPC method | Types / handler |
|---|---|---|
| Hand off to harness surface | `harness:start-new-project` | `HarnessStartNewProjectParams` → `HarnessStartNewProjectResult` `libs/shared/src/lib/types/rpc/rpc-harness.types.ts:518` — `{ success: true, seedPrompt, intake, plugins { enabledBundled, missingExternal, availableSkillIds }, toolchain? }`; handler `libs/backend/rpc-handlers/src/lib/handlers/harness-rpc.handlers.ts:835` |

The **run itself is a chat session**: the frontend creates a chat tab and sends
`seedPrompt` as the first user turn (`harness-workflow-request.service.ts:374`-`443`,
first send `:166`-`206`). The backend enables the `ptah-nx-saas` plugin and returns
the prompt; it does not track a "new-project run".

**Structured push event** (the only one):

| Message type | Payload type | Fields | Emitter |
|---|---|---|---|
| `harness:config-proposed` | `HarnessConfigProposedPayload` `libs/shared/src/lib/types/messages/payload-map.ts:223` | `sessionId` (real SDK session id), `configUpdates: Partial<HarnessConfig>`, `isConfigComplete`, `revision: HarnessProposalRevision` (`rpc-harness-proposal.types.ts:7`) | `proposeConfig` MCP tool, `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/harness-namespace.builder.ts:1092`-`1147` (broadcast at `:1141`) |

Durable proposal lookup: `harness:get-proposal` → `HarnessGetProposalResult`
(`rpc-harness-proposal.types.ts:32`), handler `harness-rpc.handlers.ts:929`.
Everything else (discovery, scaffolding steps, phase narration) is ordinary chat
stream text from the agent session.

### 6. AI team / harness builder

Two distinct execution models share the surface:

**(a) Bounded RPC LLM helpers** — plain request/response, 60-180 s frontend budgets
(`harness-rpc.service.ts:88`-`286`), registered `harness-rpc.handlers.ts:173`-`190`:

| RPC method | Response type (file:line) |
|---|---|
| `harness:initialize` (handler `:370`) | `HarnessInitializeResponse` |
| `harness:suggest-config` | `HarnessSuggestConfigResponse` |
| `harness:design-agents` | `HarnessDesignAgentsResponse` (`subagents[]`, `reasoning`) `rpc-harness.types.ts:356` |
| `harness:generate-skills` / `harness:generate-document` / `harness:generate-prompt` / `harness:generate-claude-md` | `HarnessGeneratePromptResponse` `rpc-harness.types.ts:301`, etc. |
| `harness:analyze-intent` (handler `:688`) | `HarnessAnalyzeIntentResponse` `rpc-harness.types.ts:389` — `persona`, `suggestedAgents`, `suggestedSubagents`, `suggestedSkills`, `suggestedSkillSpecs`, `suggestedPrompt`, `suggestedMcpServers`, `summary`, `reasoning` |
| `harness:apply` (writes files) | `HarnessApplyResponse` `rpc-harness.types.ts:328` — **`appliedPaths[]`**, `warnings[]` |
| `harness:search-skills`, `harness:create-skill`, `harness:discover-mcp`, `harness:save-preset`, `harness:load-presets` | see `rpc-harness.types.ts` |

These long LLM calls **do stream** progress pushes:

| Message type | Payload type | Fields | Emitter |
|---|---|---|---|
| `harness:stream` | `HarnessStreamPayload` `rpc-harness.types.ts:557` | `operation: analyze-intent|suggest-config|design-agents|generate-skills|generate-document` (`HarnessStreamOperation` `rpc-harness.types.ts:549`), `operationId`, `kind: text|thinking|tool_start|tool_input|tool_result|error|status`, `content`, `toolName`, `toolCallId`, `isError`, `timestamp` | `libs/backend/rpc-handlers/src/lib/harness/streaming/harness-stream-broadcaster.service.ts:75` |
| `harness:stream-complete` | `HarnessStreamCompletePayload` `rpc-harness.types.ts:584` | `operation`, `operationId`, `success`, `error?`, `timestamp` | `harness-stream-broadcaster.service.ts:119` |

**(b) Agent-driven configure mode** — same chat-driven model as new-project:
`harness:workflow-prompt` (handler `harness-rpc.handlers.ts:954`, response
`HarnessWorkflowPromptResponse` `rpc-harness.types.ts:544`) composes a seed prompt,
which the frontend sends into a chat tab (`harness-workflow-request.service.ts:382`-`389`).
The agent proposes config through the same `proposeConfig` tool → `harness:config-proposed`
push (see workflow 5). `harness:open-workflow` (`HarnessOpenWorkflowPayload`
`payload-map.ts:207`) opens the surface from the host; no producer exists inside
`libs/backend` (frontend consumer: `harness-workflow-message.handler.ts:35`-`38`).

---

## Structured vs. stream-only

| Workflow | Data a step UI needs | Available as structured event? | Evidence |
|---|---|---|---|
| Workspace scan / analysis | Phase stepper with per-phase status | **Yes** — `scan-progress.phaseStatuses[]` (`id` + `status`), `currentPhaseNumber`/`totalPhaseCount`, `phaseLabel` | `phase.ts:51`-`75`, emitted `multi-phase-analysis.service.ts:1006` |
| Workspace scan / analysis | Progress % | **Partial** — phase number/count is structured; there is no 0-100 percent field; file counts are `0` in the multi-phase path | `phase.ts:66`-`74`, `multi-phase-analysis.service.ts:990`-`996` |
| Workspace scan / analysis | Produced files (phase outputs) | **Yes** — `manifest.phases[id].file` + `phaseContents` markdown in the RPC response | `rpc-setup.types.ts:190`-`238` |
| Workspace scan / analysis | Errors | **Yes** — per-phase `status:'failed'` + `error` in manifest; `analysis-stream` `kind:'error'` during run | `rpc-setup.types.ts:169`-`188`, `phase.ts:81`-`108` |
| Workspace scan / analysis | Final result | **Yes** — `MultiPhaseAnalysisResponse` (manifest + contents) | `rpc-setup.types.ts:209` |
| Workspace scan / analysis | Completion push (webview-reload safe) | **Stream-text only / none** — terminal is the long-held RPC response; the declared `setup-wizard:analysis-complete` push has **no backend emitter** | `phase.ts:134`, no emitter in `libs/backend` |
| Agent recommendation | Per-agent cards (name, score, reason) | **Yes** — `AgentRecommendation[]` fields incl. `matchedCriteria`, `icon` | `recommendations.ts:50`-`67` |
| Agent generation | Phase / step | **Yes** — `generation-progress.progress.phase` + `percentComplete` | `phase.ts:178`-`199`, `orchestrator.service.ts:92` |
| Agent generation | Per-item (agent) status | **Yes** — `generation-stream.agentId` during run; `generation-complete.agents[]` (`GenerationAgentOutcome`) at the end; checkpoint per-agent status via `get-resumable-run` | `phase.ts:118`-`123`, `phase.ts:202`-`243`, `rpc-setup.types.ts:316`-`334` |
| Agent generation | Progress % | **Yes** — `percentComplete` | `phase.ts:190` |
| Agent generation | Produced files | **Yes** — `agents[].filePath`, `outputDirectory`; pre-run `wizard:preview-generation` (`willOverwrite`, `certainty`); post-run propagation targets in `result.propagation.targets` | `phase.ts:222`-`234`, `rpc-setup.types.ts:373`-`403`, `rpc-setup.types.ts:91`-`95` |
| Agent generation | Errors | **Yes** — per-agent `error`, `errors[]`, `warnings[]`, typed `rejection` | `phase.ts:202`-`243`, `rpc-setup.types.ts:54`-`63` |
| Agent generation | Final result / run lifecycle | **Yes** — `generation-complete` with `terminalStatus` + `SetupGenerationResultFacts` (counts, committedState, enhancedPromptsUsed); `wizard:get-generation-run-state` for reload recovery | `phase.ts:215`-`243`, `rpc-setup.types.ts:98`-`107` |
| Project guidance | Run lifecycle | **Yes** — same binding/run-state machinery (`enhancePrompts:getRunState`, terminal `enhance-stream` status event with terminal lifecycle) | `rpc-setup.types.ts:595`-`603`, `enhanced-prompts-rpc.handlers.ts:844`-`872` |
| Project guidance | Per-section progress during run | **Stream-text only** — sections are narrated in the text stream; structured section data exists only in the **final** `summary.sections[]` | `rpc-setup.types.ts:506`-`525` |
| Project guidance | Progress % | **No** — no progress event exists for guidance | none in `phase.ts:125`-`128` |
| Project guidance | Produced files / errors | **Yes** — `getStatus` (`generatedAt`, `detectedStack`), `getPromptContent`, response `error`; no per-section failure list beyond `summary.sections[].generated` | `rpc-setup.types.ts:473`-`488`, `:506`-`513` |
| New-project intake | Intake → run handoff | **Yes (start only)** — `HarnessStartNewProjectResult` (`seedPrompt`, `plugins`, `toolchain`) | `rpc-harness.types.ts:518`-`527` |
| New-project intake | Steps / progress during the run | **Stream-text only** — the run is a chat session; no phase events exist | `harness-workflow-request.service.ts:430`-`442` |
| New-project intake | Structured result | **Partial** — `harness:config-proposed` revisions (`configUpdates`, `isConfigComplete`) + `harness:get-proposal`; everything else is chat | `payload-map.ts:223`-`231`, `harness-namespace.builder.ts:1141` |
| Team / harness builder (bounded helpers) | Per-operation progress and completion | **Yes** — `harness:stream` + `harness:stream-complete` (operation, operationId, success/error) | `rpc-harness.types.ts:557`-`600`, `harness-stream-broadcaster.service.ts:75`, `:119` |
| Team / harness builder (bounded helpers) | Final result / produced files | **Yes** — typed responses per method; `harness:apply` returns `appliedPaths[]` | `rpc-harness.types.ts:328`-`332`, `:389`-`412` |
| Team / harness builder (agent-driven configure) | Steps / progress | **Stream-text only** — same chat model as new-project | `harness-rpc.handlers.ts:954`, `harness-workflow-request.service.ts:382`-`389` |

---

## Run lifecycle

### Workspace scan / analysis
- **Start**: `wizard:deep-analyze { model?, resume? }` (`wizard-rpc.service.ts:315`,
  frontend timeout 61 min). The RPC call stays open for the whole run; progress
  arrives via `scan-progress`/`analysis-stream` pushes.
- **Cancel**: `wizard:cancel-analysis` aborts the service's AbortController
  (`setup-rpc.handlers.ts:764`-`800`).
- **Resume / reload**: `wizard:get-resumable-run` returns a persisted
  `MultiPhaseAnalysisResponse | null` for an unfinished run (`setup-rpc.handlers.ts:416`);
  `deepAnalyze({ resume: true })` continues it (`rpc-setup.types.ts:134`). Freshness:
  `wizard:analysis-status`.
- **Completion/failure**: the RPC response (or its error). **No push message marks
  analysis completion** — a reloaded webview that lost the RPC response must rediscover
  via `get-resumable-run` / `analysis-status`.
- **Chat-tab dependency**: none. No `tabBinding` is involved anywhere in analysis.

### Agent generation
- **Start**: frontend creates/binds a generation tab and calls
  `wizard:submit-selection` with `tabBinding` + `selectedAgentIds` (+ `model`)
  (`wizard-rpc.service.ts:121`-`149`). Response is immediate:
  `accepted { runId, status:'starting', effectiveProvider/Model }` or a typed
  rejection (`blocked` with `ownerTabId` when a run is already active — single
  active run per backend, `wizard-generation-rpc.handlers.ts:322`-`337`).
- **During**: `generation-stream` (per-agent token/tool stream) and
  `generation-progress` (phase + percent) pushes, both tagged with `tabBinding` +
  runId; the current chat UI bridges them into a chat transcript
  (`generation-run-event-adapter.ts:40`-`123`).
- **Cancel**: `wizard:cancel { tabBinding }` → `{ cancelled }`
  (`wizard-rpc.service.ts:104`).
- **Retry one agent**: `wizard:retry-item { itemId, tabBinding }`.
- **Resume / reload**: `wizard:get-resumable-run` returns the checkpoint
  (`ResumableGenerationRun`, per-agent status); resume is `submit-selection` with
  `resume: true` and empty selection — the backend reuses its persisted checkpoint
  (`wizard-rpc.service.ts:364`-`382`). After a webview reload, run state is
  re-fetched with `wizard:get-generation-run-state` (`wizard-rpc.service.ts:86`).
- **Completion/failure**: single `setup-wizard:generation-complete` push carrying
  `terminalStatus` + full result facts (`wizard-generation-run.supervisor.ts:364`);
  the frontend also treats that push as a trigger to refresh run state
  (`generation-run-event-adapter.ts:94`-`121`). A lost terminal push is recovered by
  the run-state lookup.
- **Chat-tab dependency**: the backend only validates the binding's
  `workspacePath` against the host workspace (`authorizeTabWorkspace`,
  `wizard-generation-rpc.handlers.ts:296`-`309`) — **it never checks that a chat
  tab exists**; `tabId` is an opaque routing key. The chat-tab requirement is a
  frontend rendering choice (`generation-run-event-adapter.ts` feeds events into
  `StreamingHandlerService` per tab). A non-chat UI can mint any stable tab id.

### Project guidance (Enhanced Prompts)
- **Start**: `enhancedPrompts:runWizard` / `:regenerate` with `tabBinding` →
  `accepted { runId }` (same `SetupGenerationAccepted` envelope) — bound execution
  is fire-and-forget after the ack (`enhanced-prompts-rpc.handlers.ts:241`,
  `executeBoundGuidance` `:752`-`807`).
- **During**: `enhance-stream` events tagged `tabBinding` + `lifecycle:'running'`.
- **Cancel**: `enhancedPrompts:cancel { tabBinding }` → `{ cancelled, outcome }`.
- **Resume / reload**: `enhancedPrompts:getRunState { tabBinding, runId? }` →
  `SetupGenerationRunState | null`; committed output checked via
  `enhancedPrompts:getStatus` (`guidance-generation.store.ts:124`-`188`).
- **Completion/failure**: a terminal `enhance-stream` `kind:'status'` event with
  terminal `lifecycle` (`broadcastGuidanceTerminal` `enhanced-prompts-rpc.handlers.ts:844`)
  plus run-state lookup. No dedicated terminal push type.
- **Chat-tab dependency**: same as agent generation — binding is a routing key;
  the chat tab exists only because the current UI renders the stream as a chat
  message (`generation-run-event-adapter.ts:89`-`92` handles `enhance-stream`).

### New-project intake
- **Start**: Setup Hub form → `harness:start-new-project { intake }` → backend
  enables plugin, returns `seedPrompt` → frontend creates a chat tab
  (`createTab`), sets the prompt preamble, navigates, and sends the intake summary
  as the first user message (`harness-workflow-request.service.ts:366`-`443`).
- **Cancel/resume**: chat semantics only (abort the chat turn, resume = existing
  tab found by `findResumableTab` `:339`); no backend run record.
- **Completion**: signalled structurally only by `proposeConfig` with
  `isConfigComplete: true` in a `harness:config-proposed` push; durable via
  `harness:get-proposal { sessionId }`.
- **Chat-tab dependency**: **total** — the workflow is a chat session; there is no
  run object, lifecycle, or progress contract to attach a step UI to.

### Team / harness builder (bounded helpers)
- **Start/complete**: each RPC is request/response; long ones stream
  `harness:stream` keyed by `operation` + `operationId` and end with
  `harness:stream-complete { success, error? }`. No cancel or resume; no run
  registry. No chat-tab dependency for these calls.

### Team / harness builder (agent-driven configure)
- Same chat model as new-project (`harness:workflow-prompt` seeds the first turn;
  `proposeConfig` pushes revisions). Total chat-tab dependency.

---

## Gaps

For a non-chat step UI, the backend is **ready for 3 of the 6 workflows without any
backend change**:

1. **Agent generation — no backend change needed.** Run lifecycle, per-agent
   status, progress %, produced files, preview, retry, cancel, resume and a
   terminal push with typed facts all exist and are routed by a routing key the
   backend never ties to a real chat tab (`wizard-generation-rpc.handlers.ts:296`-`309`).
2. **Workspace analysis — no backend change needed for the stepper itself.**
   `scan-progress.phaseStatuses[]` + manifest cover phase/status/output/errors
   (`phase.ts:71`-`74`, `rpc-setup.types.ts:190`-`238`).
3. **Agent recommendation — no backend change needed** (typed response).
4. **Harness bounded helpers — no backend change needed** (`harness:stream`,
   `harness:stream-complete`, typed results, `appliedPaths`).

Needed backend additions (all small, each with exact file):

| # | Gap | Why a step UI needs it | Exact file to change |
|---|---|---|---|
| 1 | **No analysis-completion push.** Terminal state is only the long-held `wizard:deep-analyze` RPC response; after a webview reload the UI must poll `wizard:get-resumable-run`. The contract even reserves `setup-wizard:analysis-complete` (`AnalysisCompletePayload`) with no emitter. | A step UI that survives reloads wants a push that says "analysis finished/failed" without holding a 61-minute RPC. Smallest change: broadcast `setup-wizard:analysis-complete` (or a manifest-digest payload) at run end. | Emitter side: `libs/backend/agent-generation/src/lib/services/wizard/multi-phase-analysis.service.ts` (next to the existing `broadcastStreamMessage` at `:1127`); payload type already at `libs/shared/src/lib/types/wizard/phase.ts:134` |
| 2 | **Guidance has no per-section progress and no percent.** During a guidance run the only structured data is the token stream; `summary.sections[]` exists only in the final RPC response. | Per-step cards ("Project Context ✓, Style Guidelines generating…") need section-level status events. Smallest change: reuse `setup-wizard:enhance-stream` with a structured `kind:'section'`-style payload (fields: `sectionName`, `status`) or extend `EnhancedGenerationStreamPayload`. | `libs/backend/rpc-handlers/src/lib/handlers/enhanced-prompts-rpc.handlers.ts:752` (`executeBoundGuidance`) — the section hooks live in the underlying `enhancedPromptsService.runWizard` call; payload type `libs/shared/src/lib/types/wizard/phase.ts:125` |
| 3 | **New-project intake and agent-driven harness configure have no step contract at all.** The run is a chat session; only `proposeConfig` emits structured data. | Any dedicated UI for these flows needs at least a run record (status, current phase) or must stay chat-rendered. This is a design decision more than a small patch: either (a) keep these two workflows chat-first and only re-skin the transcript, or (b) add a structured event schema mirroring the wizard's (`SetupGenerationRunState`-style registry keyed by SDK session id). If (b), the natural anchor is the proposal store that `proposeConfig` already writes. | New code: a run-state registry beside `libs/backend/rpc-handlers/src/lib/handlers/harness-rpc.handlers.ts` (pattern to copy: `guidanceRuns` registry in `enhanced-prompts-rpc.handlers.ts`); producer of phases would be the agent skill/tool calls in `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/harness-namespace.builder.ts` |
| 4 | **Dead message types invite wrong assumptions.** `setup-wizard:analysis-complete`, `setup-wizard:available-agents`, `setup-wizard:error` are in the shared union (`phase.ts:282`-`297`) and the frontend dispatcher but have no backend producer. | Either emit them (gap 1 covers the first) or remove the frontend handling so a new step UI doesn't build on a message that never arrives. | Types: `libs/shared/src/lib/types/wizard/phase.ts:134`, `:156`, `:249`; consumer: `libs/frontend/setup-wizard/src/lib/services/setup-wizard/wizard-message-dispatcher.ts:69`-`92` |

---

## Decisions

| Decision | Options considered | Evidence / reason |
|---|---|---|
| Treat "project guidance" = Enhanced Prompts workflows (`setup-project-prompt`) | Enhanced Prompts vs. some other guidance surface | `SetupGenerationWorkflow = 'setup-agent-generation' | 'setup-project-prompt'` (`rpc-setup.types.ts:11`) and the guidance store consumes `enhancedPrompts:*` exclusively (`guidance-generation.store.ts:124`-`188`). |
| Treat "workspace scan/analysis" = `wizard:deep-analyze` multi-phase pipeline, not the legacy single-shot analysis | Legacy agentic path vs. v4 multi-phase | `MultiPhaseAnalysisResponse` is the only documented response of `deep-analyze` (`rpc-setup.types.ts:259`); v3/v4 manifests + resume exist; the legacy `AgenticAnalysisService` still emits the same message constants (`agentic-analysis.service.ts:431`, `:447`) but the frontend runner drives `deepAnalyze` + `recommendAgents` (`wizard-analysis-runner.service.ts:195`-`273`). |
| Classify `tabBinding.tabId` as **not** a chat-tab dependency | Backend could require a real tab | Backend validates only `workspacePath` via `authorizeTabWorkspace` (`wizard-generation-rpc.handlers.ts:296`-`309`); no tab lookup exists in `libs/backend` for these handlers; the chat tab is created purely client-side (`generation-workflow.store.ts:3`). A step UI may mint its own id — but changing the id namespace while old surfaces still run would need the `blocked`/`ownerTabId` semantics (`rpc-setup.types.ts:55`) kept intact. |
| Mark analysis percent-complete as "partial" | Invent a percent from phase numbers | `ScanProgressPayload` has `currentPhaseNumber`/`totalPhaseCount` but no 0-100 field, and the multi-phase path reports `filesScanned: 0` (`multi-phase-analysis.service.ts:990`); a step UI can derive percent as `phaseIndex/totalPhaseCount`. |
| Report `harness:open-workflow` as host-produced, out of backend scope | Search missed an emitter | Repo-wide grep (libs + apps) finds only the type declarations, the frontend handler (`harness-workflow-message.handler.ts:35`), and the host-source registry baseline (`host-source-registry.baseline.ts:488`); the message relays a host-side request into the webview. |
| Keep the new-project/harness-builder chat verdict separate from the wizard verdict | Could claim "backend works, UI is wrong" uniformly | For wizard generation/guidance the claim holds: structured contracts exist end-to-end. For new-project and agent-driven configure, the backend genuinely has no step contract — the workflow is defined as a seeded chat session (`harness-workflow-request.service.ts:366`-`443`, `HarnessStartNewProjectResult.seedPrompt` `rpc-harness.types.ts:518`). A non-chat UI there is a new backend feature, not a re-skin. |
| Did not audit the `ptah-nx-saas` plugin / skill internals that drive the new-project run | Could enumerate the agent-side phases | Out of scope for the backend RPC/message contract; the only structured boundary the run exposes today is `proposeConfig` (`harness-namespace.builder.ts:1092`). |