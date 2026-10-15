# Parity Inventory - TASK_2026_649_33c4

Mode: inventory-only (architect, no PM). Source: OLD code on branch `feat/task-648-session-embed`
(HEAD `e0e3f2756`), worktree `task-647-setup-hub-chat-sessions`. Paths are relative to the repo root.
Abbreviations: `HB` = `libs/frontend/harness-builder/src/lib`, `RH` =
`libs/backend/rpc-handlers/src/lib`, `VIEW` = `HB/components/harness-builder-view.component.ts`,
`HUB` = `HB/components/setup-hub.component.ts`, `WF` = `HB/services/harness-workflow.service.ts`,
`STATE` = `HB/services/harness-builder-state.service.ts`, `MSG` =
`HB/services/harness-workflow-message.handler.ts`, `REQ` = `HB/services/harness-workflow-request.service.ts`,
`HRPC` = `HB/services/harness-rpc.service.ts`, `H` = `RH/handlers/harness-rpc.handlers.ts`.
Research line numbers in `TASK_2026_647_1b0f/research/*` are older; the numbers below were re-read
on this HEAD.

"New location" is a proposed destination only; the designer and the architect's plan settle it.
"missing" in the test column means no test pins that behavior today.

| # | Capability | Where today (file:line) | Backing RPC/API | Wired today? (yes/no/partial) | Decision (keep / move / replace-infra / wire / remove-proposed) | New location (proposed, short) | Test that proves it |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Setup Hub card grid (Workspace Analysis, AI Team Builder, New Project, Tribunal, Saved Presets, Active Configuration), progress ring, CLAUDE.md status | `HUB:324-901`, `refreshStatus` `HUB:1257-1292`, `hasClaudeMd` `HUB:1171-1173` | `setup-status:get-status`, `harness:load-presets` (`HUB:1264-1265`) | yes | keep | Setup Hub, unchanged | e2e `apps/ptah-electron-e2e/src/specs/harness/harness-builder.spec.ts:21`; card logic missing |
| 2 | Hub header: Back to chat, Refresh status | `HUB:210`, `HUB:224`, `goBack` `HUB:1469-1471` | `setup-status:get-status` | yes | keep | Setup Hub, unchanged | missing |
| 3 | AI Team Builder card opens the builder ("Create / Edit AI Team", Enter key) | `HUB:490-579`, `openHarnessBuilder` `HUB:1298-1300` (`setCurrentView('harness-builder')`, bypasses REQ) | N/A (view switch) | yes | move | Card -> `HarnessWorkflowRequestService` -> `WorkflowTabLauncherService.open({workflow:'harness-configure'})` (`libs/frontend/chat/src/lib/services/workflow-tab-launcher.service.ts:26-60`) | e2e `harness-builder.spec.ts:15` |
| 4 | New Project card: Start vs Resume while a run is active, "Running / In progress" label | `HUB:589-694`, `onNewProjectCardActivate` `HUB:1307-1313`, `resumeNewProject` `HUB:1315-1317`, `hasActiveNewProject` `HUB:1221-1224` | N/A | yes | move | Resume focuses the existing `harness-new-project` tab (by `tab.workflow`) | `HB/components/setup-hub.component.spec.ts:401`; e2e `new-project-question-routing.spec.ts:212`, `new-project.spec.ts:301` |
| 5 | New Project intake modal: what, audience, platform, stack chips derived from platform, "other" free text, constraints, validation, `role="dialog"` | template `HUB:905-1095`, logic `HUB:1319-1394`; vocabulary `HB/services/new-project-intake.ts:21-49`; `stackOptionsForPlatform` (shared) | N/A | yes | keep | Setup Hub (may be extracted into its own component) | `setup-hub.component.spec.ts:145-268`; e2e `new-project.spec.ts:129,173`, `new-project-dotnet.spec.ts:137,237` |
| 6 | Intake submit -> backend: Zod-validate intake, enable bundled plugins and reconcile, probe toolchain, compose seed (`buildNewProjectSeedPrompt`), focusChat, dispose wizard panel | FE `HUB:1396-1406,1439-1467`; BE `H:815-909`; seed `RH/harness/harness-constants.ts:283` | `harness:start-new-project` | yes | keep | Backend unchanged; FE hands the returned seed to the launcher | `RH/handlers/harness-rpc.handlers.spec.ts:652`; `setup-hub.component.spec.ts:295-385`; e2e `new-project-dotnet.spec.ts:203,266,317` |
| 7 | Start-new-project result report: `plugins.enabledBundled`, `missingExternal`, `availableSkillIds`, `toolchain` | BE returns it `H:883-893`; FE reads only `seedPrompt`/`intake` (`HUB:1446-1451`) | `harness:start-new-project` result | partial (reaches the user only inside the seed text) | wire | New Project add-on "Stack profile" section | BE `harness-rpc.handlers.spec.ts:652`; FE missing |
| 8 | Hub conflict confirm before replacing a running workflow of the other mode | template `HUB:1101-1135`, `hasConflictingWorkflow` `HUB:1235-1246`, `submitIntake` `HUB:1396-1406`, `confirmDiscardAndStart` `HUB:1417-1437` | `chat:abort` (via `WF.abortAndDispose` `WF:510-515`) | yes | keep | Becomes the shared Save as draft / Discard / Cancel leave dialog (652 D16) | `setup-hub.component.spec.ts:420-496` |
| 9 | Single entry adapter: same-mode resume, cross-mode abort+reset, navigation outcome landed/cancelled/failed, pending-request cleanup | `REQ:22-63` | `AppStateManager.requestHarnessWorkflow` (`libs/frontend/core/src/lib/services/app-state.service.ts:1384`), `SurfaceRouterService.navigateToSurface('harness-builder')` (`REQ:55`) | yes | move | Same service; resolves the draft choice, then calls `WorkflowTabLauncherService.open` (648 handoff item 1) | `HB/services/harness-workflow-request.service.spec.ts:54-100` |
| 10 | Legacy `HARNESS_OPEN_WORKFLOW` relay: mode validation, user-visible error on malformed or failed open | `MSG:49-86`; registered `apps/ptah-extension-webview/src/app/app.config.ts:323`; constant `libs/shared/src/lib/types/messages/message-constants.ts:204` | `MESSAGE_TYPES.HARNESS_OPEN_WORKFLOW` (no backend producer remains; only e2e injects it) | partial | keep | Relay -> REQ -> launcher; a conflicting mode defaults to Cancel with guidance | `HB/services/harness-workflow-message.handler.spec.ts:83-123`; e2e `new-project.spec.ts:199` (MO-5) |
| 11 | Request hand-off through AppState, consumed by the view's `ngOnInit` | `app-state.service.ts:1384-1392,1466`; `VIEW:657-682` | N/A | yes | replace-infra | `WorkflowTabLauncherService.open` (creates, tags, sets preamble and prefill on a normal tab) | `libs/frontend/chat/src/lib/services/workflow-tab-launcher.service.spec.ts:7-77` |
| 12 | Builder init: load workspace context, agents, skills, presets; initializing spinner, init error with Retry; skip re-init while a workflow is live | `VIEW:92-113,692-713`; `STATE.initialize` `STATE:427-444`; BE `H:367-391` | `harness:initialize` | yes | keep | Add-on host init when a harness workflow tab mounts | `harness-rpc.handlers.spec.ts:607`; `HB/components/harness-builder-view.component.spec.ts:394` |
| 13 | Workspace pin, "Targeting <workspace>" badge, follow-the-workspace idle re-init (latest response wins) | `STATE:128-148,203-264,435-436`; badge `VIEW:127-135`, `pinnedWorkspaceName` `VIEW:551`; second pin `WF:154,310` | `harness:initialize` (`workspaceRoot`), `harness:apply` (`workspaceRoot`) | yes | keep | Add-on, one pin derived from the tab's workspace partition (removes the double pin) | `HB/services/harness-builder-state.service.spec.ts:672-843`; `HB/services/harness-workflow.service.spec.ts:357,807` |
| 14 | Header title per mode ("AI Team Builder" / "New Project Setup") and config summary | `VIEW:119-126`, `headerTitle` `VIEW:533-537`; `STATE.configSummary` `STATE:277` | N/A | yes | move | Workflow badge (`libs/frontend/chat/src/lib/components/atoms/workflow-badge.component.ts:10-11`) and add-on summary or header chip | missing |
| 15 | Own composer: textarea, send button, Enter sends, Shift+Enter newline, disabled while processing | `VIEW:354-380`, `onKeydown` `VIEW:765-770`, `canSend` `VIEW:604` | N/A | yes | replace-infra | `ptah-chat-input` in the ChatView inside `ptah-session-embed` | missing (chat-input has its own specs) |
| 16 | Configure Harness first-turn composition: wraps the intent in the config-builder prompt, with an empty-workspace planning branch | `VIEW.sendMessage` `VIEW:772-803` (RPC `:783`); BE `H:926-935`; `RH/harness/ai/harness-workflow-prompt.service.ts:17-125` (empty branch `:39,76-96`) | `harness:workflow-prompt` | yes | keep | Becomes the tab's first-message preamble (`TabManagerService.setFirstMessagePreamble` `libs/frontend/chat-state/src/lib/tab-manager.service.ts:1972`, consumed at `libs/frontend/chat/src/lib/services/message-sender.service.ts:420-423`) | `RH/harness/ai/harness-workflow-prompt.service.spec.ts:45,75`; `harness-rpc.handlers.spec.ts:1682` |
| 17 | New Project auto-start: the seed goes to the agent, the intake summary is the visible first turn | `VIEW:657-682` (bubble `:671`, start `:676`); `formatIntakeSummary` `HB/services/new-project-intake.ts:71`; `WF.startWorkflow` `WF:292-350` | `chat:start` | yes | keep | Launcher: preamble = seed, visible prompt = intake summary, then auto-send through the normal tab sender (start policy, see open questions) | e2e `new-project.spec.ts:199` |
| 18 | Turn transport: `chat:start` with `surfaceMode` and a correlation TabId, `chat:continue`, session name per mode, rollback of a failed start | `WF:292-412` (`:326-335`, `:395-399`), `rollBackFailedStart` `WF:361-378` | `chat:start`, `chat:continue` | yes | replace-infra | Normal tab send path (`MessageSenderService`, `ConversationService`); no `surfaceMode` | `harness-workflow.service.spec.ts:150-222,374-470` |
| 19 | Model and effort for workflow turns (read from global state at start) | `WF:320-321` | `ModelStateService`, `EffortStateService` | yes | replace-infra | Per-tab model and effort selectors in `ptah-chat-input` | missing |
| 20 | Claim and surface registration (claim, interactive surface adapter, `onSurfaceCreated`) | `WF:316-318`, `WF:609-610`; `STATE.registerWorkflowSurface` `STATE:470-479` | `WorkflowSessionClaimService`, `StreamingSurfaceRegistry`, `StreamRouter` | yes | replace-infra | Normal tab, no claim. Claim services stay for Tribunal and Apps (epic `context.md:60`) | `harness-workflow.service.spec.ts:150,277` |
| 21 | Own transcript: user bubbles kept in localStorage and merged by timestamp with execution nodes; empty state; loading dots | `VIEW:196-296`, merge `VIEW:566-602`; `WF.addUserBubble/setUserBubbles` `WF:276-290` | N/A | yes | replace-infra | ChatView message list inside `ptah-session-embed` | `harness-builder-view.component.spec.ts:574-742` |
| 22 | Execution-node rendering of agent output | `VIEW:279-282` | N/A (component already shared) | yes | replace-infra | Chat message bubbles (same `ptah-execution-node`) | covered by chat specs |
| 23 | Permission and AskUserQuestion cards, routed to surface targets | `VIEW:298-314`, filters `VIEW:613-640`, responses `VIEW:862-868` | `PermissionHandlerService` | yes | replace-infra | The tab's ChatView permission and question cards | `HB/components/harness-builder-view.prompt-isolation.spec.ts:290-386`; `harness-builder-view.component.spec.ts:402-468`; e2e `new-project.spec.ts:224`, `new-project-question-routing.spec.ts:109,171` |
| 24 | Pending-question restore after reload | `WF.restorePendingQuestions` `WF:633-658` | `chat:pending-questions` | yes | replace-infra | Normal tab resume path | `harness-workflow.service.spec.ts:749-784` |
| 25 | Session stats summary in the side panel | `VIEW:398-405`; `WF.sessionStats` `WF:210-214` | `SurfaceSessionStatsRegistry` | yes | replace-infra | Tab session stats in the chat view or 677 inspector | `harness-builder-view.component.spec.ts:309-353` |
| 26 | Processing state, spinner, liveness (manual `markIdle` after abort) | `WF.isProcessing` `WF:216-223`; `WF:458` | `SessionLivenessRegistry` | yes | replace-infra | Tab streaming state | `harness-workflow.service.spec.ts:241,288` |
| 27 | Stop: abort the agent, keep transcript and preview (a pause, not a leave) | `VIEW:138-152`, `stopWorkflow` `VIEW:750-752`; `WF.abort` `WF:444-464` | `chat:abort` | yes | replace-infra | Chat-input Stop (`ConversationService.abortCurrentMessage` `libs/frontend/chat/src/lib/services/chat-store/conversation.service.ts:309`); no leave prompt (652 D16) | `harness-builder-view.component.spec.ts:511-517`; `harness-workflow.service.spec.ts:228-260` |
| 28 | Workflow error alert and dismiss (start, continue, abort and relay failures) | `VIEW:239-265`, `dismissError` `VIEW:741-743`; `WF.setError` `WF:266-273`, `failTurn` `WF:420-424` | N/A | yes | replace-infra | Turn errors render in the chat view; workflow-level errors (relay, launch) stay in Hub, launcher or add-on | `harness-builder-view.component.spec.ts:545`; `harness-workflow.service.spec.ts:511` |
| 29 | Reload resume: `ptah.harness.workflow.v1` record, rehydrate (new correlation, rebind session, `chat:resume` replay), "Resumed after reload" note | `WF:59-98,521-616,668-697`; note `VIEW:222-237` | `chat:resume` | yes | replace-infra | Tab persistence plus `WorkflowSessionIndexService` (`libs/frontend/chat-state/src/lib/workflow-session-index.service.ts:49-77`) | `harness-workflow.service.spec.ts:524-807`; e2e `new-project.spec.ts:336` |
| 30 | Builder session visible as a normal tile with a workflow badge | Hidden today: claimed tabs filtered at `libs/frontend/chat/src/lib/components/organisms/tab-bar.component.ts:203`; badge exists at `tab-bar.component.ts:104-105` | N/A | no | replace-infra | Normal tab plus `ptah-workflow-badge` (epic decision 2) | `libs/frontend/chat/src/lib/components/organisms/tab-bar.component.spec.ts:302` (asserts the hiding that goes away) |
| 31 | Auto-scroll the transcript to the bottom | `VIEW:642-650` | N/A | yes | replace-infra | Chat view scroll and dock | missing |
| 32 | Leave builder (X) while the workflow keeps running | `VIEW:183-190`, `leaveBuilder` `VIEW:719-721` | N/A | yes | replace-infra | Switch tab or close the inspector; the tab keeps running | missing |
| 33 | Side panel toggle (Show / Hide panel) | `VIEW:153-167`, `toggleSidePanel` `VIEW:653-655`, aside `VIEW:384-425` | N/A | yes | move | 677 inspector toggle (648 D6: no own panel toggle) or embed `addonOpen` in the interim | missing |
| 34 | Live config preview: persona and goals, agents and subagents, skills and created skills, system prompt, MCP servers, empty state | `HB/components/harness-config-preview.component.ts:33-185` (class `:188-266`) | `STATE.config` | yes | keep | Add-on "Config preview" section bound to the tab's SDK session(s) | component missing; merge covered by `harness-builder-state.service.spec.ts:458-585` |
| 35 | Structured proposal channel: `ptah_harness_propose_config` validation, session-scoped proposal store, broadcast | `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/harness-namespace.builder.ts:1084-1120`; dispatcher `.../mcp-core/protocol-dispatcher.ts:2225`; `RH/harness/config/harness-proposal-store.service.ts` | MCP tool, `HARNESS_CONFIG_PROPOSED` | yes | keep | Unchanged | `harness-namespace.builder.spec.ts:417`; `RH/harness/config/harness-proposal-store.service.spec.ts:47,65` |
| 36 | Live proposal intake: session filter, buffer during hydration | `MSG:152-173`, mode gate `MSG:155` | `HARNESS_CONFIG_PROPOSED` | partial (New Project proposals dropped by the mode gate) | keep | Add-on accepts proposals for every session of the tab, in both kinds (648 handoff item 3) | `harness-workflow-message.handler.spec.ts:158-171,197,353` |
| 37 | Proposal hydration after reload: `harness:get-proposal` per session, oldest first, generation guard | `MSG:88-150`; BE `H:911-924` | `harness:get-proposal` | yes | keep | Add-on hydrates from the tab's `claudeSessionId` chain; explicit unavailable or expired state | `harness-workflow-message.handler.spec.ts:181,227,274,327`; `harness-rpc.handlers.spec.ts:1126` |
| 38 | Field-aware merge of partial config updates | `STATE.applyConfigUpdates` `STATE:312-314` (shared `mergeHarnessConfigUpdates`) | N/A | yes | keep | Add-on store | `harness-builder-state.service.spec.ts:458-585` |
| 39 | "Configuration looks ready" banner and Apply buttons (banner and side panel) | `VIEW:329-352,409-422`; `STATE.isConfigComplete` `STATE:194` | `harness:apply` | yes | keep | Add-on primary action (at most one primary button per section, 648 D6) | missing |
| 40 | Apply: build a full `HarnessConfig` from the partial, send the pinned root; backend writes preset, CLAUDE.md, agents, skills, MCP and reconciles | `VIEW.applyConfig` `VIEW:805-860`; BE `H:483-604` | `harness:apply` | yes | keep | Add-on Apply | `harness-rpc.handlers.spec.ts:1182-1659` |
| 41 | Apply result: `appliedPaths` and `warnings` | BE returns them `H:603`; FE discards them `VIEW:849-853` | `harness:apply` response | no (epic defect 3) | wire | Add-on success state with the written-file list and warnings | missing (needs a regression test) |
| 42 | Apply error inline with Dismiss | `VIEW:318-328`, `VIEW:854-857` | `harness:apply` | yes | keep | Add-on | missing |
| 43 | Start over: confirm when running or when config exists, abort then dispose, return to Setup Hub | `VIEW:168-182,428-466`, `requestStartOver` `VIEW:724-730`, `performStartOver` `VIEW:759-763`; `WF.abortAndDispose` `WF:510-515`, `dispose` `WF:476-503` | `chat:abort` | yes | keep | Header action plus the Save as draft / Discard / Cancel leave dialog (652 D16) | `harness-builder-view.component.spec.ts:531`; `harness-workflow.service.spec.ts:474-495` |
| 44 | Presets: Apply writes the preset to disk; Hub lists saved presets (top 3 + "N more") | BE `H:496-499`, `H:624-631`; Hub `HUB:764-824` | `harness:apply`, `harness:load-presets` | yes | keep | Hub unchanged; add-on may list them | `harness-rpc.handlers.spec.ts:1182`; Hub list missing |
| 45 | Save a named preset with a description | `HRPC.savePreset` `HRPC:190-198`; BE `H:608-622`; CLI `apps/ptah-cli/src/cli/commands/harness.ts:452` | `harness:save-preset` | partial (CLI only) | wire | Add-on "Save as preset" action | CLI only; FE missing |
| 46 | Start from an existing preset (presets loaded by initialize) | `STATE.existingPresets` `STATE:182`, set in `STATE:427-444`; no UI reader in VIEW | `harness:initialize` | partial (loaded, never shown or applied) | wire | Add-on preset picker -> `applyConfigUpdates` | missing |
| 47 | Harness health, reconcile, remove, repair-blocked, `harness:healthChanged` push | `libs/frontend/dashboard/src/lib/components/harness-card/harness-card.component.ts:76`; `libs/frontend/marketplace/src/lib/harness/harness-health.store.ts:246`; BE `H:943-999` | `harness:health`, `harness:reconcile`, `harness:remove`, `harness:repairBlocked` | yes (outside the builder) | keep | Unchanged; add-on may show a post-Apply health line from `HarnessHealthStore` | `libs/frontend/marketplace/src/lib/harness/harness-health.store.spec.ts:630`; `harness-card.spec.ts:159` |
| 48 | Agent tools: searchSkills, createSkill, searchMcpRegistry, listInstalledMcpServers, installMcpServer | `harness-namespace.builder.ts:521,711,825,924,987`; dispatcher `protocol-dispatcher.ts:2026,2056,2168` | MCP tools | yes | keep | Unchanged; available to the tab's agent | `harness-namespace.builder.spec.ts:240` |
| 49 | AI: suggest config from persona (LLM, heuristic fallback) | BE `H:393-407` -> `RH/harness/ai/harness-suggestion.service.ts:108`; FE `HRPC:82-94`; state target `STATE.setSuggestedMcpServers` `STATE:340-342` | `harness:suggest-config` | no | wire | Add-on action "Suggest from persona" (or agent tool) | missing |
| 50 | AI: design subagent fleet | BE `H:632-643` -> `RH/harness/ai/harness-subagent-design.service.ts:53`; FE `HRPC:215-225`; CLI `harness.ts:585`; state target `STATE:352-382` | `harness:design-agents` | partial (CLI only) | wire | Add-on action "Design subagents" -> `harnessSubagents` | missing |
| 51 | AI: generate skill specs | BE `H:645-656` -> `RH/harness/ai/harness-skill-generation.service.ts:51`; FE `HRPC:231-243`; state target `STATE.setGeneratedSkillSpecs` `STATE:344-346` | `harness:generate-skills` | no | wire | Add-on action "Generate skill specs" | missing |
| 52 | AI: generate the comprehensive document (PRD) | BE `H:658-668` -> `RH/harness/ai/harness-document-generation.service.ts:42`; FE `HRPC:249-261`; CLI `harness.ts:648`; state target `STATE.setGeneratedDocument` `STATE:348-350` | `harness:generate-document` | partial (CLI only) | wire | Add-on action "Generate document" | missing |
| 53 | AI: analyze free-form intent into a harness blueprint | BE `H:670-697` -> `harness-suggestion.service.ts:134`; FE `HRPC:268-280`; CLI `harness.ts:531`; state target `STATE.applyIntentAnalysis` `STATE:388-417` | `harness:analyze-intent` | partial (CLI only) | wire | Add-on action "Analyze intent" (or agent tool) | `harness-rpc.handlers.spec.ts:620` (validation only) |
| 54 | Other harness endpoints with FE wrappers and no FE caller: search-skills, create-skill, discover-mcp, generate-prompt, generate-claude-md | FE `HRPC:99-169`; BE `H:410-480`; CLI create-skill `apps/ptah-cli/src/cli/commands/skill.ts` | `harness:search-skills`, `harness:create-skill`, `harness:discover-mcp`, `harness:generate-prompt`, `harness:generate-claude-md` | no (create-skill: CLI only) | wire | Add-on secondary actions (MCP suggestions, prompt and CLAUDE.md preview) | missing |
| 55 | Backend AI streaming for the endpoints above: `HarnessLlmRunner` and `harness:flat-stream` broadcaster | `RH/harness/ai/harness-llm-runner.service.ts:96-111`; `RH/harness/streaming/harness-stream-broadcaster.service.ts:96,122`; consumer `apps/ptah-cli/src/cli/output/event-pipe.ts:41-42` | `harness:flat-stream`, `harness:flat-stream-complete` | partial (CLI consumes; no webview consumer) | keep | Unchanged (the CLI depends on it) | `RH/harness/ai/harness-llm-runner.service.spec.ts` |
| 56 | FE operation-surface streaming for AI operations (`registerOperationSurface`, `routeOperationEvent`, `_streamingState`) | `STATE:481-594` | `StreamRouter`, `StreamingSurfaceRegistry` | no (no external callers) | replace-infra | Add-on action busy and result state from the request/response RPC; no private stream transport | `harness-builder-state.service.spec.ts:142-436` |
| 57 | Accessibility: `role="log"` transcript, `role="alert"` errors, `role="status"` badges, `aria-modal` dialogs with `aria-labelledby`, `aria-label` on icon buttons, Enter activation on Hub cards | `VIEW:199-200,225,242,428-434,142,156,172,186`; `HUB:333,490,597,704,914,1101` | N/A | partial (no Escape or focus trap on any dialog) | keep | Add-on and leave dialog follow 648 D6 (targets >= 24 px, 2 px focus ring) and 652 dialog rules (focus trap, Escape = Cancel, focus return) | missing |
| 58 | Grid layout adoption of a workflow tab and prefill target (FU-648-2) | `workflow-tab-launcher.service.ts:45-58` | `AppStateManager.requestCanvasTab` (`app-state.service.ts:1354`), `requestComposerPrefill` (`:1433`) | no (no harness caller yet) | wire | First caller handles adopt refusal at the tile cap (show it, or retarget the prefill) | `workflow-tab-launcher.service.spec.ts:47` |
| 59 | Workflow tag and history badge index for harness kinds | `libs/frontend/chat-types/src/lib/chat-types.ts:873-885`; `TabManagerService.setWorkflow` `tab-manager.service.ts:949`; `workflow-session-index.service.ts:49-77` | N/A | no (built by 648; no harness caller yet) | wire | Set by the launcher with `harness-configure` / `harness-new-project` | 648 specs (`workflow-tab-launcher.service.spec.ts:7`) |
| 60 | `harness-builder` surface route and lazy chunk, `setup-hub` route | `apps/ptah-extension-webview/src/app/app.routes.ts:118-138`; `HB/../services.ts:27` | N/A | yes | keep | Route stays; its role (workflow host or redirect) is decided in design | e2e `harness-builder.spec.ts:15,21` |

