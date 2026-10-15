# B4c report — page integration and private transport removal

## Files changed or deleted

| File | Change |
| --- | --- |
| `libs/frontend/harness-builder/src/lib/services/harness-builder-state.service.ts` | Removed builder-private stream state and bound configuration state to route tab/root. |
| `libs/frontend/harness-builder/src/lib/services/harness-builder-state.service.spec.ts` | Checks root pin, tab reset and removed private surface API. |
| `libs/frontend/harness-builder/src/lib/services/harness-workflow-request.service.ts` | Retains the first New Project intake text for a failed send and retries it on user action for the original tab/root, with an in-flight guard and removal of the failed optimistic bubble before retry. |
| `libs/frontend/harness-builder/src/lib/services/harness-workflow-request.service.spec.ts` | Adds retry, persistent error, no reseed, concurrent-click and failed-bubble replacement assertions. |
| `libs/frontend/harness-builder/src/lib/components/harness-builder-view.component.ts` | Replaced private composer/transcript with bare shared chat embed, sidebar, leave flow, notices and route validation. |
| `libs/frontend/harness-builder/src/lib/components/harness-builder-view.component.spec.ts` | Covers route pin, wrong/missing state, width/height structure, grid adoption, leave decisions, failed-send Retry and null-root initialization. |
| `libs/frontend/harness-builder/src/lib/components/harness-builder-view.prompt-isolation.spec.ts` | Uses tab-target routing regression checks after private surface removal. |
| `libs/frontend/harness-builder/src/lib/services/harness-workflow.service.ts` | Deleted private workflow transport. |
| `libs/frontend/harness-builder/src/lib/services/harness-workflow.service.spec.ts` | Deleted obsolete private-transport tests. |
| `libs/frontend/harness-builder/src/index.ts` | Removed old export; exposed new builder services/components. |
| `libs/frontend/harness-builder/src/services.ts` | Removed old export; exposed new builder services/components. |
| `apps/ptah-electron-e2e/src/specs/harness/new-project.spec.ts` | Checks routed shared-chat session, Hub resume and reload; removed old storage assertion. |

## Verification

Tree-sitter AST analysis returned `parseStatus: ok` for edited view, state, view spec, prompt-isolation spec and Electron spec. Read-only source checks found no builder-private workflow import or old storage key in the affected production paths and Electron spec. Fix round 2 ran the two authorized focused Jest specs: 2 suites passed, 14 tests passed. No Nx, TypeScript, diagnostics, build, serve or e2e command ran in this lane; the Electron assertions remain unexecuted. Visual pixel scrolling at 480px is reserved for review; the Jest spec checks structural classes only.

## Parity inventory (60 rows)

Paths below are relative to the relevant library. A named spec is existing or edited coverage, not a passing result in this lane. `replace-infra` rows use the shared chat/session path; backend and CLI stream paths remain.

