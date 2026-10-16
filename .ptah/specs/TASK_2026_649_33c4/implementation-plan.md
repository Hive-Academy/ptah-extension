# Implementation plan — TASK_2026_649_33c4

## Summary

Implement the approved Gate 1.7 design with D9–D11. AI Team Builder and New Project become builder pages around one ordinary workflow-tagged chat tab, rendered by ptah-session-embed with chrome="bare" and ptah-harness-builder-sidebar [tabId]. The Setup Hub home remains visually unchanged. The builder-local adapter creates and enters the tab; WorkflowTabLauncherService is unchanged. The route carries mode and tab ID after reload. Preserve all user-visible capabilities in the 60-row parity inventory. Fix live stream, proposal misrouting and silent Apply through normal chat, session-scoped proposal hydration and explicit Apply result/error.

## Component boundaries

- HarnessWorkflowRequestService is the builder-local entry adapter. It resolves a same-mode running tab or saved draft; owns a single pending cross-mode intent `{ targetMode, pinnedWorkspaceRoot, validatedIntake? }` outside the Hub component; calls start-new-project only after the old session's leave choice finishes; creates/tags a normal tab, stores preamble and stack profile, navigates to the builder route and auto-sends the visible intake summary once. Return landed/cancelled/failed. It does not call the shared launcher or own chat transport.
- HarnessBuilderViewComponent is the route/page controller. It binds the route tab ID once, validates existence and workflow tag, pins its workspace and composes the embed, sidebar, responsive sheet and builder-only leave dialog. An unrelated active-tab change never rebinds it.
- HarnessBuilderSidebarComponent is standalone OnPush with required tabId input. It presents preview, stack profile, presets, eight AI helpers, Apply/result, health and session statistics. A dedicated bounded scroll body scrolls beneath a fixed strip at every width.
- Refactor HarnessBuilderStateService in place to tab-scoped signals and RPC orchestration; add a small builder-owned validated persistence service for user snapshot, one draft pointer per workspace and stack profile. Key all records by canonical pinned root plus tab ID. No new chat-types field.
- HarnessProposalStore persists proposal revisions and its existing merged projection. A singleton turn-attribution service retains SDK UserPromptSubmit timestamps by SDK session/workspace. Expose its synchronous capture through the existing platform-core proposal-store interface/token, so PtahAPIBuilderService can supply a `getProposingTurnStartedAt` dependency without importing rpc-handlers. The proposing tool freezes an unambiguous turn start at invocation, before asynchronous save, and passes it into `saveProposal`; the store never looks up the mutable latest turn. If the invocation cannot identify its turn, the persisted start is absent, so a user-chosen field wins.
- Existing ChatView, normal TabManager, WorkflowSessionIndexService, WorkflowSessionClaimService and StreamingSurfaceRegistry retain their roles. Tribunal and Apps still use the last two; CLI still uses backend flat-stream.

## Verified contracts