Tally: 60 capabilities. Wired today: 42 yes, 10 partial, 8 no. Decisions: keep 25, move 5,
replace-infra 18, wire 12, remove-proposed 0.

## Proposed Removals

None. Every user-visible capability is kept, moved or wired. Rows marked `replace-infra` (11, 15,
18-32, 56) are duplicated chat infrastructure. Each names the shared piece that takes over, and
the user-facing behavior survives through that shared piece.

## Known defects

1. **No live stream (epic defect 1).**
   `RH/chat/streaming/chat-stream-delivery-coordinator.service.ts:171` sends `CHAT_CHUNK` only when
   `visibleTabIds.has(tabId)`. Terminal messages are deferred at `:233` for the same reason. The
   builder sends with a claimed correlation `TabId` and `surfaceMode: true` (`WF:298,326-331`). That
   ID never renders as a tab, because claimed tabs are filtered out at `tab-bar.component.ts:203`,
   so it never enters `visibleTabIds` (`:189-214`).
2. **Snapshot misrouting (epic defect 2).** `handleStreamSnapshot`
   (`libs/frontend/chat/src/lib/services/chat-message-handler.service.ts:563-591`) has no claim
   check, so it applies snapshot events by tab ID. The resync branch (`:566-582`) calls
   `chatStore.resyncStream`/`processStreamEvent`, and the plain branch calls
   `applyChatStreamEvent` (`:538-552`). The live-chunk path checks `renderedSurfaceFor`
   (`:369-374`) at `:514`, and so do the error and complete paths (`:649`, `:780`). The snapshot
   path does not.