| # | Capability | Disposition | Where proven / checked |
| ---: | --- | --- | --- |
| 1 | Setup Hub card grid (Workspace Analysis, AI Team Builder, New Project, Tribunal, Saved Presets, Active Configuration), progress ring, CLAUDE.md status | keep | setup-hub.component.ts; harness-builder.spec.ts |
| 2 | Hub header: Back to chat, Refresh status | keep | setup-hub.component.ts |
| 3 | AI Team Builder card opens the builder ("Create / Edit AI Team", Enter key) | move | harness-workflow-request.service.ts/spec.ts; setup-hub.component.spec.ts |
| 4 | New Project card: Start vs Resume while a run is active, "Running / In progress" label | move | harness-workflow-request.service.spec.ts; new-project.spec.ts |
| 5 | New Project intake modal: what, audience, platform, stack chips derived from platform, "other" free text, constraints, validation, `role="dialog"` | keep | setup-hub.component.spec.ts; new-project.spec.ts |
| 6 | Intake submit -> backend: Zod-validate intake, enable bundled plugins and reconcile, probe toolchain, compose seed (`buildNewProjectSeedPrompt`), focusChat, dispose wizard panel | keep | harness-rpc.handlers.spec.ts; harness-workflow-request.service.ts |
| 7 | Start-new-project result report: `plugins.enabledBundled`, `missingExternal`, `availableSkillIds`, `toolchain` | wire | harness-builder-sidebar.component.ts; harness-builder-records.service.spec.ts |
| 8 | Hub conflict confirm before replacing a running workflow of the other mode | keep | harness-builder-leave-dialog.component.spec.ts; setup-hub.component.spec.ts |
| 9 | Single entry adapter: same-mode resume, cross-mode abort+reset, navigation outcome landed/cancelled/failed, pending-request cleanup | move | harness-workflow-request.service.spec.ts |
| 10 | Legacy `HARNESS_OPEN_WORKFLOW` relay: mode validation, user-visible error on malformed or failed open | keep | harness-workflow-message.handler.spec.ts |
| 11 | Request hand-off through AppState, consumed by the view's `ngOnInit` | replace-infra | harness-workflow-request.service.ts; harness-builder-view.component.spec.ts |
| 12 | Builder init: load workspace context, agents, skills, presets; initializing spinner, init error with Retry; skip re-init while a workflow is live | keep | harness-builder-view.component.ts/spec.ts; harness-builder-sidebar.component.ts |
| 13 | Workspace pin, "Targeting <workspace>" badge, follow-the-workspace idle re-init (latest response wins) | keep | harness-builder-state.service.spec.ts; harness-builder-view.component.spec.ts |
| 14 | Header title per mode ("AI Team Builder" / "New Project Setup") and config summary | move | harness-builder-view.component.ts; workflow badge |
| 15 | Own composer: textarea, send button, Enter sends, Shift+Enter newline, disabled while processing | replace-infra | session-embed.component.spec.ts; chat-view.component.spec.ts |
| 16 | Configure Harness first-turn composition: wraps the intent in the config-builder prompt, with an empty-workspace planning branch | keep | harness-workflow-request.service.spec.ts |
| 17 | New Project auto-start: the seed goes to the agent, the intake summary is the visible first turn | keep | harness-workflow-request.service.spec.ts; new-project.spec.ts |
| 18 | Turn transport: `chat:start` with `surfaceMode` and a correlation TabId, `chat:continue`, session name per mode, rollback of a failed start | replace-infra | message-dispatch.service.spec.ts; session-embed.component.spec.ts |
| 19 | Model and effort for workflow turns (read from global state at start) | replace-infra | chat-view.component.spec.ts; session-embed.component.spec.ts |
| 20 | Claim and surface registration (claim, interactive surface adapter, `onSurfaceCreated`) | replace-infra | session-embed.component.spec.ts; private workflow service deleted |
| 21 | Own transcript: user bubbles kept in localStorage and merged by timestamp with execution nodes; empty state; loading dots | replace-infra | chat-view.component.spec.ts; new-project.spec.ts |
| 22 | Execution-node rendering of agent output | replace-infra | chat-view.component.spec.ts |
| 23 | Permission and AskUserQuestion cards, routed to surface targets | replace-infra | harness-builder-view.prompt-isolation.spec.ts; new-project.spec.ts |
| 24 | Pending-question restore after reload | replace-infra | chat-view.component.spec.ts; new-project.spec.ts reload case |
| 25 | Session stats summary in the side panel | replace-infra | harness-builder-sidebar.component.ts/spec.ts; tab sessionStats input |
| 26 | Processing state, spinner, liveness (manual `markIdle` after abort) | replace-infra | chat-view.component.spec.ts; tab-manager lifecycle specs |
| 27 | Stop: abort the agent, keep transcript and preview (a pause, not a leave) | replace-infra | chat-view.component.spec.ts; shared Stop control |
| 28 | Workflow error alert and dismiss (start, continue, abort and relay failures) | replace-infra | harness-builder-view.component.ts; chat-view.component.spec.ts |
| 29 | Reload resume: `ptah.harness.workflow.v1` record, rehydrate (new correlation, rebind session, `chat:resume` replay), "Resumed after reload" note | replace-infra | new-project.spec.ts reload case; normal tab restore |
| 30 | Builder session visible as a normal tile with a workflow badge | replace-infra | harness-builder-view.component.ts; workflow badge |
| 31 | Auto-scroll the transcript to the bottom | replace-infra | chat-view.component.spec.ts; shared transcript |
| 32 | Leave builder (X) while the workflow keeps running | replace-infra | harness-builder-view.component.spec.ts |
| 33 | Side panel toggle (Show / Hide panel) | move | harness-builder-view.component.spec.ts width matrix |
| 34 | Live config preview: persona and goals, agents and subagents, skills and created skills, system prompt, MCP servers, empty state | keep | harness-config-preview.component.spec.ts; harness-builder-sidebar.component.ts |
| 35 | Structured proposal channel: `ptah_harness_propose_config` validation, session-scoped proposal store, broadcast | keep | harness-rpc.handlers.spec.ts; proposal store |
| 36 | Live proposal intake: session filter, buffer during hydration | keep | harness-proposal-hydration.service.spec.ts |
| 37 | Proposal hydration after reload: `harness:get-proposal` per session, oldest first, generation guard | keep | harness-proposal-hydration.service.spec.ts |
| 38 | Field-aware merge of partial config updates | keep | harness-proposal-hydration.service.spec.ts; shared merge rules |
| 39 | "Configuration looks ready" banner and Apply buttons (banner and side panel) | keep | harness-builder-sidebar.component.spec.ts |
| 40 | Apply: build a full `HarnessConfig` from the partial, send the pinned root; backend writes preset, CLAUDE.md, agents, skills, MCP and reconciles | keep | harness-builder-sidebar.component.spec.ts; harness-rpc.handlers.spec.ts |
| 41 | Apply result: `appliedPaths` and `warnings` | wire | harness-builder-sidebar.component.spec.ts |
| 42 | Apply error inline with Dismiss | keep | harness-builder-sidebar.component.spec.ts |
| 43 | Start over: confirm when running or when config exists, abort then dispose, return to Setup Hub | keep | harness-builder-view.component.spec.ts; harness-builder-leave-dialog.component.spec.ts |
| 44 | Presets: Apply writes the preset to disk; Hub lists saved presets (top 3 + "N more") | keep | setup-hub.component.spec.ts; harness-builder-sidebar.component.ts |
| 45 | Save a named preset with a description | wire | harness-builder-sidebar.component.spec.ts |
| 46 | Start from an existing preset (presets loaded by initialize) | wire | harness-builder-sidebar.component.spec.ts |
| 47 | Harness health, reconcile, remove, repair-blocked, `harness:healthChanged` push | keep | harness-health.store.spec.ts; dashboard harness-card.spec.ts |
| 48 | Agent tools: searchSkills, createSkill, searchMcpRegistry, listInstalledMcpServers, installMcpServer | keep | harness-namespace.builder.spec.ts; agent tool path unchanged |
| 49 | AI: suggest config from persona (LLM, heuristic fallback) | wire | harness-helper.service.spec.ts; harness-builder-sidebar.component.ts |
| 50 | AI: design subagent fleet | wire | harness-helper.service.spec.ts; harness-builder-sidebar.component.ts |
| 51 | AI: generate skill specs | wire | harness-helper.service.spec.ts; harness-builder-sidebar.component.ts |
| 52 | AI: generate the comprehensive document (PRD) | wire | harness-helper.service.spec.ts; harness-builder-sidebar.component.ts |
| 53 | AI: analyze free-form intent into a harness blueprint | wire | harness-helper.service.spec.ts; harness-builder-sidebar.component.ts |
| 54 | Other harness endpoints with FE wrappers and no FE caller: search-skills, create-skill, discover-mcp, generate-prompt, generate-claude-md | keep (agent tool) for search-skills/create-skill per D7; wire for discover-mcp/generate-prompt/generate-claude-md | harness-helper.service.spec.ts; harness-namespace.builder.spec.ts |
| 55 | Backend AI streaming for the endpoints above: `HarnessLlmRunner` and `harness:flat-stream` broadcaster | keep | harness-llm-runner.service.spec.ts; CLI event-pipe.ts unchanged |
| 56 | FE operation-surface streaming for AI operations (`registerOperationSurface`, `routeOperationEvent`, `_streamingState`) | replace-infra | harness-helper.service.spec.ts; harness-builder-state.service.spec.ts |
| 57 | Accessibility: `role="log"` transcript, `role="alert"` errors, `role="status"` badges, `aria-modal` dialogs with `aria-labelledby`, `aria-label` on icon buttons, Enter activation on Hub cards | keep | harness-builder-view.component.spec.ts; harness-builder-leave-dialog.component.spec.ts; session-embed.component.spec.ts |
| 58 | Grid layout adoption of a workflow tab and prefill target (FU-648-2) | wire | harness-builder-view.component.spec.ts queues requestCanvasTab; design section 11 excludes tile-cap notice on the builder path |
| 59 | Workflow tag and history badge index for harness kinds | wire | harness-workflow-request.service.ts setWorkflow; harness-builder-view.component.ts badge |
| 60 | `harness-builder` surface route and lazy chunk, `setup-hub` route | keep | app.routes.spec.ts; harness-builder-view.component.spec.ts missing/wrong route |

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Bind route tab and pin its first resolved root | Active tab vs route tab | B4c and D1/D2 require route authority; `findTabByIdAcrossWorkspaces` supplies the partition. | Yes |
| Use shared `ptah-session-embed` and delete private transport | Keep private composer vs shared chat | B2 embed contract, B4c ownership and replace-infra parity rows 15–32. | Yes |
| Save draft before abort; discard clears tab after close; failed abort reports Hub warning | Block leave vs continue with warning | D12 a1; records service and `reportAbortFailure`; view spec covers sequencing and warning. | Yes |
| Queue grid canvas adoption once per routed tab mount | No adoption vs requestCanvasTab | Row 58 and AppState canvas request contract; design section 11 excludes the builder-path tile-cap notice. | Yes |
| Retry a failed first send from the builder page | Dismiss vs retry the retained intake | The request service now retains the formatted intake by tab/root, and `retryFirstSend` sends it once per action without repeating `startNewProject`. | Yes |