- SessionEmbedComponent has projection slots and scoped SESSION_CONTEXT, visible-tab registration and cleanup (libs/frontend/chat/src/lib/components/templates/session-embed.component.ts:32-45,55-63,76-124). Provide SESSION_EMBED_CHROME in that same child injector; input full by default.
- WorkflowTabLauncherService.open creates/tags a tab but also navigates to chat, adopts into grid and targets a prefill (libs/frontend/chat/src/lib/services/workflow-tab-launcher.service.ts:26-59). The builder adapter must be separate under D5.
- TabManagerService.setWorkflow/createTab/first-message preamble are the normal session mechanism (libs/frontend/chat-state/src/lib/tab-manager.service.ts:949-1012,1972-1986). WorkflowSessionIndexService indexes workspace/session/kind (libs/frontend/chat-state/src/lib/workflow-session-index.service.ts:58-79). ChatStore.sendOrQueueMessage targets a tab; MessageSender consumes its preamble (libs/frontend/chat/src/lib/services/chat.store.ts:261-265; libs/frontend/chat/src/lib/services/message-sender.service.ts:418-435).
- SurfaceRouterService builds child subPaths and restores URLs (libs/frontend/core/src/lib/routing/surface-router.service.ts:109-182); SurfaceRoutePersistence writes the settled route (libs/frontend/core/src/lib/routing/surface-route-persistence.ts:48-56). Current harness route is static (apps/ptah-extension-webview/src/app/app.routes.ts:118-129). Add harness-builder/:mode/:tabId; no router capability change is required.
- Hub currently switches directly to builder and drops New Project plugins/toolchain (libs/frontend/harness-builder/src/lib/components/setup-hub.component.ts:1298-1317,1397-1467). Request service currently passes through AppState (libs/frontend/harness-builder/src/lib/services/harness-workflow-request.service.ts:21-63). Legacy relay validates mode and reports errors (harness-workflow-message.handler.ts:49-86).
- Current builder host has height 100% but no min-height/overflow bound, while its row/aside have min-h-0 (libs/frontend/harness-builder/src/lib/components/harness-builder-view.component.ts:82-88,194-198,385-397). Electron route ancestors lack min-h-0 at the outer row and configuration host (libs/frontend/chat/src/lib/components/templates/electron-shell.component.ts:276,303-310); app-shell outlet wrapper is h-full w-full (libs/frontend/chat/src/lib/components/templates/app-shell.component.html:54-70).
- Proposal tool saves and broadcasts by SDK session ID (libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/harness-namespace.builder.ts:1084-1114). Store currently merges and stamps updatedAt at write time (libs/backend/rpc-handlers/src/lib/harness/config/harness-proposal-store.service.ts:60-89); get-proposal reads it (libs/backend/rpc-handlers/src/lib/handlers/harness-rpc.handlers.ts:911-923). SDK UserPromptSubmit callback already supplies sessionId, workspaceRoot and timestamp (libs/backend/agent-sdk/src/lib/helpers/user-prompt-submit-callback-registry.ts:8-22); DI token is in libs/backend/agent-sdk/src/lib/di/tokens.ts:148-149.
- MCP dispatch binds one AsyncLocalStorage context per `tools/call` (libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts:349-365; mcp-request-context.ts:21-49,58-76). `proposeConfig` synchronously resolves its caller SDK session before its first awaited `saveProposal` (harness-namespace.builder.ts:1084-1108); the builder supplies that resolver through PtahAPIBuilderService (ptah-api-builder.service.ts:862-887,1048-1075). This is the capture seam: read a uniquely attributable callback timestamp at method entry, freeze it in a local constant, and pass it through the save closure. The callback and MCP request context have no turn ID, so overlapping turns that cannot be linked to this call remain unattributed; never label an older call with a newer callback.
- Workflow-prompt currently requires nonempty intent (libs/backend/rpc-handlers/src/lib/handlers/harness-rpc.schema.ts:88-91) and its composer appends intent (libs/backend/rpc-handlers/src/lib/harness/ai/harness-workflow-prompt.service.ts:17-125). Add an additive context-only request form for the Configure preamble; existing nonempty-intent callers remain valid.
- Apply returns appliedPaths/warnings; New Project returns plugins/toolchain (libs/shared/src/lib/types/rpc/rpc-harness.types.ts:313-329,516-528). Proposal schema and push payload live at libs/shared/src/lib/types/rpc/rpc-harness.schemas.ts:465-477 and libs/shared/src/lib/types/messages/payload-map.ts:218-223.
- 677 owns app.config.ts, ChatView and several chat barrel appends. Only D8 exact token and exact barrel line intentionally overlap 649 (TASK_2026_677_efcd/implementation-plan.md:209,230-243; batches.md:1166). No 649 app.config.ts or ChatView edit.

## Data flow