3. **Silent Apply (epic defect 3).** `VIEW:849-853` awaits `rpc.apply(...)` and discards the
   `HarnessApplyResponse { appliedPaths, warnings }` returned at `H:603`. Only failures reach the
   user (`VIEW:854-857`, rendered at `VIEW:318-328`).

Related defects found during the inventory (not epic-numbered):

- New Project proposals are dropped: live intake is gated to `configure-harness` (`MSG:155`), but
  hydration is not gated (`MSG:113-150`, MO-1).
- A user turn is dropped when no session has resolved yet. The bubble is already shown (`VIEW:778`),
  then `WF.sendMessage` logs and returns (`WF:385-390`; pinned by
  `harness-workflow.service.spec.ts:221`).
- A failed `harness:workflow-prompt` only reaches `console.error` (`VIEW:792-796`). The user's
  bubble stays and nothing tells them the start failed.
- FU-17: after a failed `chat:abort`, `abortAndDispose` still disposes (`WF:510-515`,
  `REQ:29-37`).
- No dialog handles Escape or traps focus (`VIEW:428-466`, `HUB:905-1135`).

## Draft (Save as draft / Discard) requirements carried from 652

Source: 652 D16-D18 and `../TASK_2026_652_7284/draft-workflow-plan.md`. That plan is superseded
for implementation; on the tab model, a draft is the kept workflow-tagged tab and its session.