## Proposed Removals

None. Only `replace-infra` builder-private transport and its obsolete test were removed.

## Fix round

- `harness-builder-view.component.ts`: narrowed a nullable initialize root before normalization. A null root throws into the existing logged error path, sets `initError`, and leaves shared chat mounted. The first-send alert now offers Retry, remains visible until the service reports success, and the eight lines over 200 characters were wrapped.
- `harness-builder-view.component.spec.ts`: removed four unused component imports; added null-root and failed-retry notice assertions.
- `harness-workflow-request.service.ts`: retains the original formatted intake for a failed first send; a user retry validates the original tab and root, sends the same text through shared chat once per action, and clears the notice only on success. An in-flight guard prevents concurrent retry sends; a failed optimistic user bubble is removed before retry so the transcript has one first turn. It neither calls `startNewProject` again nor creates a second tab.
- `harness-workflow-request.service.spec.ts`: added assertions for persistent failure, eventual success, identical intake text, one seed/tab, concurrent-click suppression and replacement of a failed optimistic bubble.
- Verification: Tree-sitter parse status was `ok` for all four edited TypeScript files. Line-length inspection found no lines over 200 characters in the view or request service. The orchestrator reported the pre-fix degradation audit clean. Nx, Jest, TypeScript, diagnostics, build, serve and e2e were not run, as instructed.
- Scope: design section 11 excludes the builder-path tile-cap notice; no canvas change is proposed in this batch.