1. Hub card or valid relay calls the adapter. Same-mode active tab/draft navigates to its builder URL without a second seed or send. In either cross-mode direction, persist one pending intent in the adapter before leaving the Hub: target mode, pinned workspace, and the already-validated New Project intake when applicable. Navigate to the **running** builder route and open its builder-only Save as draft / Discard / Cancel dialog. New Project may first pass through today's Hub confirm, but `confirmDiscardAndStart` only hands off the intent and navigates: it never calls `abortAndDispose` or `startNewProject`. The AI Team Builder card while New Project runs goes straight to this handoff. Guard the first transition synchronously; a second click while it is in flight is ignored. Cancel in either dialog preserves the run, clears intent, and never calls `harness:start-new-project`. No Hub template/style change; existing confirm copy is user decision (b).
2. On Save, persist draft pointer/snapshot before abort; on Discard, clear the old local records; then attempt abort/dispose and wait for it to settle, success or failure. Abort failure does not block leaving and follows warning decision (a). Clear the pending intent **before** destination navigation, so remount cannot reopen the dialog. A leave with no target returns to today's Setup Hub. A cross-mode target starts the requested mode only after the old leave attempt settles and lands on the new builder URL; its stored validated intake survives Hub unmount and is consumed once. Entry pins workspace, calls harness:start-new-project only for New Project, creates tab, sets workflow and preamble, writes stack profile, navigates, then sends New Project's visible intake summary once via ChatStore with tabId after embed registration. Configure waits for the first typed message, which consumes a context-only preamble. Never display the seed as the visible bubble. A failed stack-profile write is a nonfatal missing-details state: navigate and send, then show the unavailable fallback after the loading skeleton. Roll back only new state on a fatal entry failure.
3. Route binds the parameter tab, validates tag/root, initializes context and hydrates persisted user choices and own-session proposal records by attributed `turnStartedAt`, oldest to newest, with stable revision identity as a same-turn tie breaker. An unattributed revision never sorts after a newer attributed one and never displaces a user-chosen field; if its place relative to attributed revisions is unknowable, apply it before attributed revisions. A generation guard drops stale reads. Buffer live pushes during hydration, de-duplicate by revision identity, and recompute through the same ordering for live and reload. Never fall back to workspace's latest proposal.
4. At `proposeConfig` invocation, synchronously resolve the caller SDK session and pinned workspace, then freeze the uniquely matching SDK callback timestamp in a local immutable value **before** any awaited work. Pass that exact value as an argument through the namespace dependency, PtahAPIBuilderService closure, proposal-store interface and `save`; do not read an active-turn slot inside `save`. Keep per-session callback history/active invocation references long enough that a later UserPromptSubmit cannot replace a frozen value and terminal/abort cannot remove one still needed by an in-flight write; release references when the invocation settles and bound retained history. The available callback/context has no turn ID: if two retained callbacks could own a call, or the tool request arrives after overlapping callbacks without correlation, pass `undefined`, never choose the latest timestamp by guess. Each write persists update, completion and captured start (or absence) atomically with the merged legacy view and broadcasts the saved revision. Old merged-only records hydrate as one unattributed revision. For persona, agents, skills, system prompt and MCP, a proposal replaces a user-chosen field only if its turn start is strictly later than `chosenAt`; absent attribution loses. Unchosen fields take the newest **attributed turn**, not the last file append; lists merge by stable ID and omitted items remain. Preset load wins matching IDs and keeps others.
5. User Add to preview, preset load and Use as prompt create field-level user choices with chosenAt. Apply builds full config from visible preview at pinned root. Persist preview after Apply for changed-since-last-apply comparison. Save draft persists pointer and snapshot before abort/dispose; failure leaves dialog/session intact. Stop pauses without clearing. Clicking today's same-mode Hub card resumes the pointer; session list opens the tagged tab in normal chat. Replace-draft closes old tab, retains backend history, clears old local records. Start over/Discard/tab close/session delete clear snapshot and stack profile; post-tab-restore sweep removes orphans. Another active workspace cannot mutate the pinned record.