- The Save as draft / Discard / Cancel prompt appears only on **leaving** actions: Start over, the
  Setup Hub new-workflow discard, and a cross-mode switch. Plain Stop stays a pause with no prompt
  and keeps the transcript and preview.
- One resumable draft per workspace. Saving a draft stops the agent and keeps the session and its
  stored proposal. Neither Save nor Discard deletes a backend chat session or proposal record.
- Setup Hub shows a "Resume draft" card for the current workspace only, after the hero and before
  Quick Actions. It shows mode, workspace, last activity, saved date and turn count, with Resume
  and Delete draft buttons. Delete has its own small accessible confirm. A blank root shows no
  card.
- Resume while another workflow is active shows the same three-way dialog first. Save = swap
  (D17): read the selected draft into memory, save the active workflow as the new draft, abort the
  active one if it is processing, dispose it, then restore the in-memory draft. If the draft write
  fails, nothing changes. If the restore fails, the record stays available for a retry. The dialog
  copy says the current workflow becomes the draft.
- Write the draft durably before any abort or dispose. A failed write keeps the current workflow
  active, shows a safe error and never claims success.
- Abort failure (FU-17): call `chat:abort` only while processing. Leaving continues even if abort
  fails. Show a persistent, dismissible warning that the agent may still be running. Never render
  the raw RPC error. Guard against concurrent leave clicks with one in-flight transition.