## Not done

- **Checks:** The orchestrator reported harness-builder, ptah-electron-e2e and ptah-extension-webview typecheck/lint passing, and a clean degradation audit before this fix. The full harness-builder suite (previously 70/72 passing) has not been rerun after the two mock fixes; Electron e2e and visual review of dark/light, docked/sheet and 480px scrolling remain outstanding.

## Test coverage after deletion

The deleted `harness-workflow.service.spec.ts` exercised a builder-private transport and localStorage record. The old `harness-builder-view.component.spec.ts` was replaced by the shared-session host spec. The table accounts for every deleted `describe` group; the old group names are retained here for traceability. A `replace-infra` entry means the behavior is now owned by shared chat and identifies the corresponding parity row.

| Deleted spec / describe group | Behavior it covered | Current test or parity evidence |
| --- | --- | --- |
| `harness-workflow.service.spec.ts` / `HarnessWorkflowService` | Start, configure title, no duplicate start, ordered sessions, continuation, unresolved send, abort/idle, failed abort, claim disposal, processing, private storage and pinned workspace | replace-infra: covered by shared chat, rows 18, 20, 21, 26, 27 and 29 (`message-dispatch.service.spec.ts`, `session-embed.component.spec.ts`, `chat-view.component.spec.ts`); pinned builder route/root has `harness-builder-view.component.spec.ts` and `harness-builder-state.service.spec.ts` |
| `harness-workflow.service.spec.ts` / `startWorkflow failure` | Roll back unsuccessful or thrown start and allow a later start | replace-infra: covered by shared chat, row 18 (`message-dispatch.service.spec.ts`); builder first-send retry is additionally covered by `harness-workflow-request.service.spec.ts` |
| `harness-workflow.service.spec.ts` / `sendMessage failure` | Expose a failed continuation and reset private started flag | replace-infra: covered by shared chat, rows 18 and 28 (`message-dispatch.service.spec.ts`, `chat-view.component.spec.ts`) |
| `harness-workflow.service.spec.ts` / `HarnessWorkflowService - resume after reload` | Restore private record/transcript/session, replay, pending questions, malformed or cross-workspace record handling, pinned root | replace-infra: covered by shared chat/tab restore, rows 24 and 29 (`chat-view.component.spec.ts`, Electron `new-project.spec.ts` reload case); route root pin has `harness-builder-state.service.spec.ts` |
| Old `harness-builder-view.component.spec.ts` / `HarnessBuilderViewComponent - surface question routing (TASK_2026_263)` | Surface question cards, tab isolation, answering, Stop, Start over and alert dismissal | replace-infra: covered by shared chat, rows 23, 27 and 28 (`harness-builder-view.prompt-isolation.spec.ts`, `chat-view.component.spec.ts`); leave choices have `harness-builder-view.component.spec.ts` |
| Old view spec / nested `session stats panel (TASK_2026_533)` | Stored snapshot plus live context badge | replace-infra: covered by shared chat/sidebar, row 25 (`harness-builder-sidebar.component.spec.ts`) |
| Old view spec / `HarnessBuilderViewComponent - transcript ordering` | Follow-up order, unstamped bubble and equal timestamp order | replace-infra: covered by shared chat transcript, row 21 (`chat-view.component.spec.ts`) |

The deleted groups cover replacement infrastructure plus the route/root and leave behaviors now tested in the builder specs. No keep, move or wire capability lost its only test through these deletions, so no additional spec was needed in this round.

## Fix round 2

- Added a live `tabs` signal to the `TabManagerService` mock in `harness-builder-view.prompt-isolation.spec.ts`, matching the API read by `PermissionHandlerService.attachPromptTargets` and its question counterpart. Production code was unchanged.
- Fixed the failed-bubble test mock in `harness-workflow-request.service.spec.ts` to copy the array supplied to `setMessages`. The implementation was right: it filters out the failed optimistic message, then sends the saved intake exactly once. The old mock reused the recorded empty array for the successful retry bubble, mutating Jest's call argument after the call.
- Focused Jest command: **2 suites passed; 14 tests passed**. The first attempt used `tail -40`, which PowerShell does not provide; the equivalent `Select-Object -Last 40` command completed. This round did not run the full 72-test suite.