## Failure behaviour

Missing tab/wrong tag show explicit safe cards; initialization errors offer Retry. Invalid version/key/shape in persisted records is deleted and treated as absent. Stack-profile write/read failure does not cancel entry: after the loading skeleton the builder shows the unavailable-details fallback while navigation and first send proceed. Fatal entry failure is visible on the builder page when its route lands and cleans only state created by that attempt; the existing Hub intake error string remains only on the paths where today's Hub already renders it (setup-hub.component.ts:1440-1456). A malformed relay that stays on the Hub has no new error element under D10; its visibility is user decision (c). Proposal get/write failure keeps the last preview, shows scoped Retry and never imports another session. Apply failure is inline and dismissible, preserving preview; success shows actual paths/warnings and health until dismissal or preview change. Helpers run one at a time through typed RPC wrappers with existing 2/3 minute timeouts; results enter preview only on explicit Add. Save failure does not leave. Abort failure does not block leave; the destination warning is user decision (a).

## File-by-file change list, suggested batches

Executor for each batch: codex. File ownership is exclusive across these batches. Dependency edges: **B2 may run with B1; B3 after B1; B4 after B2 and B3.** Later verification is memory-safe: for each batch's changed projects only, one foreground command at a time, `npx nx run-many -t typecheck -p <changed> --parallel=1`, then `npx nx run-many -t lint -p <changed> --parallel=1`, then `npx nx run-many -t test -p <changed> --parallel=1 --maxWorkers=2` (or focused changed Jest specs with `--maxWorkers=2`). No build, serve, dev, e2e or workspace-wide command.

### B1 — backend proposal provenance and preamble

Files: libs/backend/rpc-handlers/src/lib/harness/config/harness-proposal-store.service.ts and spec; new harness/config/harness-proposal-turn-attribution.service.ts and spec; harness/di.ts; handlers/harness-rpc.handlers.ts, harness-rpc.schema.ts and specs; harness/ai/harness-workflow-prompt.service.ts and spec; libs/backend/platform-core/src/interfaces/harness-proposal-store.interface.ts; libs/shared/src/lib/types/rpc/rpc-harness-proposal.types.ts, rpc-harness.schemas.ts and specs; libs/shared/src/lib/types/messages/payload-map.ts; libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/harness-namespace.builder.ts and spec; ptah-api-builder.service.ts and spec. Subscribe once to SDK callback, retain bounded session/workspace turn history, expose a synchronous capture through the existing platform proposal-store interface/token, and freeze a uniquely attributable start inside `proposeConfig` at invocation. Pass it explicitly through `saveProposal` into the store, release an invocation reference in `finally` after save settles, and broadcast the saved revision. Add context-only prompt mode while keeping old RPC valid. Verify @ptah-extension/rpc-handlers, @ptah-extension/platform-core, @ptah-extension/shared, @ptah-extension/vscode-lm-tools. Acceptance: old records parse; T1 invocation freezes T1, T3 callback occurs before T1 save, persisted T1 start stays T1; ambiguous invocation stores absent; terminal/abort cannot erase a frozen in-flight value; push equals saved revision; existing prompt callers pass.

### B2 — embed contract

Files: libs/frontend/chat/src/lib/tokens/session-embed-chrome.token.ts and libs/frontend/chat/src/index.ts, with BYTE-IDENTICAL D8 token text from decisions.md:19-32 and barrel line from decisions.md:35; libs/frontend/chat/src/lib/components/templates/session-embed.component.ts and focused spec. Add chrome input full default and provide token beside SESSION_CONTEXT. Verify @ptah-extension/chat. Acceptance: bare child injector on builder, full on canvas, visible-tab registration intact. Coordinate append-only barrel merge with 677; no ChatView edit.

### B3 — builder state and sidebar