- Dialog: one shared standalone OnPush component, `role="dialog"`, `aria-modal`,
  `aria-labelledby`, initial focus, focus trap, Escape = Cancel, focus returns to the trigger. No
  second confirmation after a choice. It replaces both the builder confirm (`VIEW:428-466`) and the
  Hub confirm (`HUB:1101-1135`).
- When the session is not resolved yet (initial start), keep Save disabled and explain "Waiting for
  the chat session to start". Discard and Cancel stay available.
- Never show or resume a draft from another workspace. A missing chat session leaves the draft in
  place for Retry or Delete and never silently starts a new agent.
- The legacy relay's default on a conflicting mode is Cancel with guidance to use Setup Hub. It
  never discards silently.
- Storage is webview-only (D17). The VS Code multi-panel limit is follow-up FU-18. The preview
  falls back to a local snapshot if the 30-day proposal store has pruned the record.

## Dependencies and open questions

- **677 `SESSION_WORKFLOW_ADDONS` is not built.** A search of `libs/` and `apps/` finds no match
  for `SESSION_WORKFLOW_ADDONS`, `inspectorSection` or `sessionWorkflowKind`. The contract (648
  D8) is a multi token of `{ workflowKind, slot, component }`, where the component declares
  `tabId = input.required<string>()`, registered in the webview `app.config.ts`. Today the only
  embed host is `libs/frontend/canvas/src/lib/canvas-detail/canvas-detail-transcript.component.ts`,
  whose `[sessionHeader]` and `[sessionAddon]` slots are pass-through
  (`libs/frontend/chat/src/lib/components/templates/session-embed.component.ts:40,44`). In
  single-pane chat the ChatView renders the tab with no embed, so add-ons have nowhere to appear.
  Options before 677 lands:
  (a) Build the add-on components to the 677 contract now (`tabId` input, one `<section>` each)
  and host them temporarily in a workflow host that renders `ptah-session-embed [tabId]` with the
  add-on in `[sessionAddon]`. The `harness-builder` route is a candidate. Switch to token
  registration when 677 B-3 merges.
  (b) Block the 649 add-on UI on 677 B-3.
  (c) Create the token file in 649 and coordinate ownership with 677.
  Recommendation: (a). It keeps 677's file ownership (D8) and makes the later switch a
  registration-only change. This changes where the user sees the builder, so it needs the
  designer and Gate 1.7.