Files: refactor libs/frontend/harness-builder/src/lib/services/harness-builder-state.service.ts and spec, including removal of its builder-owned `registerWorkflowSurface` claim/stream path; add harness-builder-records.service.ts and spec, harness-proposal-hydration.service.ts and spec, harness-helper.service.ts and spec in that services folder; modify harness-rpc.service.ts only for missing typed wrappers; add components/harness-builder-sidebar.component.ts and spec, harness-builder-leave-dialog.component.ts and spec; refactor harness-config-preview.component.ts and spec. B3 does not edit the harness-builder public barrels. Own tab-keyed signals, Zod-persisted records, turn-ordered per-field precedence, presets, helper actions, one sidebar Apply/result, stats/health, draft pointer and clearing. Verify @ptah-extension/harness-builder. Acceptance: T1 revision persisted after T3 cannot overwrite T3's unchosen fields; D9 live/reload precedence, isolation/no resurrection, all helper actions, Apply paths/warnings, sidebar scroll structure, invalid-storage tests.

### B4 — page, entry and old transport replacement

Files: libs/frontend/harness-builder/src/lib/services/harness-workflow-request.service.ts and spec, harness-workflow-message.handler.ts and spec; components/harness-builder-view.component.ts and existing specs, setup-hub.component.ts and spec (behavior only, no template/style change); libs/frontend/harness-builder/src/index.ts and services.ts (B4 alone owns both public barrels); apps/ptah-extension-webview/src/app/app.routes.ts and route spec; libs/frontend/chat/src/lib/components/templates/electron-shell.component.ts only for the two missing min-h-0 ancestor constraints. Delete unused builder-only harness-workflow.service.ts and its obsolete spec/exports after callers move, plus its old workflow localStorage path. B3 removes the builder-owned claim/stream adapter; B4 removes remaining callers and exports. Do not delete WorkflowSessionClaimService, StreamingSurfaceRegistry or backend flat-stream. Do not edit app.config.ts, ChatView, app-shell or WorkflowTabLauncherService. Verify @ptah-extension/harness-builder, ptah-extension-webview and @ptah-extension/chat. Acceptance: both cross-mode directions reach the running builder's leave dialog without early abort; Save/Discard complete before starting the target; one pending transition and no repeat dialog on remount; both modes use ordinary live stream/cards/Stop/reload; route parameter survives reload and ignores active tab switches; same-mode draft resumes through today's Hub card; no Hub template/style change. At host widths 360/400/720/960 and height 480px, Jest asserts the structure: builder `:host` has `min-height:0; overflow:hidden` and bounded `height:100%`, page host is overflow-hidden, strip has `shrink-0` and is outside the sole `flex-1 min-h-0 overflow-y-auto` sidebar scroll body, in docked aside and narrow `absolute inset-0` sheet; Electron outer row and configuration host have `min-h-0`. Do not use jsdom scrollHeight as pixel proof. Visual-reviewer screenshots in dark/light, docked/sheet and a short window prove actual scrolling and no page overflow.

FU-648-2: Grid adoption/refusal is in the shared launcher (workflow-tab-launcher.service.ts:45-58; TASK_2026_648_374e/implementation-plan.md:94-105). Builder-local entry never adopts into a grid, so tile-cap refusal/prefill retarget does not apply here. 649 delivers explicit landed/cancelled/failed for the builder path; a future grid caller owns FU-648-2's refusal choice.

## Test plan per parity row

Each row is one meaningful behavioral proof or an existing retained test; source inventory is parity-inventory.md:19-78. Replacement rows test equivalent user behavior through normal chat.