- **Configure Harness preamble needs the intent.** `composePrompt` embeds the user's intent
  (`harness-workflow-prompt.service.ts:17-125`). The launcher's preamble is fixed before the user
  types. Options: compose an intent-free preamble and let `message-sender.service.ts:420-423`
  append the user's message, or compose at first send.
- **New Project auto-start vs 648 D4 (prefill only).** The launcher never sends
  (`workflow-tab-launcher.service.ts:26-60`). Keep-and-fix needs an explicit start policy through
  the normal tab sender (648 plan decision table, line 157).
- **FU-648-2** (row 58): at the grid tile cap, the launcher returns `landed` while adoption is
  refused. 649 owns the fix.
- **AI action outputs are not persisted.** The proposal store is written only by the agent tool
  (`harness-namespace.builder.ts:1104`). Results from add-on AI actions (rows 49-54) would be lost
  on reload unless they go through the proposal store or a draft snapshot. Choosing between add-on
  actions and agent tools decides this.
- **CLI depends on the backend AI endpoints and the stream** (`apps/ptah-cli/src/cli/commands/harness.ts:452,531,585,648`,
  `event-pipe.ts:41-42`). Backend services stay. Only FE plumbing is in scope.
- **E2E specs still drive the surface path** (MO-5): `apps/ptah-electron-e2e/src/specs/harness/new-project.spec.ts:199-336`,
  `new-project-question-routing.spec.ts:109-212`. They need retargeting to tabs.