| # | Proof |
| --- | --- |
| 1 | Hub grid/status/CLAUDE.md card remains, DOM unchanged. |
| 2 | Hub Back and Refresh still navigate/request status. |
| 3 | AI card click/Enter opens tagged builder route. |
| 4 | New Project Start/Resume label and same-mode resume work. |
| 5 | Intake fields, chips, validation and dialog keyboard work. |
| 6 | Valid intake calls start-new-project once and retains backend seed/plugin/toolchain behavior. |
| 7 | Stack profile stores returned plugin/toolchain data and restores after reload. |
| 8 | Both directions: New Project over Configure (existing Hub confirm then builder dialog) and Configure over New Project (builder dialog directly) reach the running route without abort; Cancel at either dialog keeps the run and never starts a new project; Save/Discard finish before the new builder URL. |
| 9 | Adapter returns landed/cancelled/failed and clears pending request. |
| 10 | Relay validates/enters; if the builder route lands, its page notice shows open errors; today's Hub intake error remains on its existing path. Malformed relay that stays on Hub is decision (c), with an option-specific visibility test. |
| 11 | Route tab binding survives refresh without AppState workflow handoff. |
| 12 | Initialize loads context/agents/skills/presets; spinner/Retry/live-tab skip work. |
| 13 | Workspace pin/badge remain; Apply stays pinned after workspace switch. |
| 14 | Mode title and config summary match bound tab. |
| 15 | Normal composer Enter/Shift+Enter/disabled behavior replaces old composer. |
| 16 | Configure context preamble consumed once, including empty-workspace branch. |
| 17 | New Project sends visible summary once with hidden seed preamble. |
| 18 | Normal start/continue and failure rollback show an error. |
| 19 | Normal tab uses selected model/effort. |
| 20 | Embed visible registration routes cards; Tribunal/Apps claim tests remain green. |
| 21 | Normal transcript/bubbles/nodes/empty/loading survive reload. |
| 22 | Agent execution nodes render through ChatView. |
| 23 | Permission/question cards target bound session. |
| 24 | Pending question restores after reload. |
| 25 | Sidebar session stats render before/after 677 public source integration. |
| 26 | Normal processing spinner/busy settles on completion or abort. |
| 27 | Stop pauses and keeps transcript/preview/draft. |
| 28 | Start/continue/abort/relay errors show and dismiss. |
| 29 | Route/tab/session restore after reload, with no duplicate run. |
| 30 | Normal tile displays correct workflow badge. |
| 31 | ChatView auto-scroll follows new messages. |
| 32 | X opens this tab in chat and leaves its run alive. |
| 33 | Sidebar toggle works docked and as sheet. |
| 34 | Empty/populated preview covers persona, goals, agents, skills, prompt, MCP. |
| 35 | Agent tool validates, stores attributed revision and broadcasts it. |
| 36 | Own-session live push buffered during hydrate; foreign push ignored. |
| 37 | Multiple own-session records hydrate by turnStartedAt rather than append order; stale generation dropped; a late-persisted T1 write cannot replace T3's unchosen fields. |
| 38 | D9 per-field and ID-list merge hold live/reload; T1 tool invocation freezes T1 before a T3 callback and later save; absent/ambiguous start loses to user. |
| 39 | Ready banner and the single sidebar Apply require valid config. |
| 40 | Apply sends full config to pinned root; backend artifacts persist. |
| 41 | Actual applied paths/warnings/health render until dismissal/change. |
| 42 | Apply error inline/dismissible, preview kept. |
| 43 | Start over Save/Discard/Cancel, no old-proposal resurrection. |
| 44 | Applied preset still appears in today's Hub saved presets card. |
| 45 | Named preset plus description saves and reloads. |
| 46 | Load preset overlays IDs, preserves other entries, writes user choices. |
| 47 | Existing health/reconcile/remove/repair tests and sidebar health line pass. |
| 48 | Existing skill/MCP agent tools still work. |
| 49 | suggest-config result requires Add to preview. |
| 50 | design-agents adds harness subagents only on Add. |
| 51 | generate-skills adds specs only on Add. |
| 52 | generate-document viewer/Copy and explicit Add path work. |
| 53 | analyze-intent maps blueprint only on Add. |
| 54 | discover-mcp/generate-prompt/generate-claude-md sidebar; search/create-skill agent tools. |
| 55 | CLI backend flat-stream consumer regression remains green. |
| 56 | Helper busy/result/error uses RPC, no private FE operation stream. |
| 57 | Log/alert/status labels, focus trap, Escape/return focus, icon labels pass. |
| 58 | Builder does not adopt grid; shared launcher cap behavior remains tested separately. |
| 59 | Workflow tags/session index show both modes after start and reload. |
| 60 | Parameterized builder route restores tab; invalid ID/tag shows safe card. |