- 652 carry-overs: FU-18 (multi-panel storage), R1 (port `rename`), MO-1 (mode gate, see row 36),
  MO-2..MO-6 (proposal-store hygiene, not blocking).
- Manual checks from #732 still pending: New Project in dark and light themes; a reload during
  Configure Harness restores the preview.
- 648 PR #733 is still open; 649 is stacked on `feat/task-648-session-embed`.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Mark the five named AI endpoints and the five other unwired FE wrappers `wire`, not remove | wire; remove-proposed | Keep-and-fix rule (`../TASK_2026_647_1b0f/context.md:15-23`); the backend handlers exist (`H:393-697`, `H:410-480`) | yes |
| Keep the backend `HarnessLlmRunner` and `harness:flat-stream`; mark only the FE operation-surface plumbing `replace-infra` | replace both; keep both | The CLI consumes the stream (`event-pipe.ts:41-42`); the FE plumbing has no callers (`STATE:481-594`) and duplicates stream transport | yes |
| Classify the Hub conflict confirm and Start over as `keep` (they become the D16 leave dialog), not `replace-infra` | keep; replace-infra | These are user decisions, not chat infrastructure; 652 D16 upgrades them | yes |
| Keep the legacy `HARNESS_OPEN_WORKFLOW` relay even though no backend producer remains | keep; remove-proposed | 648 handoff item 1 ("retain the compatibility relay until its callers are migrated"); e2e still injects it (MO-5) | yes |
| Leave `WorkflowSessionClaimService` and `StreamingSurfaceRegistry` untouched; the builder simply stops using them | keep; remove | Epic `context.md:60` (Tribunal and Apps use them) | yes |
| Inventory counts 60 rows at capability granularity; the five AI endpoints are separate rows so each gets its own wiring decision | group; split | Each endpoint has a distinct state target (`STATE:340-417`) and consumer set | yes |