## Risks

- SDK callback can be absent or overlap with another turn. The current per-call MCP context identifies session but has no turn ID (mcp-request-context.ts:21-49). Capture only an unambiguous start at invocation; preserve frozen values through terminal/abort and late save; retain bounded turn history and release settled invocation references. Never infer from write time/transcript or read a newer callback at save.
- Old merged proposal lacks per-field provenance. Retain compatibility but treat it as unattributed; new revisions and merged projection write atomically under existing lock.
- Hub conflict path spans two dialogs and async abort. Serialize transition before the first navigation, store validated intake outside Hub, scope by pinned workspace, clear before destination navigation, and assert no second abort/start on double click.
- Storage may be stale or malformed. Validate version, pinned root, tab ID and shape; run orphan sweep only after tabs restore.
- 677 shares chat/src/index.ts and owns ChatView/app.config.ts. Use exact D8 token/barrel text, append-only merge. Temporary duplicated stats strip before 677 is accepted by D8.
- Short Electron viewport can expand route ancestors despite sidebar overflow. Correct limiting ancestor min-h-0 and verify actual scroll body, not page scroll.

## Decisions

| Decision | Options; evidence | Reversible |
| --- | --- | --- |
| Builder-local adapter and route tab ID | Shared launcher/mutable singleton/builder adapter; D5, design-spec.md:386-415, workflow-tab-launcher.service.ts:26-59, surface-router.service.ts:109-182 | Yes |
| Existing Hub cards resume draft | New card/existing same-mode card; D10, setup-hub.component.ts:1298-1317 | Yes |
| Tab/workspace-keyed persisted records | Root singleton/tab-keyed; design-spec.md:177-183,407-415, harness-builder-state.service.ts:75-103 | Yes, migrated |
| Freeze turn start at tool invocation; apply revisions by turn start | Mutable latest at save/invocation-local frozen value/unattributed fallback; D9, harness-namespace.builder.ts:1084-1108, protocol-dispatcher.ts:349-365, callback-registry.ts:8-22; no turn ID in mcp-request-context.ts:21-49 | Yes, additive |
| Two-way cross-mode handoff via builder leave dialog | Early Hub abort/adapter-held pending intent; design-spec.md:5-9,255-270, setup-hub.component.ts:1298-1300,1397-1453 | Yes |
| Context-only Configure prompt | Fake intent/additive schema; harness-rpc.schema.ts:88-91, workflow-prompt.service.ts:17-125 | Yes |
| RPC helper state | Old operation stream/request-response; parity-inventory.md:67-74, design-spec.md:185-207 | Yes |
| Delete only builder-private transport | Delete shared claim registry/retain for Tribunal and Apps; parity-inventory.md:38-45, harness-workflow.service.ts:120-127 | Yes |

## Decisions for the user

**RESOLVED at Gate 2 (user, 2026-10-15, decisions.md D12): (a) option 1, (b) option 1, (c) option 1.** The Hub keeps its visual design; the warning line (a) and the error line (c) reuse existing Hub alert/text styles and patterns, and (b) is a copy-only change. Implement these in B4.

1. **(a) Abort failure warning after leaving.** D10 withdraws the Hub status line, while the leave contract says abort failure does not block leaving and needs a persistent warning (design-spec.md:5-9,416-418). `ActionBannerService.showWarning` auto-clears after eight seconds and renders only in ChatView (libs/frontend/chat/src/lib/services/action-banner.service.ts:90-96; chat-view.component.ts:374-409); the notification ledger has no arbitrary persistent warning API (libs/frontend/notification-center/src/lib/notification-ledger.service.ts:121-163). Options: **(Recommended) amend D10 for the one withdrawn Hub status line**, persistent and dismissible; **accept a transient warning before navigation**, explicitly relaxing persistence; **fund a persistent host-level warning surface for both VS Code and Electron**, outside this batch's current scope. Decision-dependent B4 step: choose and implement exactly the selected presentation, with a post-navigation visibility/dismissal test when persistence is selected. Until then, B4 must not silently add a Hub element or claim a persistent warning exists.

2. **(b) Existing Hub confirm copy.** Its button says “Discard and start” and body says starting a project “stops it and clears its transcript and configuration” (setup-hub.component.ts:1107-1131). Under the required two-dialog flow that button only opens the builder leave dialog; it does not abort. Options: **(Recommended) allow a copy-only amendment to D10 for this existing confirm** so it describes opening the leave choices; **retain today's wording**, accepting that the first click does not yet discard; **skip that confirm for this path** and go straight to the builder leave dialog, accepting a behavior change to the existing Hub confirm. Decision-dependent B4 step: update only the confirm words for option one, leave its template/style untouched for option two, or bypass it for option three; all options keep `confirmDiscardAndStart` free of abort/start and test Cancel preserves the old run. No new Hub element is authorized by this item.

3. **(c) Malformed relay while still on the Hub.** The current relay calls `workflow.setError`, which disappears when HarnessWorkflowService is removed (libs/frontend/harness-builder/src/lib/services/harness-workflow-message.handler.ts:49-86); the withdrawn Hub relay banner cannot be assumed (design-spec.md:5-9). Options: **(Recommended) amend D10 for a minimal Hub error element** on this path; **accept logging until a builder page opens**, with no on-Hub user notice; **route validly identified cases to a builder error card**, and log cases with no safe route. Decision-dependent B4 step: implement only the selected error surface, and test malformed mode/workspace inputs plus the path where routing succeeds. Existing Hub intake error remains only on the intake path; builder page notices cover failures after its route lands.

## Proposed Removals

None. Only duplicate builder-private composer, transcript, transport, claim adapter, operation stream and old workflow localStorage are removed after equivalent normal-chat behavior is proven. No user-visible capability removal is authorized.

## Open items

- User decisions (a)-(c) above control only their named presentation/copy steps; the two-way handoff, safe attribution and core builder migration proceed independently. No host API currently provides the persistent Hub warning described in (a).
- Re-review Minor 1 (`implementation-plan-re-review.md`): copy the validated intake out of the pending intent into the entry arguments first, then clear the intent slot, so the clear that stops a remounted dialog does not drop the intake the new start still needs.
- Integrate 677's final public stats-source export when it lands. Until then, D8 accepts duplicated stats in ChatView and sidebar.

## Revision log

| Review finding | Revision |
| --- | --- |
| 1. D9 late-turn attribution | Freeze at `proposeConfig` invocation, pass start into save, preserve in-flight value, order revisions by turn start, and name both T1/T3 regression tests. |
| 2. Two-way cross-mode leave | Persist mode/workspace/validated intake outside Hub, route both directions through the running builder dialog, guard double clicks, and defer abort/start until Save/Discard. |
| 3. D11 scroll proof | Replace jsdom scroll-height claim with width/height structure assertions and visual-reviewer screenshots; bound builder host and Electron ancestors. |
| 4. Batch file ownership | Assign harness-builder public barrels only to B4 and state B1/B2/B3/B4 dependency edges. |
| 5. Parity and entry failures | Correct row 39 to one Apply, name row 10's remaining surfaces and reserved relay decision, and make stack-profile write failure nonfatal. |
| 6. Verification and D8 text | Use run-many on changed projects with memory caps; cite decisions.md:19-32 for token and :35 for barrel line. |
