# Implementation Plan - TASK_2026_623_3492 (display panel)

Revision 2 (2026-10-09). Author: software-architect. Status: for Codex review round 1, then Gate 2.

Changes from revision 1 (`implementation-plan-review.md`, round 0; decisions.md #17 and #18):

- **Defect 1.** The `$limits` read follows decisions.md #18 and task-description.md R10.1 [rev 3.2]. Open Question 2 is
  removed. New tests show that the read never passes `refresh` and never spawns a lane. The formatter-equivalence
  fixture is kept (component 10).
- **Decision #17.** One Electron webview build plus one app launch is now an explicit, user-approved step V1 in the batch
  table. Open Question 1 is removed.
- **Defect 2.** R1.3 now maps to component 8 and batch H4, with a `chat-view.dock.spec.ts` assertion. It is added to the
  requirement map.
- **Defect 3.** P2 now depends on C1 as well as P1.
- **Consequence of the single build (decisions.md #17).**
  - R7.9 is checked against the design's stated 36 px collapsed height, which R7.9 permits, instead of a merge-base
    launch.
  - The eager-gate growth check runs only if merge-base stats already exist. Otherwise the eager additions are listed by
    name from the head stats.
- **Defect 4.** The DI and registration contract of `LanePlanLimitsRpcHandlers` now follows the
  `DiagnosticsConsentRpcHandlers` precedent, with an Electron-container resolution test (D13, component 10).

Path prefix: `W` = `D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel`. Every path below is relative
to `W` unless it is written absolutely. Every `file:line` was opened in this worktree at `70f995a56` (the head named in
`context.md`).

## Inputs and constraints

- Requirements used:
  - `task-description.md` revision 3.1 (R1-R10, NFRs). Gate 1 passed.
  - `design-spec.md` revision 3 plus `prototype/` (Gate 1.7 approved, decisions.md #11-#13).
  - `parity-inventory.md` revision 2 (every row `keep` or `move`; decisions #5 and #10 approve the two Electron moves).
  - `decisions.md` #1-#16. `context.md`, including its standing decisions.
- Conventions source: `D:\projects\ptah-extension\.ptah\specs\TASK_2026_610_6a10\implementation-plan.md`. This plan
  reuses its fence pipeline, host sources, eager-closure gate, host-source registry contract and batch style.
- Corrections applied: none.
- Design handoff used: `design-spec.md` sections 1-10, its revision-3 note, and `prototype/README.md`. The component names
  in this plan are the designer's, mapped to Angular selectors under the `ptah-` prefix.
- Rule carried from Gate 1.7: the dock's Agents tab always controls a `role="tabpanel"`. With no agents, that tabpanel
  shows its own empty state, "No agents in this session" (decisions.md #11, R1.13).
- User decisions after revision 1:
  - decisions.md #17 allows one Electron webview build plus one app launch after the frontend batches, for the visual
    reviewer and the eager-closure bundle gate. This is step V1.
  - decisions.md #18: `$limits` uses exactly the `ptah_agent_list` lookup. A local usage-reader process may run on a
    30 s cache miss. The read never starts an agent CLI session or lane and never forces a refresh
    (task-description.md R10.1 [rev 3.2]).
- Missing decision-critical input: none.
- CLAUDE.md memory-safe rules govern every verification command in this plan.

## Codebase evidence

### Fence pipeline and surface contract (shared)

| Evidence | Location | Architectural implication |
| --- | --- | --- |
| The opener is an exact string match, `trimmed === '```ptah-ui'`. An unclosed opener stays markdown. | `libs/shared/src/mcp-apps-contracts/ptah-ui-fence.ts:34-39` | The `display [id]` opener is a new exact-match branch. The unclosed-fence rule (R2.7) is already structural. |
| A fence segment is `{kind:'fence', key, ordinal, raw, body}`. | `libs/shared/src/mcp-apps-contracts/ptah-ui.types.ts:79-87`, `ptah-ui-fence.ts:49-55` | The segment gains `target` and `displayId`. |
| The parser hard-codes a two-space body. An indented top-level line is an error. | `ptah-ui-parser.ts:46-52,194,237,335-337,349-353` | The depth-relative grammar (R3) needs a parser rewrite. The 610 corpus is the regression net. |
| The parser caps are 8,192 bytes and 200 lines. Failures carry `(line N)`. | `ptah-ui-parser.ts:26-37,439-454` | The caps are kept. The new reason lines reuse `failureAt`. |
| The source registry is `PTAH_UI_SOURCES`, keyed by name: diff, tests, usage. | `ptah-ui-parser.ts:12-24`; `ptah-ui.types.ts:62` | `agents` and `limits` are added here. They are the only registry. |
| The converter emits flat, positional ids `c${n}` and `SURFACE_CATALOG_VERSION`. | `ptah-ui-converter.ts:35-66` | Depth-0 ids stay `c${n}`, so 610 blocks keep identical ids (R3.1). Nested ids extend the parent's id. |
| The resolver maps over top-level components only, with hard-coded switches per source. | `ptah-ui-resolver.ts:22-34,55-111` | It becomes recursive, and it gains `agents` and `limits` branches. |
| The row cap and "+N more" come from `SURFACE_LIMITS.maxTableRows`. | `ptah-ui-resolver.ts:201-253` | `$agents session` reuses the same mechanism (R5.11). |
| The pipeline maps limit failures to the generic text "block exceeds a display limit". | `ptah-ui-pipeline.ts:20-61` | R3.3 needs the reason to name the limit, so the mapping changes. |
| The envelope is `catalogVersion: 'dashboard-catalog/3'`, a literal type and a `z.literal` schema. | `surface.types.ts:172-180`; `surface.schemas.ts:581-594` | `/4` needs a union type and a supported-version enum. |
| The version pair check uses `find` on the schema version, which allows one catalog per schema. | `surface.validator.ts:112-163`; `surface-catalog.ts:14-20` | Pairs become a set, so spec/2 pairs with both `/3` and `/4`. |
| Layout kinds are `section stack grid card`. Display kinds are listed. | `surface-catalog.ts:22-47` | Add `accordion` (layout) and `avatar` (display). |
| The stat schema is strict, with a numeric `delta`. | `surface.schemas.ts:351-359`; `dashboard-spec.types.ts:136-142` | Add surface-only `trend` and `spark`. The v1 `DashboardStatComponent` is not touched. |
| Every component schema is `.strict()`. `class`, `style` and extra keys are rejected. | `surface.schemas.ts:496-518`; `surface-validator.spec.ts:586-588` | Trust specs for the new kinds follow the existing pattern (R4.2). |
| Budgets: `maxTreeDepth` 8, `maxChildrenPerNode` 50, `maxGridColumns` 4, `maxComponents` 200, `maxTableRows` 1,000, `maxSeriesPoints` 5,000, `maxSurfaceIdLength` 128. `SURFACE_STORE_LIMITS.maxSurfacesPerRoutingId` is 8. | `surface-catalog.ts:114-127,157-159` | The panel cap reads the constant (R1.12). |
| `SURFACE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/`. | `surface-catalog.ts:86` | The R3 `surfaceid` production equals this pattern. |
| The patch ops are set-data, remove-data, add-component, replace-component, remove-component and set-title. `replace` is an update operation. | `surface.types.ts:181-218` | An id update uses `replace` semantics. There is no new op (R2.4). |
| `TurnSourceSnapshot` is `{state, incomplete, diff, tests, usage}`. | `libs/shared/src/lib/utils/turn-sources.utils.ts:37-43,118` | Turn sources are unchanged. Live sources (`agents`, `limits`) travel separately (Decision D5). |
| The host-source registry contract fails on any new RPC or push whose name matches `/turn\|recap\|ptah-?ui\|change-?set\|host-?source\|turn-?tests\|usage/i`. | `libs/shared/src/lib/types/rpc/host-source-registry.contract.spec.ts:17-18,49-69` | The R10.1 method name must avoid those words: `agent:getLanePlanLimits`. |

### Webview (Angular)

| Evidence | Location | Architectural implication |
| --- | --- | --- |
| The main panel mounts one `ChatViewComponent` that switches tabs. Each canvas tile mounts its own instance through an injector that provides `SESSION_CONTEXT`. | `libs/frontend/chat/src/lib/components/templates/app-shell.component.html:814`; `libs/frontend/canvas/src/lib/canvas-tile.component.ts:418-419,613-627`; `libs/frontend/chat/src/lib/tokens/session-context.token.ts:9` | Per-tab panel state must be keyed by tab id in a ChatView-scoped store. Instance fields are not enough (R1.1). |
| ChatView providers: `TranscriptRetentionService`, `PanelResizeService`, `StatsTileExpansionState`, `SessionBudgetActionsService`. | `chat-view.component.ts:211-218` | The new `DisplayDockState` is provided here, next to `PanelResizeService`. |
| One transcript per retained tab: `@for (tabId of transcriptTabIds())`. | `chat-view.component.html:84-97`; `chat-view.component.ts:701-717` | Each transcript publishes its tab's display candidates and summaries to the dock store. |
| The monitor panel mount, sidebar toggle, separator and overlay rule. `AGENT_PANEL_OVERLAY_BREAKPOINT = 600`. | `chat-view.component.html:263-299`; `chat-view.component.ts:171,383-388` | The dock replaces this mount and keeps the overlay rule and breakpoint. |
| Agent auto-open and `_userExplicitlyClosed` are instance state. | `chat-view.component.ts:391,488-502,1163-1211` | Both move into per-tab dock state. |
| Escape closes the overlay. Focus returns to the toggle. | `chat-view.component.ts:180-187,440-445,1103-1115` | Reused for the dock (R1.2). |
| `PanelResizeService`: minimum 300, maximum 75%, `resetWidth`. It is re-provided per ChatView. | `libs/frontend/chat/src/lib/services/panel-resize.service.ts:21-54` | Kept as the clamp. The dock stores one width per tab and restores it on tab switch. |
| The monitor panel takes inputs `embeddedAgents`, `embeddedOpen`, `isOverlay`, `sessionId` and output `closed`. Its empty states are "No agents" and "Agents will appear here when spawned". | `libs/frontend/chat/src/lib/components/organisms/agent-monitor-panel.component.ts:598-615,642-659` | Docked mode gains one input. The empty copy changes to "No agents in this session" (decisions.md #11). |
| The transcript provides `[TranscriptRenderWindow, PtahUiLiveWindow]` per tab. It builds `ptahUiSnapshots` and `turnTestsAnchors` only when `isElectron`. | `chat-transcript.component.ts:185-187,549-560,589-629` | Display candidates and summaries are published from the same gated view. |
| Change-set card mount (L67-103), tests-row mount (L104-116), inline action error (L84-99). | `chat-transcript.component.html:67-116` | Electron mounts the turn chip at this position. VS Code keeps the card. |
| `TranscriptTurnSnapshots` keeps an identity-stable cache. `PENDING_TURN_SNAPSHOT` covers the open turn. | `transcript/transcript-turn-snapshots.ts:25-31,130-148,168-214` | The turn summary model reads the turn-end snapshot. No new snapshot field is needed. |
| `groupTurns`: a user message starts a turn. `TranscriptTurn` is `{endMessageId, assistants, roots, finalized, incomplete}`. | `transcript/transcript-turns.ts:19-50,85-126` | Agent facts per turn are derived from the same grouping. |
| The ptah-ui host is mounted only when `!isNodeStreaming()` and a fence line exists. Context is forwarded only through `message` nodes. | `execution-node.component.ts:57-85,176-205,356,556-561` | The chip appears after the text node settles. The panel is applied from candidates, not from mounted blocks (Decision D3). |
| `hasPtahUiFenceLine` has no imports and matches the exact opener. | `execution/ptah-ui-fence-line.ts:4,18-30` | Extended for `display`, with zero imports kept (eager). |
| The bubble builds a ptah-ui context only on Electron, for assistant messages. | `message-bubble.component.ts:150-211` | Unchanged. The VS Code regression follows from it (R1.14). |
| `PtahUiBlockComponent` calls `PTAH_UI_BLOCK_PIPELINE(body, {surfaceId, snapshot, countBytes})` and injects `PtahUiLiveWindow` as required. | `libs/frontend/chat-ui/src/lib/organisms/ptah-ui/ptah-ui-block.component.ts:41-44,155-156,200-214,265-271` | The pipeline input gains the live sources. Panel rendering does not use `ptah-ui-block` (no live-window provider in the dock). |
| `PtahUiMessageTextComponent` segments text and renders blocks per fence. | `ptah-ui-message-text.component.ts:40-98` | Display segments render the chip or the fallback instead of a block. |
| Secondary entries are path aliases: `chat-ui/ptah-ui`, `chat-ui/turn-recap`, `chat-ui/change-set-card`. | `tsconfig.base.json:48-60`; `libs/frontend/chat-ui/src/ptah-ui.ts:17-22`; `turn-recap.ts:15` | Add `@ptah-extension/chat-ui/display-panel` the same way. |
| `SurfaceRendererComponent` inputs: `renderable`, `viewState`, `interaction`. Outputs include `viewStateChange`. The view state is keyed by component id. | `libs/frontend/declarative-dashboard/src/lib/components/surface-renderer.component.ts:172-180`; `surface-view-state.ts:11-27` | Keeping view state per component id across an id update satisfies R2.4. |
| The renderer grid uses viewport `sm:grid-cols-*`. The root grid is `auto-fill minmax(9rem,1fr)`. | `surface-layout.component.ts:19,127-135`; `surface-renderer.component.ts:152-159` | R3.5 needs container queries (Decision D9). |
| `dashboard-stat` renders the delta as text. Escape collapses the expanded stat. | `dashboard-stat.component.ts:18-19,36-39,54-66` | The trend pill and sparkline extend this component. Its expand pattern is the R4.6/R9.1 pattern. |
| The node switch covers 19 kinds. An unknown kind emits `renderFailed`. | `surface-node.component.ts:67-72,148-229,313` | Add `accordion` and `avatar`. |
| The chart geometry has a fixed 600x280 viewBox. There is no sparkline component. | `dashboard-chart.component.ts:72-106`; `charts/chart-geometry.ts:18` | Add a sparkline geometry next to it (R4.4, "the renderer's own chart code"). |
| Tailwind 3.4 has no container-query plugin. Raw `@container` CSS is used in components. `cqi` is never used. | `apps/ptah-extension-webview/tailwind.config.js:71`; `compact-session-activity.component.ts:89`; `mcp-apps-page/.../apps-surface-panel.component.ts:151-157` | Container queries are written as component CSS. No plugin is added. |
| `AgentMonitorStore` is root. Subagents are keyed by `parentToolUseId`. `agentsOwnedBySession` is strict. | `libs/frontend/chat-streaming/src/lib/agent-monitor.store.ts:652-705,736,869` | The `$agents` projection reads `subagents()` and `agentsOwnedBySession(sessionId)`. |
| `SubagentRecord` fields: ids, names, status (8 values), `totalTokens`, `durationMs`, `parentSessionId`, `usage` (`lastRequestContextTokens`, `model`, `estimatedCostUsd`). It has no start time. | `agent-monitor.store.ts:125-144,526-608` | The turn of R comes from its Task node. Its start time comes from N `startTime`, otherwise it is unknown (R5.11 ordering). |
| `MonitoredAgent` fields: `startedAt`, `status`, `displayName`, `usageTotals` (null when unknown, always null after a history rebuild), `contextTokens` (always undefined for CLI). | `agent-monitor.store.ts:389-501,1588-1647` | CLI rows: context "unavailable" (decisions.md #16). Reloaded tokens and cost are "unavailable". |
| `subagentUsageView(R).contextTokens = usage.lastRequestContextTokens`. | `agent-monitor.store.ts:290-300,345-377` | Source of the `context` token count. |
| The capacity rule: exact model, `sdk-native` or `provider-catalog` with a `providerId`, `tokens` > 0. Percent = `round(used/window*1000)/10`. | `libs/frontend/chat/src/lib/services/chat-store/session-live-stats.util.ts:71-101`; `libs/shared/src/lib/utils/pricing.utils.ts:444-449` | Re-implemented as a pure predicate in the `$agents` resolver. The `chat` util stays as it is (Decision D6). |
| Capacity evidence on the frontend is `TabState.liveModelStats.contextCapacity`. | `libs/frontend/chat-types/src/lib/chat-types.ts:660-662`; `libs/frontend/chat-state/src/lib/tab-state.types.ts:16-23` | The evidence set for a tab is that one capacity. A subagent model gets a percent only when it matches exactly. |
| ExecutionNode agent fields: `toolCallId` :158, `agentType` :171, `agentPrompt` :177, `agentId` :183, `startTime` :191, `duration` :195, `tokenUsage` :197, `cost` :199. | `libs/shared/src/lib/types/execution/node.ts:140-203` | The facts projection copies only the allow-listed fields. |
| `ChangeSetActionsService` has `review`, `openFile` and `openScm`. `ChangeSetStore` has `marksFor`. | `libs/frontend/chat/src/lib/services/change-set/change-set-actions.service.ts:61-125`; `change-set.store.ts:328-367` | The dock (chat lib) owns these calls for the Files card. chat-ui cannot import chat. |
| Tags: chat, chat-ui and chat-streaming are `scope:webview,type:feature`. declarative-dashboard is `type:ui`. core is `type:core`. shared is `scope:shared,type:util`. | each `project.json:7`; `eslint.config.mjs:255-266,364-385` | chat-ui may import chat-streaming and core. declarative-dashboard imports only ui and util libs. |
| The eager gate's forbidden inputs and allowed growth list. | `scripts/eager-closure-gate.js:11-25`; spec `apps/ptah-electron/src/config/eager-closure-gate.spec.ts` | New lazy folders are added to the forbidden list. New eager files are added to the allowed list (R NFR lazy loading). |
| The only copy atom copies whole messages. `@angular/cdk/clipboard` is already used. | `libs/frontend/chat-ui/src/lib/atoms/copy-button.component.ts:8,25,48,62-85` | A text copy atom is needed for R7 (Decision D15). |
| The tool header is one `<button>` with a nested file link, and it has no spec. | `libs/frontend/chat-ui/src/lib/molecules/tool-execution/tool-call-header.component.ts:64-151,349-351` | R7.5 and the design need the open-file button as a sibling. A new header spec closes the parity gap (R7.1). |
| `detectLanguage` lives inside `code-output`. Output is `max-h-48`. | `code-output.component.ts:44-51,126-167` | It is extracted to a util so the header can show the language label (R7.5). |
| The diff lists all old lines, then all new lines, at `max-h-64`. | `diff-display.component.ts:59-66,149-163` | The order is kept (parity). A gutter and counts are added (R7.6). |
| `ptah-sidebar-tab` has inputs `label`, `side`, `isOpen`, `size`, `badgeType`, aria "Toggle {label} panel". | `libs/frontend/chat-ui/src/lib/atoms/sidebar-tab.component.ts:56,98-113` | Gains a `newCount` text badge for R1.8. |

### Backend (R10)

| Evidence | Location | Architectural implication |
| --- | --- | --- |
| `ptah_agent_list` limits are `ptahAPI.agent.limits?.(rows ?? await ptahAPI.agent.list())`. | `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts:235-247` | The new read calls the same two functions, so it lists the same lanes with the same lookup (R10.1). |
| `agent.list` uses `detectAll`, marks disabled CLIs, adds enabled Ptah CLI agents with keys, and applies the preferred order. `agent.limits` returns `undefined` without a lookup and maps a throw to per-lane `failed`. | `agent-namespace.builder.ts:440-518` | The lane set and failure semantics come for free. |
| `TOKENS.PTAH_API_BUILDER` is bound to `PtahAPIBuilder`, which has `build(): PtahAPI`. | `libs/backend/vscode-core/src/di/tokens.ts:91`; `libs/backend/vscode-lm-tools/src/lib/di/register.ts:90`; `ptah-api-builder.service.ts:332,543,750` | The handler injects the builder. |
| `planLimitRows(limit, now)` is private and returns six cells. `formatPlanLimitsSection` joins them. | `agent-limit.formatter.ts:185-232` | Export it as one implementation for both callers (R10.2, Decision D13). |
| `formatLimitColumn` states: at-limit, near-limit, confirmed-room, otherwise unknown. | `agent-limit.formatter.ts:147-175` | The scalars classify on `limit.state.state` the same way. |
| The lookup has a 3 s deadline, never rejects, and never passes `refresh`. A cache miss can start a provider reader. | `lane-limit-lookup.service.ts:110-168,186`; `libs/backend/auth-providers/src/lib/quota/plan-usage.service.ts:80,163-182` | "Does not bypass caches" holds. A reader process on a cache miss is permitted, and starting an agent CLI session or lane is not (decisions.md #18, R10.1 [rev 3.2]). |
| Handler pattern: `static METHODS`, `register()`, `rpcHandler.registerMethod`, a zod `*.schema.ts`. | `libs/backend/rpc-handlers/src/lib/handlers/provider-rpc.handlers.ts:112-166,235-244`; `boot-rpc.handlers.ts:41-95`; `boot-rpc.schema.ts:1-14` | Followed by the new handler. |
| Manifest entries carry `requires: Capability[]`. A gated family needs its own class. The manifest must cover `RPC_METHOD_NAMES`. | `libs/backend/rpc-handlers/src/lib/host-profile/manifest.ts:92-104,453-467,486-539` | New entry `lanePlanLimits` with `requires: ['lanePlanLimits']`. |
| Capabilities default to false. Electron enables its set. VS Code and CLI keep explicit expected-absent lists. | `capabilities.ts:18-97`; `host-profile.ts:83-94`; `apps/ptah-electron/src/rpc-host-profile.ts:26-46`; `apps/ptah-extension-vscode/src/di/expected-absent.ts:62-74`; `libs/backend/cli-engine/src/lib/rpc/expected-absent.ts:20-28` | Electron only, by profile (R10.1, R10.9). |
| `agent:` is an allowed method prefix. Registry plus `RPC_METHOD_ENTRIES` is the whole dual registration. | `libs/backend/vscode-core/src/messaging/rpc-handler.ts:44-93`; `libs/shared/src/lib/types/rpc.types.ts:750,3705,3723,4027-4066,4188-4202` | No prefix change is needed. |
| `provider:getPlanLimits` returns `PlanLimitsSnapshot`, which carries `owner.key` and `account`. | `libs/shared/src/lib/types/rpc/rpc-providers.types.ts:215-226`; `plan-limit.types.ts:123-192` | Left unchanged and not reused (R10.1 rev 3.1). |
| `PlanLimitsStore` is root, handles `planLimits:changed`, and exposes `snapshot` as a signal. `ClaudeRpcService.call` has a `timeout` option (default 30 s). | `libs/frontend/core/src/lib/services/plan-limits.store.ts:73-97,169-211`; `claude-rpc.service.ts:25,129-135` | A push changes `snapshot()`, which is the re-read trigger for live `$limits` blocks (R10.6). |

### Hint and skill

| Evidence | Location | Architectural implication |
| --- | --- | --- |
| `PTAH_UI_HINT` (77 tokens) and its spec (≤100 tokens, names the skill, no `/note/i`, each example parses). | `libs/backend/agent-sdk/src/lib/prompt-harness/ptah-ui-hint.ts:5`; `ptah-ui-hint.spec.ts:1-31` | Text and spec change. The `/note/i` assertion stays true. |
| The hint gate: Electron, coding profile, `ptahUiFence`. | `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts:1776-1779` | Unchanged (R8.1). |
| Two identical skill copies: `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/ptah-surface-authoring/` and `.claude/skills/ptah-surface-authoring/`. Plus `content-manifest.json:4,69-71`, generated by `npm run manifest:generate`. | `package.json:67-68`; `.github/workflows/content-manifest.yml:53` | Edit both copies and regenerate the manifest. |
| `catalog.md` is read by `surface-catalog-reference.spec.ts:34`. | `libs/backend/vscode-lm-tools/src/lib/code-execution/surface-catalog-reference.spec.ts:34` | Run it after the `/4` documentation change. |

## Architecture decision

- **Chosen approach:**
  1. Extend the existing 610 pipeline in place: fence, parser, converter, resolver and validator in `shared`, and one
     renderer in `declarative-dashboard`.
  2. Bump the catalog to `dashboard-catalog/4` with two new kinds and two new stat fields.
  3. Build the per-tab panel as a "dock" whose state lives in a ChatView-scoped store keyed by tab id.
  4. Apply display blocks from a deterministic per-tab projection of the transcript, not from mounted blocks.
  5. Deliver `$agents` and `$limits` as live sources beside the turn snapshot.
  6. Serve plan-limit rows through a new Electron-only, capability-gated RPC. It reuses the agent namespace and the
     formatter's own row function.
- **Rationale:** each step reuses a verified seam. The cited evidence above shows why each seam carries the case. The
  detailed reasoning is in the Decisions section.
- **Rejected alternatives:** listed per decision in the Decisions section.
- **Assumptions:** listed with their resolving checks under Assumptions.
- **Effect on existing code:**
  - Replaced (Electron only):
    - the in-chat change-set card placement and the tests row (`ptah-turn-tests-row` and its spec are deleted, and every
      case is ported);
    - the monitor panel's standalone mount (it becomes the Agents tabpanel).
  - Rewritten: `ptah-ui-parser.ts`.
  - Extended: fence, types, converter, resolver, pipeline, catalog, schemas, validator, text fallback, renderer
    components, the ptah-ui block and message text, the R7 molecules, the hint and the skill.
  - Left alone:
    - VS Code transcript behaviour (except R7);
    - footer badges;
    - `provider:getPlanLimits`;
    - the Apps page renderer's viewport layout;
    - the TUI.

## Decisions

Each decision gives the requirement, the choice, the evidence and the rejected alternative.

- **D1. `dashboard-catalog/4` is needed** (R4.1).
  - The catalog gains:
    - an `accordion` layout kind;
    - an `avatar` display kind;
    - stat `trend` (`{direction:'up'|'down', amount:number, percent:boolean, polarity?:'good'|'bad'}`);
    - stat `spark` (`readonly number[]`, 2..`maxSeriesPoints` points).
  - `SURFACE_SUPPORTED_CATALOG_VERSIONS = ['dashboard-catalog/3','dashboard-catalog/4']`.
  - `DASHBOARD_CONTRACT_VERSION_PAIRS` gains `[spec/2, catalog/4]`. The pair check matches the whole pair instead of
    `find` by schema (`surface.validator.ts:155-163`).
  - A `/3` envelope that uses a `/4` kind or field is rejected, with a reason naming the field. The catalog stays
    semantic per version.
  - The converter always emits `/4`. R3.1 permits this one literal change.
  - Rejected: putting the new fields on `/3`. That silently widens a released catalog, the TASK_2026_594 versioning rule.
- **D2. `accordion` is a new layout kind**, not `collapsible` on `card`.
  - Shape: `{id, kind:'accordion', title: SurfaceRichText (required), children}`.
  - Closed by default is intrinsic to the kind (R4.6). `section` stays open by default, as the design says.
  - Rejected: `card.collapsible`. A card would then need a second field for its default state, and a
    `card`/`accordion` fence would map to one kind with two meanings.
- **D3. Display blocks are applied from a transcript projection, not from mounted block components** (R2.7-R2.9,
  R1.7-R1.9).
  - The transcript (eager, per tab) runs a zero-import string scan over top-level assistant text nodes and publishes
    `DisplayCandidate[]`:
    - `blockKey` = `messageId:nodeId`;
    - `orderKey`, `text`, `turnKey` (the id of the user message that opened the turn);
    - `live` = the message is at or past `streamingBoundary`.
  - A lazy headless `ptah-display-surface-sync` (one per transcript) does the rest:
    - segments each candidate with `segmentPtahUi`, which yields closed fences only;
    - runs the pipeline in R2.8 order;
    - applies the id rule and the cap;
    - publishes surfaces and per-fence statuses to the dock store.
  - Why: the render window does not mount every message (`TranscriptRenderWindow`), and the ptah-ui host refuses to
    mount while a node streams (`execution-node.component.ts:556-561`). Mount-driven application would miss blocks on
    reload and would wait for the node to end, which violates R2.7 and R2.9.
  - Rejected: registering from `ptah-ui-block` instances. That is order-dependent, misses unmounted messages, and
    needs a live-window provider in the dock.
- **D4. Per-tab dock state lives in a ChatView-provided `DisplayDockState`, keyed by tab id** (R1.1).
  - Per tab: `open`, `pinned`, `activeTab: 'displays'|'agents'`, `widthPx | null`, `userClosedTurnKey`, `newCount`,
    `seenBlockKeys`, `selectedSurfaceKey`, `selectedSummaryTurnKey`, `surfaces`, `statuses`, `summaries`.
  - It holds no `mcp-apps-contracts` runtime import (types only), so it may be eager.
  - Canvas tiles get their own ChatView, so they get their own store.
  - Rejected:
    - instance signals on ChatView. The main ChatView switches tabs (`app-shell.component.html:814`).
    - a root store. It would leak state across tiles and canvas instances that show the same tab id.
- **D5. Live sources are separate from `TurnSourceSnapshot`** (R5.4, R10.6).
  - `RenderPtahUiBlockInput` gains `agents?: PtahUiAgentsInput | null` and `limits?: PtahUiLimitsInput | null`.
  - The pipeline exposes `compilePtahUiBlock(body, surfaceId)`, which parses and converts once and reports the
    `usedSources` set. `renderPtahUiBlock` keeps its signature for existing callers and composes compile, resolve and
    validate.
  - Blocks compute the agents input only when `usedSources` has `agents`, and the limits input only when it has
    `limits`.
  - Why: the open turn's snapshot is the frozen `PENDING_TURN_SNAPSHOT` (`transcript-turn-snapshots.ts:25-31`).
    Agents must update live during the turn. Folding agents into the snapshot would also break the snapshot identity
    cache for every block.
  - Rejected: adding `agents` to `TurnSourceSnapshot`.
- **D6. The `$agents` merge, aggregation and context logic is one pure module.**
  - The module is `libs/shared/src/mcp-apps-contracts/ptah-ui-agents-source.ts` (lazy, already forbidden-eager).
  - It is fed by minimal, allow-listed fact types. A projection picks those fields from N, R and M, so prompt and output
    text never enter the module (R5.1).
  - The capacity predicate restates `session-live-stats.util.ts:77-89` over a passed evidence list.
  - Rejected: importing the `chat` util into shared. That breaks dependency direction (shared is `type:util`).
- **D7. Turn attribution.**
  - N: the turn whose trees contain it.
  - R: the turn whose trees contain a node with `toolCallId === R.parentToolUseId`. That node is the Task tool node or
    the agent node (`agent-monitor.store.ts` docblock `:241-251`). An unmatched R belongs to no turn and appears in
    neither scope. This is an assumption, A3.
  - M: `turn.startedAt <= M.startedAt < nextTurn.startedAt`, where `startedAt` is the turn's user message `timestamp`
    (`libs/shared/src/lib/types/execution/agent.ts:93`).
  - R start time: its matched N `startTime`, otherwise unknown. Unknown sorts last within the turn, by key (R5.11).
- **D8. Reload (R5.6).**
  - R and M values are in-memory store records, and the store has no per-turn persistence for R. M rebuilt from history
    carries `usageTotals: null` (`agent-monitor.store.ts:1641`).
  - So R-only fields and M tokens and cost render "unavailable" after reload. N-backed rows rebuild from the stored
    tree.
  - No restore path is added.
- **D9. Container-relative layout is opt-in on the renderer**, through
  `layoutWidth = input<'viewport'|'container'>('viewport')` on `SurfaceRendererComponent` (R3.5).
  - Inline blocks and the panel pass `'container'`. The Apps page keeps `'viewport'`, so its behaviour is unchanged
    (NFR compatibility).
  - In container mode:
    - the root is `container-type:inline-size; container-name:dp`;
    - a grid is one column below 360 px;
    - above 360 px it uses `repeat(auto-fit, minmax(min(100%,128px),1fr))`, with `columns` as a ceiling;
    - stat grids get 3 columns at ≥ 700 px (design section 7).
  - The 360 px floor resolves a conflict between the design (128 px minimum, which fits 2 columns at 300 px) and R3.5
    (1 column at 300 px). The requirement wins, and it matches the design's own summary grid ("1 column at 300 px").
  - Two real consumers with different contracts justify the input.
  - Rejected: global container queries. They would change Apps page column counts.
- **D10. Id update = `replace` semantics, with view state keyed by component id** (R2.4).
  - The dock store keeps one `SurfaceViewState` per surface key. On update, the sync prunes view-state entries whose
    component id is gone, or whose converted component JSON differs from the previous version. The rest are kept.
  - No `SurfacePatchOp` is added or used. The update is semantically a `SurfaceUpdateInput` `replace`
    (`surface.types.ts:201-206`).
  - Rejected: diffing into `replace-component` ops through `applySurfaceOps`. It produces the same visible result with
    more code, and the selection rules (`surface-patch.ts:231-240`) are irrelevant to display surfaces.
- **D11. Surface keys and the cap.**
  - An agent block with id `X` has key `id:X`. An anonymous block has key `anon:<blockKey>:<ordinal>`.
  - Ids beginning `ptah.` are reserved for host content. A block that names one is invalid with reason
    "reserved display id" (R2.5). The turn summary uses `ptah.turn-summary` and never enters the agent cap.
  - The cap is `SURFACE_STORE_LIMITS.maxSurfacesPerRoutingId`. The entry least recently created or updated in R2.8 order
    is dropped. Its fences get status `evicted`.
  - The computation is a pure function of the ordered candidates, so reload reproduces the panel (R2.9).
- **D12. Auto-open** (R1.7-R1.10).
  - The sync calls `dock.requestAutoOpen(tabId, turnKey, surfaceKey)` only for a fence that:
    - is applied (valid),
    - is in a `live` candidate, and
    - has a `blockKey:ordinal` not in the tab's `seenBlockKeys`.
  - `seenBlockKeys` lives in the ChatView store, so a sync remount (tab switch, render-window remount) cannot re-trigger.
  - The store ignores the request when `userClosedTurnKey === turnKey`. It increments `newCount` instead.
  - Replay candidates are not `live`, so they never auto-open.
  - The summary never calls `requestAutoOpen`.
- **D13. The R10.1 read is `agent:getLanePlanLimits`, served by a new `LanePlanLimitsRpcHandlers`** (`rpc-handlers`).
  - It is gated by a new capability `lanePlanLimits`: on in Electron, listed absent in VS Code and the CLI.
  - It builds rows with the formatter's own `planLimitRows`, exported as `formatPlanLimitRows`. The list output stays
    byte-identical.
  - The method name passes the host-source contract pattern.
  - Read semantics follow decisions.md #18:
    - It uses the same lookup as `ptah_agent_list`: `agent.list()` then `agent.limits(rows)`.
    - It never passes `refresh`.
    - It never calls a spawn, stop or session method.
    - A provider usage reader may run on a 30 s cache miss. That is permitted.
  - **DI and registration contract.** It follows `DiagnosticsConsentRpcHandlers` exactly. That is the closest precedent:
    a lib-owned, capability-gated family that Electron enables.
    - Precedent locations:
      - `libs/backend/rpc-handlers/src/lib/handlers/diagnostics-consent-rpc.handlers.ts:26-29,98-119`;
      - manifest entry `libs/backend/rpc-handlers/src/lib/host-profile/manifest.ts:459-467`;
      - Electron flag `apps/ptah-electron/src/rpc-host-profile.ts:45`.
    - The class is `@injectable()`. Its constructor injects three existing tokens. No new `Symbol.for` token or port is
      needed:
      - `@inject(TOKENS.LOGGER)`;
      - `@inject(TOKENS.RPC_HANDLER)`, as `agent-rpc.handlers.ts:290-292` does;
      - `@inject(TOKENS.PTAH_API_BUILDER) private readonly apiBuilder: PtahAPIBuilder`. This has precedent at
        `http-mcp-server.service.ts:268-270`. The type is exported by the `vscode-lm-tools` barrel (`src/index.ts:7`),
        and the token is defined at `vscode-core/src/di/tokens.ts:91`.
    - `static readonly METHODS = ['agent:getLanePlanLimits'] as const satisfies readonly RpcMethodName[]`, plus
      `register()`.
    - The class is not added to `registerSingleton` in `apps/ptah-electron/src/di/phase-4-handlers.ts`.
      `registerRpcSurface` resolves lib-owned manifest handlers directly with `container.resolve(ctor).register()`
      (`register-rpc-surface.ts:176-198`), as it does for `DiagnosticsConsentRpcHandlers`. The call is made from
      `apps/ptah-electron/src/activation/wire-runtime.ts:328`.
    - Electron is the host whose `PLATFORM_TOKENS.HOST_KIND` is `'electron'` (`apps/ptah-electron/src/di/phase-1-infra.ts:92`).
      Its profile sets `lanePlanLimits: true`. VS Code and the CLI leave it off (A5).
    - Imports of `vscode-core` and `vscode-lm-tools` stay in `rpc-handlers` and `apps/ptah-electron`. Shared code gets
      plain types only (`rpc-lane-plan-limits.types.ts`). Webview code reaches the read only through
      `ClaudeRpcService.call`.
  - Rejected:
    - extending `provider:getPlanLimits` (forbidden by R10.1 rev 3.1);
    - moving the formatter to `shared` (a larger move with no extra consumer, since the webview receives text);
    - `requires: []` plus an "unavailable" answer. VS Code would then expose a read the requirement keeps Electron-only.
- **D14. Chunking.**
  - New lazy entry `@ptah-extension/chat-ui/display-panel`: the panel, the summary cards and the surface sync. It imports
    `declarative-dashboard`.
  - The existing `turn-recap` entry: the turn chip and the summary model. It has no renderer import, so a chip never
    pulls the renderer (NFR: "with no valid block and no summary chip opened, the renderer chunk is not requested").
  - The existing `ptah-ui` entry: the display chip.
  - The dock component (chat lib) is referenced only inside `@defer (when dockOpen())`. The monitor panel moves into
    that deferred dock.
  - Eager additions:
    - the fence-line check;
    - two pure transcript projections;
    - the dock store;
    - the host-sources token file;
    - the `ptah-sidebar-tab` badge.
  - All are added to the gate's allowed growth list and named in the bundle report.
- **D15. A new `ptah-copy-text-button` atom in chat-ui** (`text` input, `label` input, cdk `Clipboard`, a live-region
  "Copied").
  - The existing copy button takes a whole message (`copy-button.component.ts:48`).
  - Rejected: generalising the message copy button. That changes the footer contract, which is `keep` by decision #6.
- **D16. Delete `ptah-turn-tests-row` and its spec.** Port every case to the Tests card spec. This follows the
  replace-don't-accumulate rule. VS Code never rendered it (`chat-transcript.component.ts:589-597`).
- **D17. Visual tokens.** Renderer and panel CSS use the design's `--dp-*` tokens, defined once on the renderer root and
  on the dock root, with `dp-` class names (design decisions 3 and 5).
  - The sparkline highlight is `primary` (decisions.md #12). A failing series uses the error fill.
  - The turn summary keeps the warm gradient (decisions.md #13).
  - DaisyUI `collapse` is not used (design decision 4).

## Assumptions

Each assumption is resolved by the implementer before or in the named batch.

- **A1.** `PtahAPIBuilder.build()` is cheap enough to call once per read, or it memoizes.
  - Check: read `ptah-api-builder.service.ts:543` onward (batch BE3). If it is not memoized, the handler builds once
    lazily and keeps the `PtahAPI`.
- **A2.** `TOKENS.PTAH_API_BUILDER` is registered in the Electron container before `registerRpcSurface`
  (`apps/ptah-electron/src/activation/wire-runtime.ts:328`).
  - Check: grep the Electron phase files for `registerVsCodeLmToolsServices` or the equivalent, plus
    `container.smoke.spec.ts`.
- **A3.** Every SDK subagent record's `parentToolUseId` equals the `toolCallId` of a node in the transcript tree.
  - Check: `agent-monitor.store.ts:241-251` and the execution-tree builder for Task and Agent tool nodes. If a background
    agent's Task node can be absent, R falls back to "no turn" (D7). The R5.9(d) fixture then seeds the Task tool node.
- **A4.** The open turn's messages in `vm().messages` carry their streaming text nodes, so candidates appear before the
  turn ends.
  - Check: `chat-transcript.component.ts` `vm` and `groupTurns` roots (`transcript-turns.ts:30-35`) on a streaming
    message.
- **A5.** `capabilities()` defaults omitted capabilities to false. The expected-absent lists are asserted complete.
  - Check: `host-profile.ts:83-94` and the specs that read `EXPECTED_ABSENT_CAPABILITIES`. If the lists are asserted
    exhaustive, add `lanePlanLimits` to both. If they are not, add it anyway for documentation.
- **A6.** `add-component` and the `locate` walk treat any `SURFACE_LAYOUT_KINDS` member as a parent.
  - Check: `surface-patch.ts:73-91,154-179`. If they use a hard-coded list, add `accordion`.
- **A7.** Spark points count toward `maxSeriesPoints` with the same per-component rule as chart series.
  - Check: the series budget in `surface.validator.ts` / `surface.schemas.ts` (`checkChart`).
- **A8.** `surface-catalog-reference.spec.ts` either derives the Apps tool text from `catalog.md`, or only pins it.
  - Check: read it in batch DOC2. Record any Apps `tools/list` character delta in `measurement.md` (NFR context
    budget).
- **A9.** An exit code is not on `ExecutionNode`.
  - Check: `node.ts` and the Bash tool output shape. If there is no exit code, the outcome's accessible name is
    "Command succeeded" or "Command failed", without "exit code N". The design example's exit code is then omitted, not
    guessed.

## Component specifications

### 1. Catalog `/4` contract (shared)

- **Purpose:** the semantic `/4` vocabulary and its validation.
- **Responsibilities:**
  - D1 constants, types, schemas and version pairing.
  - `/3` rejects `/4` features.
  - Trust: no class, style, url, colour or icon field.
  - Closed enums for direction, polarity and tone.
  - A text fallback for the new kinds.
- **Verified contracts:**
  - `surface-catalog.ts:9-20,22-47,114-127`
  - `surface.types.ts:24-48,94-100,172-180`
  - `surface.schemas.ts:351-359,496-518,581-594`
  - `surface.validator.ts:112-163,617-658`
  - `surface-text-fallback.ts` (`renderSurfaceText`, consumed at `ptah-ui-block.component.ts:20-29`)
- **Dependencies:** shared only.
- **Integration:**
  - the pipeline (component 2);
  - the renderer (component 3);
  - the Apps validator path (`/3` unchanged).
- **Failure behaviour:**
  - The validator returns a reason. It never throws.
  - A `/4` field on `/3` fails with a reason naming the field.
- **Quality:**
  - Every existing `/3` contract, budget and trust spec passes unchanged.
  - `dashboard-spec/1` is untouched.
- **Verification seam:**
  - `surface-validator.spec.ts` (new cases: `/4` accepted; `/3` with avatar, accordion, trend or spark rejected; `class`,
    `style` and `url` on avatar, accordion and stat trend rejected; spark of 1 point rejected; `maxSeriesPoints`+1
    rejected);
  - `surface-text-fallback.spec.ts`;
  - the `surface-budgets.spec.ts` regression.
- **Files:**
  - MODIFY `libs/shared/src/mcp-apps-contracts/surface-catalog.ts`
  - MODIFY `libs/shared/src/mcp-apps-contracts/surface.types.ts`
  - MODIFY `libs/shared/src/mcp-apps-contracts/surface.schemas.ts`
  - MODIFY `libs/shared/src/mcp-apps-contracts/surface.validator.ts`
  - MODIFY `libs/shared/src/mcp-apps-contracts/surface-validator.spec.ts`
  - MODIFY `libs/shared/src/mcp-apps-contracts/surface-text-fallback.ts`
  - MODIFY `libs/shared/src/mcp-apps-contracts/surface-text-fallback.spec.ts`
  - MODIFY `libs/shared/src/mcp-apps-contracts/surface.index.ts`
  - MODIFY `libs/shared/src/mcp-apps-contracts/surface-patch.ts`, only if A6 requires it

### 2. ptah-ui grammar pipeline (shared)

- **Purpose:** turn a fence into a validated `/4` surface. Grammar, sources and caps are the only trust boundary for
  agent text.
- **Responsibilities:**
  - **Fence** (`ptah-ui-fence.ts`):
    - Recognise exactly `` ```ptah-ui ``, `` ```ptah-ui display `` and `` ```ptah-ui display <id> ``, after trailing-space
      removal, with exactly one space between parts.
    - `<id>` must match `SURFACE_ID_PATTERN` and be at most `maxSurfaceIdLength` long.
    - The segment gains `target: 'inline'|'display'` and `displayId?: string`.
    - Any other `ptah-ui …` info string stays markdown (R2.1).
  - **Types** (`ptah-ui.types.ts`):
    - Container and atom element types.
    - `PtahUiSourceName` adds `'agents' | 'limits'`.
    - `PtahUiScalar` and the source table and list gain `scope?: 'session'`.
    - Failure codes add `'depth'`, `'reserved-id'` and `'limit'`.
  - **Parser** (`ptah-ui-parser.ts`, REWRITE):
    - The R3 EBNF delta and lexical delta, verbatim.
    - Depth = leading spaces / 2. An odd count or a jump greater than 1 is invalid.
    - A reason names the line and the expected depth, as `(line N, expected depth D)`, per the Risks table.
    - Element bodies sit at depth+1, so every 610 block parses unchanged.
    - `session` is valid only after `agents` (R5.11). `$limits session`, `$diff session` and `$agents sessions` are
      invalid.
    - Body caps are unchanged.
    - `PTAH_UI_SOURCES` gains:
      - `agents`: scalars `total running completed failed tokens cost`; columns `name status tokens cost duration
        context`;
      - `limits`: scalars `lanes atLimit nearLimit unknown`; columns `lane window used state reset`.
  - **Converter:**
    - Depth-0 items keep `c${n}`, with stats expanded as today.
    - The children of a container with id `P` are `${P}.${i}`, which `SURFACE_ID_PATTERN` allows.
    - Mapping per R3.2 and the R4 table: `note` → `alert` with tone mapping; `badge` and `progress` → existing kinds;
      `avatar` → `avatar`; statline trend and spark → stat `trend` and `spark`.
    - A block-level `title` becomes the envelope title.
    - Bindings carry `scope`.
  - **Resolver:**
    - Recursive over children.
    - `agents` delegates to component 2a. `limits` reads `PtahUiLimitsInput`.
    - `list $agents` lists `name`. `list $limits` lists `lane`.
    - A `$limits` table sets `description` to "as of HH:MM" (R10.6).
    - Unavailable, pending and "+N more" follow 610 rules. The literal "unavailable" is never 0.
  - **Pipeline:**
    - `compilePtahUiBlock`, which returns the conversion plus `usedSources`.
    - `renderPtahUiBlock(body, {surfaceId, snapshot, agents?, limits?, countBytes})`.
    - Validation reasons name the limit, for example `maxTreeDepth (8) exceeded` (R3.3), using the validator's own
      limit words.
- **Verified contracts:** see the evidence table "Fence pipeline and surface contract".
- **Dependencies:**
  - shared only;
  - `usage-format.utils` for USD and duration (`ptah-ui-resolver.ts:1-4`).
- **Integration:**
  - `ptah-ui-block` (inline);
  - the display sync (panel);
  - the hint spec (examples parse).
- **Failure behaviour:**
  - Never throws: parse failure, or `internal error` from a `try` (`ptah-ui-pipeline.ts:49-50`).
  - Invalid means atomic fallback (R2.6).
  - A reserved id is invalid (D11).
- **Quality:**
  - One compile per body.
  - Resolve reruns only for used sources (D5).
- **Verification seam:**
  - `ptah-ui-fence.spec.ts`: every opener variant, valid and invalid (R2.1).
  - `ptah-ui-parser.spec.ts`: R3.4's full list, a case per lexical row, every limit at the limit and one over (R3.3),
    and the `session` grammar cases (R5.11 last bullet).
  - `ptah-ui-converter.spec.ts`: a fixture per container (R3.2) and the 610 corpus deep-equal except `catalogVersion`
    (R3.1).
  - `ptah-ui-resolver.spec.ts`: `$limits` with three lanes (R10.10) and a recursive binding.
  - `ptah-ui-pipeline.spec.ts`: a reason naming the limit, and a reserved id.
- **Files:**
  - MODIFY `libs/shared/src/mcp-apps-contracts/ptah-ui.types.ts`
  - MODIFY `libs/shared/src/mcp-apps-contracts/ptah-ui-fence.ts` (+ `.spec.ts`)
  - REWRITE `libs/shared/src/mcp-apps-contracts/ptah-ui-parser.ts`
  - MODIFY `libs/shared/src/mcp-apps-contracts/ptah-ui-parser.spec.ts`
  - MODIFY `libs/shared/src/mcp-apps-contracts/ptah-ui-converter.ts` (+ `.spec.ts`)
  - MODIFY `libs/shared/src/mcp-apps-contracts/ptah-ui-resolver.ts` (+ `.spec.ts`)
  - MODIFY `libs/shared/src/mcp-apps-contracts/ptah-ui-pipeline.ts` (+ `.spec.ts`)
  - MODIFY `libs/shared/src/mcp-apps-contracts/ptah-ui.corpus.ts`
  - MODIFY `libs/shared/src/mcp-apps-contracts/ptah-ui-compactness.spec.ts`
  - CREATE `libs/shared/src/mcp-apps-contracts/ptah-ui-agents-compactness.spec.ts` (R8.5)
  - MODIFY `libs/shared/src/mcp-apps-contracts/surface.index.ts`

### 2a. `$agents` source resolver (shared, pure)

- **Purpose:** produce one row per logical agent and the scalars, with no private text (R5).
- **Responsibilities:**
  - **Input types** (`PtahUiAgentsInput`):
    - `{ turnIndex, turns: readonly TurnAgentFacts[], records: readonly SubagentFact[], lanes: readonly CliLaneFact[],
      capacities: readonly ContextCapacity[] }`.
    - `TurnAgentFacts = { startedAt, nodes: AgentNodeFact[], spawnToolCallIds: string[] }`.
    - `AgentNodeFact = { id, toolCallId?, agentId?, agentType?, startTime?, tokens?, cost?, durationMs?, status }`.
    - `SubagentFact = { parentToolUseId, agentId?, teammateName?, agentType?, status, totalTokens?, inputTokens?,
      outputTokens?, cost?, durationMs?, contextTokens?, model? }`.
    - `CliLaneFact = { agentId, cli, displayName?, status, startedAt, tokens?, cost?, durationMs?, contextTokens? }`.
    - None of these has a field for task, description, prompt, summary, stdout, stderr, error or output file.
  - **Merge:** the R5 union-key rules 1-5. CLI rows never merge. Field precedence as specified. `name` comes only from
    `teammateName`, `agentType` or `displayName`/`cli`.
  - **Status vocabulary:** `killed` and `timeout` → `stopped`; `paused` and `background` → `running`. The N statuses
    map as follows (assumption to pin in a spec): `pending` → pending; `streaming` and `resumed` → running; `complete`
    → completed; `error` → failed; `interrupted` → stopped.
  - **Scope:**
    - turn: rows attributed to `turnIndex` (D7);
    - session: rows of turns `0..turnIndex`;
    - the merge runs over the whole scope, so one row per agent across turns.
  - **Ordering, row cap and "+N more":** per R5.11, using `SURFACE_LIMITS.maxTableRows`.
  - **Scalars:** computed over all rows in scope. `cost` is unavailable when any row's cost is unavailable.
  - **Context:**
    - tokens from R or M (M is undefined today), otherwise "unavailable";
    - percent only when the capacity predicate holds for the exact model, as `round(t/limit*1000)/10`;
    - cell text "50,000 · 25%" or "50,000";
    - accessible text "50,000 context tokens, 25 percent of the context window";
    - sort key = tokens, with unavailable last.
- **Verified contracts:**
  - `node.ts:158-199`;
  - `agent-monitor.store.ts:125-144,290-300,389-501,526-608`;
  - `session-live-stats.util.ts:77-101`;
  - `pricing.utils.ts:444-449`.
- **Dependencies:** shared only. `ContextCapacity` is a type import from `lib/utils/pricing.utils`.
- **Integration:** called by the resolver. Facts come from components 9 and 10.
- **Failure behaviour:**
  - A missing input means every value is "unavailable", not an invalid block.
  - Unknown statuses map to `pending`.
- **Quality:** O(rows), no allocation per tick beyond rows.
- **Verification seam:** `ptah-ui-agents-source.spec.ts` covers:
  - R5.9 (a)-(f);
  - R5.12 (a)-(h), where (e) passes no capacity, which proves the model-family window is never used;
  - R5.13 (all six bullets, including reload);
  - R5.2 mapping;
  - R5.3;
  - the R5.1 sentinel (facts are built by the real projection from sentinel-laden records in component 10's spec; this
    spec asserts no sentinel in any output string).
- **Files:**
  - CREATE `libs/shared/src/mcp-apps-contracts/ptah-ui-agents-source.ts`
  - CREATE `libs/shared/src/mcp-apps-contracts/ptah-ui-agents-source.spec.ts`

### 3. Renderer `/4` (declarative-dashboard)

- **Purpose:** render the `/4` kinds and container-relative layout in the DaisyUI theme, using the design's visual
  language.
- **Responsibilities:**
  - **Layout:**
    - `surface-layout` gains `accordion`: a header `<button>` with `aria-expanded`/`aria-controls`, Enter and Space,
      Escape to collapse and refocus, an `inert` and `visibility:hidden` body, closed by default, and expansion held in
      `viewState.components[id].expanded`.
    - Section collapse uses the same pattern, open by default.
    - Container grid and row per D9.
  - **Stat:** `dashboard-stat` adds the trend pill and the sparkline.
    - The pill shows an arrow glyph plus the text "up 4.2%" or "down 3". `good` means success, `bad` means error, none
      means neutral.
    - The sparkline is `role="img"` with a label listing the points. The latest bar is `primary`. A series flagged
      failing uses the error fill.
  - **Avatar:** `dashboard-avatar` shows initials from the name and a deterministic tone from a name hash over neutral,
    info, success and warning. It has no image or URL. The avatar is `aria-hidden`, and the name is text.
  - **Renderer root:** `layoutWidth` input, plus the `--dp-*` tokens and `dp-` classes (D17).
  - **View model and node switch:** include the new kinds.
- **Verified contracts:**
  - `surface-renderer.component.ts:32-42,152-159,172-188`
  - `surface-layout.component.ts:17-19,73-88,127-135`
  - `dashboard-stat.component.ts:18-66`
  - `surface-node.component.ts:67-72,148-229,313`
  - `view-model/surface-view-model.ts:25-27,245`
  - `view-model/view-model.types.ts:31-76`
  - `charts/chart-geometry.ts:18`
- **Dependencies:** `type:ui` → shared contracts (type and util) only. Lattice: `eslint.config.mjs:378-380`.
- **Integration:**
  - `ptah-ui-block` (inline, `layoutWidth="container"`);
  - the display panel;
  - the Apps page (unchanged default).
- **Failure behaviour:** an unknown kind still emits `renderFailed` (`surface-node.component.ts:313`). The block falls
  back to "could not display".
- **Quality:**
  - No timers.
  - Pulse animations only on `opacity`/`transform`, and none under reduced motion.
  - Theme tokens only.
- **Verification seam:**
  - `surface-layout.component.spec.ts`: accordion ARIA, keyboard, inert, default closed, and expansion surviving a
    re-render with the same view state.
  - `dashboard-stat.component.spec.ts`: pill text and arrow, polarity tones, sparkline label.
  - `dashboard-avatar.component.spec.ts`: initials, determinism, no `img`.
  - `surface-container-width.spec.ts`: the same surface in 300 px and 900 px host elements in one viewport gives
    different computed grid column counts. jsdom has no layout, so assert the container-mode class and computed
    `grid-template-columns` rule application through the component's style rules, and keep the visual review as the
    authoritative check (R3.5).
  - `trust-boundary.spec.ts`: text renders literally (R4.7).
- **Files:**
  - MODIFY `libs/frontend/declarative-dashboard/src/lib/components/surface-renderer.component.ts`
  - MODIFY `libs/frontend/declarative-dashboard/src/lib/components/surface-layout.component.ts`
  - MODIFY `libs/frontend/declarative-dashboard/src/lib/components/surface-node.component.ts`
  - MODIFY `libs/frontend/declarative-dashboard/src/lib/components/dashboard-stat.component.ts`
  - CREATE `libs/frontend/declarative-dashboard/src/lib/components/dashboard-avatar.component.ts`
  - CREATE `libs/frontend/declarative-dashboard/src/lib/components/dashboard-sparkline.component.ts`
  - CREATE `libs/frontend/declarative-dashboard/src/lib/charts/sparkline-geometry.ts`
  - MODIFY `libs/frontend/declarative-dashboard/src/lib/view-model/surface-view-model.ts`
  - MODIFY `libs/frontend/declarative-dashboard/src/lib/view-model/view-model.types.ts`
  - Specs: CREATE or MODIFY the five named above under `libs/frontend/declarative-dashboard/src/lib/components/`.
  - MODIFY `libs/frontend/declarative-dashboard/src/index.ts`, if a new export is needed.

### 4. Inline block and display chip (chat-ui `ptah-ui` entry)

- **Purpose:** inline rendering with live sources, plus the in-message display chip (R1.11, R2.6, R2.10).
- **Responsibilities:**
  - **`ptah-ui-block`:**
    - calls `compilePtahUiBlock` once per body;
    - computes the agents and limits inputs only for used sources, from `PTAH_UI_HOST_SOURCES` (component 9) and
      `PtahUiLaneLimitsSource` (component 4a);
    - passes `layoutWidth="container"`;
    - keeps the live window and snapshot rules.
  - **`ptah-ui-message-text`:**
    - a `display` segment renders `ptah-ui-display-chip`, keyed `ui:<ordinal>` as today;
    - an inline segment is unchanged.
  - **`ptah-ui-display-chip`:**
    - reads the fence status from `DisplayDockState` (injected optional), by `messageId:nodeId:ordinal`;
    - `applied` / `superseded` / `evicted`: a chip with title (or "Display"), the state text ("Updated later", "No
      longer in display") and an "Open in display" button that calls `dock.openSurface(tabId, surfaceKey)`;
    - `invalid`: the 610 fallback (raw fence as markdown plus `Not rendered: {reason}`, with `aria-describedby`);
    - no status yet: plain markdown of the raw fence;
    - collapsible per R9 (collapsed: one line; expanded: title, description, state);
    - the chip never runs the pipeline.
- **Verified contracts:** `ptah-ui-block.component.ts:41-44,59-90,113-156,200-271`; `ptah-ui-message-text.component.ts:40-98`.
- **Dependencies:**
  - chat-ui → shared contracts (lazy), declarative-dashboard and core;
  - chat-ui → chat-streaming (component 4a only), allowed by `eslint.config.mjs:364-372`.
- **Integration:** the transcript's `PTAH_UI_HOST_SOURCES` provider and the ChatView `DisplayDockState`.
- **Failure behaviour:**
  - Chunk failure: the existing `@error` markdown (`execution-node.component.ts:176-205`).
  - The dock store is absent (for example a host that hides the dock): the chip renders the "Open" action disabled with
    the text "Display panel unavailable".
- **Quality:** chip render is O(1). No timers.
- **Verification seam:**
  - `ptah-ui-display-chip.component.spec.ts`: each status, ARIA, Enter/Space/Escape, and copy text = raw fence only
    (R2.10).
  - `ptah-ui-block.component.spec.ts`:
    - compile once;
    - no agents read for a `$diff`-only block;
    - live `$agents` update without re-instantiation (instantiation counter = 1, R5.4).
- **Files:**
  - MODIFY `libs/frontend/chat-ui/src/lib/organisms/ptah-ui/ptah-ui-block.component.ts` (+ `.spec.ts`)
  - MODIFY `libs/frontend/chat-ui/src/lib/organisms/ptah-ui/ptah-ui-message-text.component.ts` (+ `.spec.ts`)
  - CREATE `libs/frontend/chat-ui/src/lib/organisms/ptah-ui/ptah-ui-display-chip.component.ts` (+ `.spec.ts`)
  - MODIFY `libs/frontend/chat-ui/src/ptah-ui.ts`

### 4a. Live source adapters (chat-ui, lazy)

- **Purpose:** turn store and RPC data into allow-listed pipeline inputs.
- **Responsibilities:**
  - **`PtahUiAgentsSource`** (`@Injectable({providedIn:'root'})`, lazy because it is imported only from lazy code):
    - `agentsInput(hostSources, turnIndex): Signal<PtahUiAgentsInput>`.
    - Projects `AgentMonitorStore.subagents()`, filtered by `parentSessionId === sessionId`, into `SubagentFact`. Tokens
      are input + output, cost is `estimatedCostUsd` (null means unavailable), and context comes from
      `subagentUsageView(R, now).contextTokens`.
    - Projects `agentsOwnedBySession(sessionId)` into `CliLaneFact`. Tokens and cost come from `usageTotals`; null
      means unavailable.
    - The capacity list is `[liveModelStats.contextCapacity]` of the tab, when present.
    - Only allow-listed fields are copied.
  - **`PtahUiLaneLimitsSource`** (root, lazy):
    - `acquire(): Signal<PtahUiLimitsInput>` / `release()` with a reference count.
    - The first acquire calls `agent:getLanePlanLimits` with `{timeout: 10_000}`, single-flight.
    - The response is validated by a type guard at the boundary (exact keys, string cells, finite scalars).
    - While the count is above 0, an `effect` on `PlanLimitsStore.snapshot()` re-reads (R10.6).
    - On failure or timeout, the state is `{kind:'unavailable'}`.
    - It never reads on VS Code, because no block resolves there.
- **Verified contracts:**
  - `agent-monitor.store.ts:345,736,869`;
  - `plan-limits.store.ts:73-97`;
  - `claude-rpc.service.ts:129-135`;
  - `chat-types.ts:660-662`.
- **Dependencies:** chat-ui → chat-streaming, core, chat-state (all `scope:webview`, allowed).
- **Failure behaviour:**
  - An RPC error, a malformed payload or a timeout make the source unavailable. The block stays valid (R10.7).
  - Per-lane failures arrive as rows (R10.7, second bullet).
- **Quality:**
  - One RPC per acquire burst plus one per push.
  - The effect is released when the count reaches 0.
- **Verification seam:**
  - `ptah-ui-agents.source.spec.ts`: the R5.1 sentinel. Seed `task`, `description`, `agentPrompt`, `latestSummary`,
    `stdout`, `stderr`, `errorMessage` and `outputFile` with a sentinel. Assert it appears in no fact field, no resolved
    value, no rendered DOM text and no accessible name. The last two use a rendered `ptah-ui-block`.
  - `ptah-ui-lane-limits.source.spec.ts`:
    - no call without acquire (R10.1);
    - one call for two acquires;
    - re-read on a `snapshot` change;
    - timeout and malformed payload → unavailable;
    - the R10.4 sentinel: a webview-side guard rejects extra keys.
- **Files:**
  - CREATE `libs/frontend/chat-ui/src/lib/organisms/ptah-ui/sources/ptah-ui-agents.source.ts` (+ `.spec.ts`)
  - CREATE `libs/frontend/chat-ui/src/lib/organisms/ptah-ui/sources/ptah-ui-lane-limits.source.ts` (+ `.spec.ts`)

### 5. Display panel, surface sync and turn summary cards (chat-ui `display-panel` entry)

- **Purpose:** compute panel surfaces deterministically and render the Displays tabpanel and the turn summary.
- **Responsibilities:**
  - **`buildDisplaySurfaces(candidates, compile, resolve, previous)`** (pure, in `display-surfaces.ts`):
    - R2.8 order;
    - D11 keys, reserved ids and cap;
    - per-fence status (`applied | superseded | evicted | invalid(reason)`);
    - D10 view-state pruning input.
  - **`ptah-display-surface-sync`** (headless, one per transcript):
    - inputs `tabId`, `candidates`, `snapshots` (`ptahUiSnapshots`), `hostSources`;
    - computes through the pure function;
    - writes the result to `DisplayDockState.setSurfaces(tabId, …)`;
    - applies D12 auto-open.
  - **`ptah-display-panel`** (the Displays tabpanel body):
    - the display strip (`role="tablist"`, pills, roving tabindex, automatic activation, Home/End, a "new" text dot);
    - the body with the turn summary section first;
    - `ptah-surface-renderer [layoutWidth]="'container'"` per surface, with `viewState` and `viewStateChange` bound to
      the dock store;
    - read-only interaction (610 `READ_ONLY_INTERACTION`, R2.12);
    - the empty state "Nothing to show yet" with one explanatory sentence (R1.13);
    - when unpinned, scroll the most recently created or updated surface into view; when pinned, never move scroll or
      focus (R1.6).
  - **`ptah-turn-summary`:**
    - six stat cards (R6.1) in a container grid: 1 column at < 400 px, 2 at 400-699 px, 3 at ≥ 700 px;
    - an expanded card spans the row;
    - omit Files and Tests when there is nothing to show (R6.4);
    - the R6.3 state pills;
    - the Files detail with the full parity rows (status letter with accessible name, rename origin, counts or `?` or
      `binary`, Open file, Review, Resolve, Review all, 50 per page, "+N more files not listed", the reconciled
      `<details>` group, an inline `role="alert"` action error);
    - the Tests detail (parity section 1 rows);
    - a conflict forces Files open (parity);
    - outputs `openFile(path)`, `review()`, `openScm()`, handled by the dock (component 8);
    - input `actionError`.
- **Verified contracts:**
  - `surface-renderer.component.ts:172-180`;
  - `surface-view-state.ts:11-27`;
  - `turn-sources.utils.ts:12-43`;
  - `change-set-card.component.ts:126-422` (the parity source for each Files row);
  - `turn-tests-row.component.ts:75-224` (the parity source for each Tests row).
- **Dependencies:** chat-ui → declarative-dashboard, shared contracts, and the `turn-recap` entry (the summary model).
- **Integration:**
  - the dock (chat) mounts `ptah-display-panel` in its deferred body;
  - the transcript mounts `ptah-display-surface-sync` under `@defer (when displayCandidates().length > 0)`, on
    Electron only.
- **Failure behaviour:**
  - A candidate whose pipeline fails gets status `invalid`. The panel is unchanged for its id (R2.6).
  - `renderFailed` from the renderer shows "could not display" in that surface's card only.
- **Quality:**
  - At most `maxSurfacesPerRoutingId` agent surfaces render, all live.
  - A recompute reuses the compile cache keyed by fence body.
  - No per-surface timers or observers.
- **Verification seam:**
  - `display-surfaces.spec.ts`:
    - R1.12 boundary specs (8 ids; 9th id; 9th reusing an id);
    - R2.3 (fresh render equals the updated one);
    - R2.4 (one stat changes, and the expanded accordion elsewhere stays expanded);
    - R2.5 reserved id;
    - R2.6 invalid update keeps the previous content;
    - R2.8 ordering across messages, nodes and ordinals;
    - R2.9 rebuild equality.
  - `display-surface-sync.component.spec.ts`: the R1.8 sequence (open, user close, second block same turn → still
    closed and `newCount` = 1; next turn's block opens), R1.9 (replay candidates never open), R1.10, and focus not moved
    (R1.7).
  - `display-panel.component.spec.ts`: tablist assertions 6-9 (design section 8), pin scroll rule, empty state, axe.
  - `turn-summary.component.spec.ts`:
    - every parity section 1 and 2 row;
    - the ported tests-row cases (labels, incomplete, run rows, `<details>` full command, failure lines);
    - R6.3 states;
    - R6.4 omission;
    - R6.8 actions emit;
    - R9.6 column classes at 300 and 960;
    - the "unavailable, never $0" cost rule.
- **Files:**
  - CREATE `libs/frontend/chat-ui/src/display-panel.ts`
  - CREATE `libs/frontend/chat-ui/src/lib/organisms/display-panel/display-surfaces.ts` (+ `.spec.ts`)
  - CREATE `libs/frontend/chat-ui/src/lib/organisms/display-panel/display-surface-sync.component.ts` (+ `.spec.ts`)
  - CREATE `libs/frontend/chat-ui/src/lib/organisms/display-panel/display-panel.component.ts` (+ `.spec.ts`)
  - CREATE `libs/frontend/chat-ui/src/lib/organisms/display-panel/turn-summary.component.ts` (+ `.spec.ts`)
  - MODIFY `tsconfig.base.json` (path `@ptah-extension/chat-ui/display-panel` → `libs/frontend/chat-ui/src/display-panel.ts`)

### 6. Turn summary model and chip (chat-ui `turn-recap` entry)

- **Purpose:** a host-built per-turn summary with zero model tokens (R6.1, R6.5, R6.7, R6.10). The chip replaces the
  Electron card and tests row.
- **Responsibilities:**
  - **`buildTurnSummaryModel(snapshot, marks)`** (pure):
    - `null` unless the snapshot is terminal and the turn changed files or ran a test command (R6.4);
    - otherwise cards with the same values `$diff`, `$tests` and `$usage` resolve to;
    - the state flags.
  - **`ptah-turn-summary-chip`:**
    - collapsed: one line with icon, "Turn summary" and metric pills such as "3 files · +42 −7 · 2 tests passed",
      wrapping at `chat-narrow` (R9.6);
    - expanded: mini cards and "Open in panel";
    - output `open`;
    - no file list (R6.9).
- **Verified contracts:** `turn-sources.utils.ts:12-43,118`; `change-set.store.ts:53-58` (`ChangeSetMarks`, passed in as
  plain data).
- **Dependencies:** shared utils and chat-ui atoms. It does not import the renderer (D14).
- **Integration:** the transcript mounts the chip (component 7). The panel summary imports the model.
- **Failure behaviour:** the snapshot is pending or unavailable → no chip, or values "unavailable".
- **Verification seam:**
  - `turn-summary.model.spec.ts`: values equal the resolver's for the same snapshot, the R6.3 flags, and R6.4.
  - `turn-summary-chip.component.spec.ts`: text includes the test outcome (R6.10), ARIA and collapse (R9), and no file
    list.
  - The R6.7 sentinel: extend the 610 no-write-back fixture through the model (see component 12).
- **Files:**
  - CREATE `libs/frontend/chat-ui/src/lib/molecules/turn-recap/turn-summary.model.ts` (+ `.spec.ts`)
  - CREATE `libs/frontend/chat-ui/src/lib/molecules/turn-recap/turn-summary-chip.component.ts` (+ `.spec.ts`)
  - MODIFY `libs/frontend/chat-ui/src/turn-recap.ts`
  - DELETE `libs/frontend/chat-ui/src/lib/molecules/turn-recap/turn-tests-row.component.ts` (+ `.spec.ts`) (D16)

### 7. Transcript wiring (chat, eager plus deferred mounts)

- **Purpose:** publish the per-tab projections and mount the Electron chip and sync.
- **Responsibilities:**
  - **`collectDisplayCandidates(messages, streamingBoundary)`** (pure, zero contracts import):
    - top-level assistant text nodes reachable through `message` nodes only (R2.11, the same rule as
      `execution-node.component.ts:356`);
    - only those whose text passes `hasPtahUiDisplayFenceLine`;
    - per-node identity cache keyed by `(text length, text)`.
  - **`collectTurnAgentFacts(messages, streamingBoundary)`** (pure): `TurnAgentFacts[]` per D7, copying only the
    allow-listed fields.
  - **`ChatTranscriptComponent`:**
    - provides `PTAH_UI_HOST_SOURCES` (component 9);
    - Electron only:
      - publishes candidates and turn summaries to `DisplayDockState` (injected optional);
      - mounts `ptah-turn-summary-chip` at the turn-end slot under `@defer (when summary)` and removes the
        `ptah-change-set-card` and `ptah-turn-tests-row` mounts;
      - the chip `open` calls `dock.openSummary(tabId, turnKey)`;
      - mounts `ptah-display-surface-sync` under `@defer`.
    - VS Code: the change-set card is unchanged, and there is no chip.
- **Verified contracts:**
  - `chat-transcript.component.html:46-116`;
  - `chat-transcript.component.ts:185-187,235-257,387-389,549-629,650-664,712-714`;
  - `transcript-turns.ts:85-126`;
  - `transcript-turn-snapshots.ts:168-214`.
- **Dependencies:** chat → chat-ui (main barrel for the token; lazy entries only inside `@defer`).
- **Failure behaviour:**
  - No dock store (a host with `HIDE_AGENT_SIDEBAR`): publishing is a no-op. The chips show the unavailable state.
  - A deferred chunk error: chip absent, transcript intact.
- **Verification seam:**
  - `transcript-display-candidates.spec.ts`: scope (user, subagent, thinking, `agent` subtree excluded), order, live
    flag, identity cache.
  - `transcript-agent-facts.spec.ts`: D7, and the R5.1 sentinel on N `agentPrompt` / `agentDescription` /
    `summaryContent`.
  - `chat-transcript.display.spec.ts`:
    - R6.5 and R6.10 for both runtimes: Electron has no `ptah-change-set-card` and no `chat-turn-tests`, and the chip
      text has the outcome; VS Code output is unchanged;
    - R1.14: VS Code has no chip and no sync;
    - R6.4: no chip for a turn without files or tests.
- **Files:**
  - CREATE `libs/frontend/chat/src/lib/components/organisms/transcript/transcript-display-candidates.ts` (+ `.spec.ts`)
  - CREATE `libs/frontend/chat/src/lib/components/organisms/transcript/transcript-agent-facts.ts` (+ `.spec.ts`)
  - CREATE `libs/frontend/chat/src/lib/components/organisms/transcript/transcript-ptah-ui-host-sources.ts`
  - MODIFY `libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.component.ts`
  - MODIFY `libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.component.html`
  - CREATE `libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.display.spec.ts`
  - MODIFY `libs/frontend/chat/src/lib/components/organisms/execution/ptah-ui-fence-line.ts` (adds
    `hasPtahUiDisplayFenceLine`; `hasPtahUiFenceLine` also matches the display openers) (+ its spec)

### 8. Dock (chat), dock state and toggle

- **Purpose:** the per-tab right-side dock with `Displays | Agents` tabs. It replaces the standalone monitor mount
  (R1, design section 2).
- **Responsibilities:**
  - **`DisplayDockState`** (ChatView-provided) — per-tab API (D4):
    - `open`, `close` (user), `toggle`, `pin`, `selectTab`;
    - `openSurface(surfaceKey)`, `openSummary(turnKey)`;
    - `requestAutoOpen(turnKey, key)`, `requestAgentsOpen()`;
    - `setCandidates`, `setSurfaces`, `setSummaries`, `setViewState`, `setWidth`.
    - Close during a turn records `userClosedTurnKey`. Closing a pinned dock unpins it.
    - The store holds no timers.
  - **`ptah-display-dock`** (deferred):
    - header: segmented tablist "Displays (n)" / "Agents (n)" with a visually hidden "New:" prefix, pin
      (`aria-pressed`) and close;
    - two `role="tabpanel"` elements, always present:
      - the Displays tabpanel hosts `ptah-display-panel` (lazy);
      - the Agents tabpanel hosts `ptah-agent-monitor-panel [docked]="true"`, whose empty state reads "No agents in
        this session";
    - handles the summary actions through `ChangeSetActionsService`, with marks from `ChangeSetStore.marksFor` and the
      same inline error text as today (R6.8).
  - **`ChatViewComponent`:**
    - provides `DisplayDockState`;
    - mounts the toggle (`ptah-sidebar-tab label="Display"` with `newCount`), the separator (pointer plus arrows ±16 px,
      Home/End, Enter or double-click reset to 400 px, `aria-valuenow/min/max/text`, clamped by `PanelResizeService`),
      and `@defer (when dockOpen())` for the dock;
    - per-tab width is restored on tab switch;
    - the overlay below 600 px uses the existing `isOverlay` rule, so there is at most one overlay;
    - Escape and focus return reuse `onEscapeKey` and the existing `afterRenderEffect`;
    - the agent auto-open effect calls `dock.requestAgentsOpen()` with the per-tab user-closed rule;
    - `HIDE_AGENT_SIDEBAR` hides the toggle and the dock as today.
  - **`ptah-sidebar-tab`:** optional `newCount` input. It shows the text badge "1 new", with accessible name
    "Toggle Display panel, 1 new" (R1.8).
  - **`ptah-agent-monitor-panel`:** `docked` input. When set, it fills the parent, hides its own close button (the dock
    owns close) and uses the empty copy "No agents in this session".
- **Verified contracts:**
  - `chat-view.component.html:263-299`;
  - `chat-view.component.ts:171,180-187,211-218,383-391,440-502,519-585,650-664,1103-1115,1163-1211`;
  - `panel-resize.service.ts:21-54`;
  - `agent-monitor-panel.component.ts:213-225,598-659,1229-1235`;
  - `sidebar-tab.component.ts:56,98-113`;
  - `change-set-actions.service.ts:69-125`.
- **Dependencies:**
  - chat → chat-ui (`display-panel` entry inside the deferred dock only);
  - chat → core;
  - chat → chat-streaming (existing).
- **Integration:**
  - the transcript publishes into the store;
  - the chips call `openSurface` and `openSummary`;
  - the monitor panel content is unchanged apart from `docked`.
- **Failure behaviour:**
  - A dock chunk error shows a one-line `role="alert"` "Display panel failed to load" in the dock slot.
  - Separator values clamp.
  - Escape in a non-overlay dock does nothing (as today).
- **Quality:**
  - The `ResizeObserver` already exists; nothing new is added per item.
  - Pulse rings run only on `transform` and `opacity`, with a finite 2-pulse animation (design section 2) and reduced
    motion respected.
- **Verification seam:**
  - `display-dock.state.spec.ts`: per-tab isolation (R1.1), user-close rule, pin and unpin on close (R1.6), width per
    tab (R1.5), `seenBlockKeys`.
  - `display-dock.component.spec.ts`:
    - tablists (design assertions 6-9);
    - the Agents tabpanel present with no agents, labelled by its tab, containing "No agents in this session" (R1.13,
      decisions.md #11);
    - pin and close `aria`;
    - axe.
  - `chat-view.dock.spec.ts`:
    - toggle open and close, keyboard (R1.4);
    - separator keys and clamps (design assertions 10-11, R1.5);
    - overlay below 600 px with Escape and focus return (R1.2);
    - auto-open does not move focus (R1.7);
    - **R1.3, both panels open:**
      - With agents running and a display surface present, open the dock and select each tab in turn. The ChatView
        template has exactly one right-side panel element: one `ptah-display-dock`, and no `ptah-agent-monitor-panel`
        outside the dock's Agents tabpanel.
      - Exactly one tabpanel is visible.
      - The chat column's width is never reduced by more than one panel width. With the host width stubbed
        (`_hostWidth`) at 1280 px and the dock at 300 px, the chat column's computed inline width is the host width
        minus 300, whichever tab is selected. This is the same as the monitor-only layout today.
      - At host widths below `AGENT_PANEL_OVERLAY_BREAKPOINT`, `isOverlay()` is true and the dock is the single overlay
        (R1.2).
      - Design section 2's arithmetic (300 + 300 + chat < 600 at 1280 px) cannot arise, because the second panel does
        not exist;
    - tab switch shows that tab's state and never auto-opens (R1.1, R1.9);
    - VS Code: no toggle or dock (R1.14).
- **Files:**
  - CREATE `libs/frontend/chat/src/lib/services/display-dock/display-dock.state.ts` (+ `.spec.ts`)
  - CREATE `libs/frontend/chat/src/lib/components/organisms/display-dock/display-dock.component.ts` (+ `.spec.ts`)
  - MODIFY `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts`
  - MODIFY `libs/frontend/chat/src/lib/components/templates/chat-view.component.html`
  - CREATE `libs/frontend/chat/src/lib/components/templates/chat-view.dock.spec.ts`
  - MODIFY `libs/frontend/chat/src/lib/components/organisms/agent-monitor-panel.component.ts`
  - MODIFY `libs/frontend/chat-ui/src/lib/atoms/sidebar-tab.component.ts`

### 9. Host-sources token (chat-ui main barrel, eager-light)

- **Purpose:** let lazy chat-ui code read per-tab live facts that the transcript owns, without chat-ui importing chat.
- **Responsibilities:**
  - `PTAH_UI_HOST_SOURCES = new InjectionToken<PtahUiHostSources>('PTAH_UI_HOST_SOURCES')`.
  - `PtahUiHostSources` = `{ tabId: Signal<string>; sessionId: Signal<string|null>; turnFacts: Signal<readonly
    TurnAgentFacts[]>; turnIndexOf(messageId): number | null; capacities: Signal<readonly ContextCapacity[]> }`.
  - Types are imported type-only.
  - The implementation is `transcript-ptah-ui-host-sources.ts` (component 7), provided in the transcript's providers.
- **Verified contracts:** the `PTAH_UI_BLOCK_PIPELINE` token precedent (`ptah-ui-block.component.ts:41-44`); transcript
  providers (`chat-transcript.component.ts:187`).
- **Failure behaviour:** the token is optional in consumers. When it is absent, `agents` input = null → "unavailable".
- **Verification seam:** covered by the component 4 and 7 specs.
- **Files:**
  - CREATE `libs/frontend/chat-ui/src/lib/services/ptah-ui-host-sources.ts`
  - MODIFY `libs/frontend/chat-ui/src/index.ts`

### 10. Lane plan-limit read (R10.1-R10.4, backend and shared)

- **Purpose:** an Electron-only, read-only RPC that returns list-identical plan-limit rows with no identity.
- **Responsibilities:**
  - **Shared types** (new `rpc/rpc-lane-plan-limits.types.ts`):

    ```ts
    export type AgentGetLanePlanLimitsParams = Record<string, never>;
    export interface AgentLanePlanLimitRow { readonly lane: string; readonly window: string; readonly used: string; readonly state: string; readonly reset: string; }
    export interface AgentGetLanePlanLimitsResult { readonly rows: readonly AgentLanePlanLimitRow[]; readonly lanes: number; readonly atLimit: number; readonly nearLimit: number; readonly unknown: number; readonly asOf: number; }
    ```

    The registry entry `'agent:getLanePlanLimits'` and `RPC_METHOD_ENTRIES` change in `rpc.types.ts` (`:750`, `:3723`).
  - **Formatter:** export `formatPlanLimitRows(limits, now): string[][]`. This is the existing private `planLimitRows`
    applied over the list. `formatPlanLimitsSection` calls it. Export it from the `vscode-lm-tools` barrel.
  - **Handler `LanePlanLimitsRpcHandlers`:**
    - `METHODS = ['agent:getLanePlanLimits']`;
    - params validated by `LanePlanLimitsSchema = z.object({}).strict()` (`boot-rpc.schema.ts` pattern);
    - `const api = builder.build()` (A1), then `rows = await api.agent.list()`, then `limits = await
      api.agent.limits?.(rows)`;
    - `undefined` limits → throw `RpcUserError('Lane plan limits are unavailable on this host')`;
    - `now = Date.now()`;
    - `rows = formatPlanLimitRows(limits, now).map(cells => ({lane: cells[0], window: cells[1], used: cells[2], state:
      cells[3], reset: cells[4]}))`;
    - scalars over `limits` by `state.state`: `at-limit` → atLimit, `near-limit` → nearLimit, neither of those nor
      `confirmed-room` → unknown;
    - `lanes = limits.length`, `asOf = now`;
    - the response is constructed field by field. No spread from any snapshot.
  - **Manifest entry** `{ key: 'lanePlanLimits', methods: LanePlanLimitsRpcHandlers.METHODS, requires:
    ['lanePlanLimits'], handler: LanePlanLimitsRpcHandlers }`. The capability is added to `RPC_CAPABILITIES`. Electron
    profile `lanePlanLimits: true`. The VS Code and CLI expected-absent lists add it.
- **Verified contracts:** see the evidence table "Backend (R10)".
- **Dependencies:**
  - rpc-handlers → vscode-lm-tools and vscode-core (existing directions, `scope:extension`);
  - shared types only in shared.
- **Integration:** the webview `PtahUiLaneLimitsSource` (component 4a).
- **Failure behaviour:**
  - The lookup itself never rejects. Per-lane failures and timeouts are rows (`agent-namespace.builder.ts:499-518`).
  - A thrown `list` or an unavailable lookup is an RPC error. The webview renders "unavailable" (R10.7).
- **Quality:**
  - One lookup per call, with the 3 s lookup deadline (`lane-limit-lookup.service.ts:134-141`).
  - No `refresh` (R10.1).
- **Verification seam:**
  - `rpc-lane-plan-limits.contract.spec.ts` (shared): the key sets of `AgentGetLanePlanLimitsResult` and of a row equal
    exactly the R10.1 list. This is a runtime check over a typed fixture, plus a compile-time `Exact<>` helper.
  - `agent-limit.formatter.spec.ts`: `formatPlanLimitRows` first five cells per case equal the parsed
    `formatPlanLimitsSection` row cells for every R10.2 case. The existing specs and `formatAgentList` specs pass
    unchanged.
  - `lane-plan-limits-rpc.handlers.spec.ts`:
    - R10.10's three lanes → four rows, `lanes` 3, atLimit 1, nearLimit 1, unknown 1;
    - the R10.4 sentinel (`owner.key`, `owner.label`, `account.planType`, `cliSessionId`, Ptah CLI `providerId`, an
      email-shaped string) is absent from `JSON.stringify(response)`;
    - an unavailable lookup → error;
    - params with any key → rejected;
    - **no refresh, no lane** (decisions.md #18):
      - The fake `PtahAPI.agent` is a recording `Proxy`. It asserts that only `list` and `limits` are ever read.
        `spawn`, `stop`, `continue`, `steer` and any session method are never accessed.
      - `limits` is called with exactly one argument (the rows), with no options object and no `refresh` key.
      - `JSON.stringify` of every call argument contains no `"refresh"`.
  - `lane-limit-lookup.service.spec.ts` (cli-agent-runtime, added case): `lookup()` calls
    `snapshots.getOwnerSnapshot(target, options)` with an options object whose keys are a subset of `['signal']`. It
    never contains `refresh` (`lane-limit-lookup.service.ts:186`). This pins the "never forces refresh" half below the
    handler.
  - `apps/ptah-electron/src/di/container.smoke.spec.ts`, describe "shared RPC handler resolution" (`:219-248`): add
    `LanePlanLimitsRpcHandlers`. It resolves from the Electron container, and `PLATFORM_TOKENS.HOST_KIND` is
    `'electron'` (same file `:250-276`).
  - `apps/ptah-electron/src/di/rpc-surface.spec.ts:37-42`: "serves every method in the RPC registry" now includes
    `agent:getLanePlanLimits` with no edit.
  - `libs/backend/cli-engine/src/lib/rpc/rpc-surface.spec.ts` and `apps/ptah-extension-vscode/src/di/container.smoke.spec.ts`:
    the method is excluded on those hosts (A5).
  - `resolve-handler-plan.spec.ts` (existing): the manifest invariants still hold. VS Code has no `agent:getLanePlanLimits`.
  - `host-source-registry.contract.spec.ts`: passes unchanged, because the name does not match the pattern.
- **Files:**
  - CREATE `libs/shared/src/lib/types/rpc/rpc-lane-plan-limits.types.ts`
  - CREATE `libs/shared/src/lib/types/rpc/rpc-lane-plan-limits.contract.spec.ts`
  - MODIFY `libs/shared/src/lib/types/rpc.types.ts`
  - MODIFY `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/agent-limit.formatter.ts`
  - MODIFY `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/agent-limit.formatter.spec.ts`
  - MODIFY `libs/backend/vscode-lm-tools/src/index.ts`
  - CREATE `libs/backend/rpc-handlers/src/lib/handlers/lane-plan-limits-rpc.handlers.ts` (+ `.spec.ts`)
  - CREATE `libs/backend/rpc-handlers/src/lib/handlers/lane-plan-limits-rpc.schema.ts`
  - MODIFY `libs/backend/rpc-handlers/src/lib/handlers/index.ts`
  - MODIFY `libs/backend/rpc-handlers/src/lib/host-profile/manifest.ts`
  - MODIFY `libs/backend/rpc-handlers/src/lib/host-profile/capabilities.ts`
  - MODIFY `libs/backend/rpc-handlers/src/index.ts`
  - MODIFY `apps/ptah-electron/src/rpc-host-profile.ts`
  - MODIFY `apps/ptah-extension-vscode/src/di/expected-absent.ts`
  - MODIFY `libs/backend/cli-engine/src/lib/rpc/expected-absent.ts`
  - MODIFY `libs/backend/cli-agent-runtime/src/lib/cli-agents/limits/lane-limit-lookup.service.spec.ts`. Locate it with
    Glob. If it does not exist, CREATE it with the one case.
  - MODIFY `apps/ptah-electron/src/di/container.smoke.spec.ts`

### 11. Command and file previews (R7, both webviews)

- **Purpose:** polish with full parity (parity-inventory section 4).
- **Responsibilities:**
  - **Header:**
    - the toggle `<button>` and a sibling open-file button (28 px, accessible name "Open <file>"), so buttons do not
      nest;
    - for file tools: file name 600 and muted directory, full path in `title`, and a language label from
      `tool-language.utils`;
    - for Bash: an outcome pill with text "succeeded", "failed" or "running" and an icon with an accessible name (A9);
    - the existing badges, streaming description, parse warning and duration are kept.
  - **Bash body:** the command row (`$`, mono, wraps when expanded, `title` holds the full text) plus
    `ptah-copy-text-button` with label "Copy command".
  - **`code-output`:** keeps ANSI, reminder and line-number stripping. Height-limited to 9.6em with a fade, a "Show full
    output" / "Show less" toggle (`aria-expanded`), and "Copy output". The block is focusable with an aria-label.
  - **`tool-input-display`:** the Bash `command` and Write `content` are not truncated to 60 characters (R7.2, R7.7).
    Other parameters keep the 60-character rule.
  - **`diff-display`:** a sign gutter (`+`/`−` glyph with aria-label "added"/"removed") and a row tint. The header shows
    removed and added counts plus replacements (R7.6). Lines wrap. The old-then-new order is kept (parity).
  - Write: highlighted preview, height-limited, "Show all N lines" (R7.7).
  - Everything is collapsible with Escape (R9.1). A pending permission still forces the item open.
  - The stale "chat-ui is type:ui" comments at `tool-input-display.component.ts:153-155` and
    `tool-output-display.component.ts:92-94` are corrected.
- **Verified contracts:**
  - `tool-call-item.component.ts:67-148`;
  - `tool-call-header.component.ts:64-161,199-313,327-351`;
  - `tool-input-display.component.ts:44-341`;
  - `tool-output-display.component.ts:48-143`;
  - `code-output.component.ts:44-202`;
  - `diff-display.component.ts:45-163`;
  - `tool-target.utils.ts:31-57`;
  - `file-path-link.component.ts:54-86`;
  - `FILE_LINK_OPENER` at `libs/frontend/core/src/lib/tokens/file-link-opener.token.ts:40`.
- **Dependencies:** chat-ui atoms and molecules; chat `tool-call-item`.
- **Failure behaviour:**
  - A clipboard rejection shows "Copy failed" in the live region and does not throw.
  - An open-file rejection is logged, as today (`file-path-link.component.ts:76-86`).
- **Quality:**
  - The collapsed row height is at most the design's 36 px, which R7.9 permits, checked in step V1.
  - No horizontal scroll.
- **Verification seam:**
  - `tool-call-header.component.spec.ts` (new, R7.1): every parity section 4 header row, outcome text and names, sibling
    open button, language label.
  - The existing input, output, code-output, diff and fence specs are extended.
  - `tool-language.utils.spec.ts` and `copy-text-button.component.spec.ts`.
  - `tool-call-item.component.spec.ts`: permission auto-expand kept, Escape collapses.
  - Host configuration: specs that branch on the host run with `isElectron` true and false (R7.10). File-open goes
    through `FILE_LINK_OPENER` in both.
- **Files:**
  - CREATE `libs/frontend/chat-ui/src/lib/utils/tool-language.utils.ts` (+ `.spec.ts`)
  - CREATE `libs/frontend/chat-ui/src/lib/atoms/copy-text-button.component.ts` (+ `.spec.ts`)
  - MODIFY `libs/frontend/chat-ui/src/lib/molecules/tool-execution/tool-call-header.component.ts`
  - CREATE `libs/frontend/chat-ui/src/lib/molecules/tool-execution/tool-call-header.component.spec.ts`
  - MODIFY `libs/frontend/chat-ui/src/lib/molecules/tool-execution/code-output.component.ts` (+ `.spec.ts`)
  - MODIFY `libs/frontend/chat-ui/src/lib/molecules/tool-execution/diff-display.component.ts` (+ `.spec.ts`)
  - MODIFY `libs/frontend/chat-ui/src/lib/molecules/tool-execution/tool-input-display.component.ts` (+ `.spec.ts`)
  - MODIFY `libs/frontend/chat-ui/src/lib/molecules/tool-execution/tool-output-display.component.ts` (+ `.spec.ts`)
  - MODIFY `libs/frontend/chat-ui/src/index.ts` (export the copy atom and the util, if used by chat)
  - MODIFY `libs/frontend/chat/src/lib/components/molecules/tool-execution/tool-call-item.component.ts` (+ `.spec.ts`)

### 12. Hint, skill, measurements and boundary fixtures (R8, NFR)

- **Purpose:** teach the agent the new grammar without a larger default prompt. Prove compactness and no write-back.
- **Responsibilities:**
  - **`PTAH_UI_HINT`:** names `display [id]` and the id-update rule, lists `$diff $tests $usage $agents $limits`, and
    points to the skill. It stays ≤ 100 tokens. If it is over, drop `$limits` first and record both counts (R8.1). The
    gate is unchanged.
  - **Skill:** both copies. `references/ptah-ui.md` gets:
    - the R3 EBNF and lexical delta, the display and id rules;
    - `$agents` (with `context`, the "unavailable" and no-percent rules, `session`, and the note that CLI context is
      unavailable today);
    - `$limits`;
    - worked examples: subagent-usage dashboard, id update, and "a list of CLI tools with the usage and context stats";
    - a "Common mistakes" entry for `session` and indentation.

    `references/catalog.md` gets the `/4` kinds. `SKILL.md` lists the sources. Every example is a corpus case
    (component 2).
  - **`content-manifest.json`:** regenerated with `npm run manifest:generate`.
  - **`measurement.md`** (this task folder):
    - the hint text, characters and tokens;
    - the corpus fence vs JSON counts (R8.4) and fence vs markdown (R8.5);
    - the coding `tools/list` parity (NFR 5.10);
    - the Apps `tools/list` delta (A8);
    - the eager-closure report against the merge base.
  - **No-write-back fixtures:** extend the 610 `message-sender.host-data.spec.ts` and
    `sdk-query-options-builder.host-data.spec.ts` with:
    - an `$agents` sentinel name and cost `0.623623` (R5.8);
    - a `$limits` sentinel lane and used value `62.3623%` (R10.5);
    - the summary (R6.7).
- **Verified contracts:** `ptah-ui-hint.ts:5`; `ptah-ui-hint.spec.ts:1-31`; `sdk-query-options-builder.ts:1776-1779`;
  `content-manifest.json:4,69-71`; `package.json:67-68`.
- **Failure behaviour:** not applicable (static text). The specs fail closed.
- **Verification seam:** `ptah-ui-hint.spec.ts` (≤ 100 tokens; contains `display`, `$agents`; the examples parse; no
  `/note/i`), the corpus specs, and the host-data specs.
- **Files:**
  - MODIFY `libs/backend/agent-sdk/src/lib/prompt-harness/ptah-ui-hint.ts` (+ `.spec.ts`)
  - MODIFY `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/ptah-surface-authoring/SKILL.md`
  - MODIFY `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/ptah-surface-authoring/references/ptah-ui.md`
  - MODIFY `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/ptah-surface-authoring/references/catalog.md`
  - MODIFY `.claude/skills/ptah-surface-authoring/SKILL.md`
  - MODIFY `.claude/skills/ptah-surface-authoring/references/ptah-ui.md`
  - MODIFY `.claude/skills/ptah-surface-authoring/references/catalog.md`
  - MODIFY `content-manifest.json`
  - CREATE `.ptah/specs/TASK_2026_623_3492/measurement.md`
  - MODIFY the two 610 host-data specs. Locate them with
    `Glob **/message-sender.host-data.spec.ts` and `**/sdk-query-options-builder.host-data.spec.ts`.

### 13. Eager-closure gate update

- **Purpose:** keep the panel, the renderer and the summary out of the initial chunk set (NFR lazy loading).
- **Responsibilities:**
  - `FORBIDDEN_EAGER_INPUTS` adds:
    - `libs/frontend/chat-ui/src/display-panel.ts`;
    - `libs/frontend/chat-ui/src/lib/organisms/display-panel/`;
    - `libs/frontend/chat/.*/organisms/display-dock/`.
  - `ALLOWED_EAGER_GROWTH_INPUTS` adds:
    - `transcript-display-candidates.ts`;
    - `transcript-agent-facts.ts`;
    - `transcript-ptah-ui-host-sources.ts`;
    - `display-dock.state.ts`;
    - `chat-ui/src/lib/services/ptah-ui-host-sources.ts`.
  - `turn-recap/` and `organisms/ptah-ui/` are already forbidden.
- **Verified contracts:** `scripts/eager-closure-gate.js:11-25,76,99-104`; `package.json:70`.
- **Failure behaviour:** the gate fails closed (610 convention).
- **Verification seam:**
  - `eager-closure-gate.spec.ts`: synthetic fixtures for the new patterns.
  - The real-build run is part of step V1 (decisions.md #17).
- **Files:**
  - MODIFY `scripts/eager-closure-gate.js`
  - MODIFY `apps/ptah-electron/src/config/eager-closure-gate.spec.ts`

## Integration architecture

### Data flow (Electron webview)

1. Streaming deltas update `vm().messages`. The transcript's computed values run three projections:
   - `collectDisplayCandidates` (string scan);
   - `collectTurnAgentFacts`;
   - the existing `ptahUiSnapshots`.
2. The transcript publishes candidates and summary inputs to `DisplayDockState[tabId]`. When candidates exist,
   `@defer` loads the `display-panel` chunk and mounts `ptah-display-surface-sync`.
3. The sync works through the candidates:
   - It segments them (closed fences only).
   - For each display fence in R2.8 order, it calls `compilePtahUiBlock` (cached by body), then resolve with the
     snapshot, `$agents` facts and `$limits` input, then validate.
   - It computes surfaces, statuses and the cap.
   - It writes the result to the store and applies the auto-open rule.
4. When the text node settles, the message text renders a display chip that reads the fence status from the store.
5. The dock (deferred, when open) renders:
   - the Displays tabpanel: the summary first, then the strip and surfaces with per-surface view state;
   - or the Agents tabpanel (the monitor).
6. `$limits`:
   - the first acquire calls `agent:getLanePlanLimits` (Electron capability);
   - the handler builds rows from `agent.list` and `agent.limits` through `formatPlanLimitRows`;
   - a `planLimits:changed` push changes `PlanLimitsStore.snapshot()`, which triggers a re-read while acquired.
7. At turn end, the turn-end snapshot becomes terminal. The summary model is built. The chip mounts at the turn end.
   "Open in panel" opens that summary.

### State and persistence

- `DisplayDockState` belongs to each ChatView and lives as long as it does. Nothing persists across restarts (Out of
  scope).
- Surfaces are recomputed from stored messages, so reload rebuilds them (R2.9). `$limits` re-reads with a new "as of"
  time (R10.6).

### External boundaries

- Agent fence text: the parser, the caps and the validator. That is the only trust boundary.
- Store records: an allow-list projection (D6).
- RPC params: strict zod. The RPC response is checked by a type guard in the webview.

### Failure and rollback

- An invalid block falls back atomically, and the previous surface is kept.
- A source failure makes values "unavailable".
- A chunk failure gives `@error` markdown, or the dock alert line.
- The RPC failing makes `$limits` "unavailable".
- None of these failures is reported to the agent (R2.6).

### Observability

- Reason lines are visible to the user under invalid blocks.
- The lane source logs RPC failures with `console.warn`, like `plan-limits.store.ts:180-190`, and never logs payloads.
- The handler logs through `TOKENS.LOGGER` without row contents.

## Architecture-level quality requirements

- **Functional:** R1-R10 acceptance criteria, mapped in the test map below.
- **Performance:**
  - one compile per fence body;
  - resolve reruns only for changed used sources;
  - inline live cap 8;
  - at most `maxSurfacesPerRoutingId` panel surfaces;
  - no timers per surface, block or row;
  - streaming after a closed fence does not re-apply it (same body → same compile cache entry, no status change).
- **Security:**
  - no agent HTML, URL, image or script;
  - the R5.1, R10.4 and 610 Req 5.12 sentinels pass;
  - the RPC response carries row text only.
- **Maintainability:**
  - one parser, one renderer, one source layer;
  - one plan-limit row implementation;
  - Nx lattice respected:
    - shared → shared;
    - declarative-dashboard → ui and util;
    - chat-ui → feature, ui, core and util (not chat);
    - chat → chat-ui;
    - rpc-handlers → vscode-lm-tools.
- **Testability:** every requirement has a named spec (map below). The visual review covers R3.5, R7.8, R7.9, R9 and
  the theme NFR.

### Requirement → test map

| Req | Spec(s) |
| --- | --- |
| R1.1, R1.5, R1.6, R1.8 | `display-dock.state.spec.ts`, `display-surface-sync.component.spec.ts` |
| R1.2, R1.3, R1.4, R1.7, R1.9, R1.14 | `chat-view.dock.spec.ts` (R1.3: one panel element, one visible tabpanel, chat width = host − one dock width; component 8, batch H4) |
| R1.11 | `ptah-ui-display-chip.component.spec.ts` |
| R1.12, R2.3-R2.6, R2.8, R2.9 | `display-surfaces.spec.ts` |
| R1.13 | `display-panel.component.spec.ts`, `display-dock.component.spec.ts` (Agents empty tabpanel) |
| R2.1, R2.7 | `ptah-ui-fence.spec.ts`, `transcript-display-candidates.spec.ts` |
| R2.10, R2.11 | `ptah-ui-display-chip.component.spec.ts`, `transcript-display-candidates.spec.ts` |
| R3.1-R3.4 | `ptah-ui-parser.spec.ts`, `ptah-ui-converter.spec.ts`, `ptah-ui-pipeline.spec.ts` |
| R3.5 | `surface-container-width.spec.ts` plus visual review |
| R4.1-R4.2 | `surface-validator.spec.ts` |
| R4.3-R4.8 | `dashboard-stat`, `dashboard-avatar`, `surface-layout` specs, `trust-boundary.spec.ts` |
| R5.1-R5.13 | `ptah-ui-agents-source.spec.ts`, `ptah-ui-agents.source.spec.ts`, `transcript-agent-facts.spec.ts`, host-data specs |
| R6.1-R6.4, R6.6, R6.8 | `turn-summary.model.spec.ts`, `turn-summary.component.spec.ts` |
| R6.5, R6.9, R6.10 | `chat-transcript.display.spec.ts`, `turn-summary-chip.component.spec.ts` |
| R6.7 | host-data specs |
| R7.1-R7.7, R7.10 | `tool-call-header`, `code-output`, `diff-display`, `tool-input-display`, `tool-output-display`, `tool-call-item` specs |
| R7.8, R7.9 | visual review |
| R8.1-R8.5 | `ptah-ui-hint.spec.ts`, `ptah-ui-compactness.spec.ts`, `ptah-ui-agents-compactness.spec.ts`, `measurement.md` |
| R9.1-R9.4 | each component spec (toggle ARIA, Enter, Space, Escape, inert, defaults) |
| R9.5-R9.6 | visual review width script (reuse the prototype `?check=1` assertion), plus `turn-summary` column spec |
| R10.1-R10.10 | `rpc-lane-plan-limits.contract.spec.ts`, `agent-limit.formatter.spec.ts` (formatter equivalence), `lane-plan-limits-rpc.handlers.spec.ts` (including no refresh, no lane, decisions.md #18), `lane-limit-lookup.service.spec.ts` (no `refresh`), `container.smoke.spec.ts` (Electron resolution), `rpc-surface.spec.ts` (Electron, CLI), `ptah-ui-lane-limits.source.spec.ts`, `ptah-ui-resolver.spec.ts`, `resolve-handler-plan.spec.ts` |
| NFR lazy | `eager-closure-gate.spec.ts` plus the real-build report (step V1, decisions.md #17) |

### Visual review (step V1, after the frontend batches; user-approved by decisions.md #17)

The visual-reviewer compares the running Electron webview with the approved prototype screenshots in
`prototype/screenshots/`:

- **Widths and themes:** `chat-narrow` 360, `chat-wide` 1024, `panel-narrow` 300, `panel-wide` 960, in dark and light.
- **States:** collapsed and expanded.
- **Screens:**
  - chat chips;
  - previews (Bash, Read, Write, Edit, in both the Electron and VS Code webviews, R7.8, R7.10);
  - summary;
  - states;
  - agents;
  - atoms;
  - dock;
  - empty;
  - the Agents empty tabpanel.
- **Checks:**
  - the width assertion for every R9 component (R9.5);
  - the collapsed-row height at most the design's 36 px (R7.9 permits the Gate 1.7 figure, so no merge-base launch is needed);
  - axe zero serious or critical findings.

## Open Questions for the User

None. Both revision-1 questions are answered:

- Launch and build permission: decisions.md #17, carried out as step V1.
- `$limits` reader semantics: decisions.md #18, R10.1 [rev 3.2], component 10.

## Team-leader handoff

- **Recommended executors:**
  - backend-developer: components 1, 2, 2a, 10, 12 (hint and fixtures) and 13. They are pure TypeScript, Node handlers
    and scripts.
  - frontend-developer: components 3-9 and 11. They are Angular.
  - technical-content-writer or backend-developer: the skill text in component 12. Every example must parse.
  - visual-reviewer: step V1, after the frontend batches (decisions.md #17).
- **Complexity:** HIGH. A normative nested grammar, a catalog bump with compatibility, a new per-tab UI surface with
  auto-open rules, two live sources with privacy rules, a new capability-gated RPC, and a redesign with parity across
  two webviews.
- **Dependencies and ordering (component level):**
  - 1 → 2 → 2a.
  - 1 → 3.
  - 2, 3 → 4, 4a → 5.
  - 6 is independent after 1.
  - 9 → 4a and 7.
  - 7 and 8 come after 5, 6 and 9.
  - 10 is independent of the webview until 4a consumes it. Its types are needed by 4a.
  - 11 is independent.
  - 12 comes after 2 (the examples parse) and after 10's name is fixed.
  - 13 comes last among the frontend work.
- **Parallel-safe work:**
  - {1, 10-shared-types} are file-disjoint (both in shared, but different files; run them sequentially if one lib per
    lane is required).
  - {11} parallel with {2, 3}.
  - {10 backend} parallel with all frontend work.
  - {12 skill text} parallel after 2.
- **Files affected:** the per-component file lists above. CREATE ≈ 45, MODIFY ≈ 55, DELETE 2, REWRITE 1.

### Batches (≤6 files and ≤2 libs each, specs counted; the team-leader may re-split)

| Batch | Executor | Files | Libs | Depends on |
| --- | --- | --- | --- | --- |
| S1 | backend | `surface-catalog.ts`, `surface.types.ts`, `surface.schemas.ts`, `surface.validator.ts`, `surface-validator.spec.ts` | shared | none |
| S2 | backend | `surface-text-fallback.ts`, `.spec.ts`, `surface.index.ts`, `surface-patch.ts` (A6), `surface-budgets.spec.ts` (A7) | shared | S1 |
| S3 | backend | `ptah-ui.types.ts`, `ptah-ui-fence.ts`, `ptah-ui-fence.spec.ts`, `ptah-ui-parser.ts`, `ptah-ui-parser.spec.ts` | shared | S1 |
| S4 | backend | `ptah-ui-converter.ts`, `.spec.ts`, `ptah-ui-agents-source.ts`, `.spec.ts` | shared | S3 |
| S5 | backend | `ptah-ui-resolver.ts`, `.spec.ts`, `ptah-ui-pipeline.ts`, `.spec.ts` | shared | S4 |
| S6 | backend | `ptah-ui.corpus.ts`, `ptah-ui-compactness.spec.ts`, `ptah-ui-agents-compactness.spec.ts` | shared | S5 |
| L1 | backend | `rpc-lane-plan-limits.types.ts`, `rpc-lane-plan-limits.contract.spec.ts`, `rpc.types.ts` | shared | none |
| L2 | backend | `agent-limit.formatter.ts`, `agent-limit.formatter.spec.ts`, `vscode-lm-tools/src/index.ts` | vscode-lm-tools | none |
| L3 | backend | `lane-plan-limits-rpc.handlers.ts`, `.spec.ts`, `lane-plan-limits-rpc.schema.ts`, `handlers/index.ts`, `host-profile/manifest.ts`, `host-profile/capabilities.ts` | rpc-handlers | L1, L2 |
| L3b | backend | `lane-limit-lookup.service.spec.ts` (no `refresh` case) | cli-agent-runtime | none |
| L4 | backend | `rpc-handlers/src/index.ts`, `apps/ptah-electron/src/rpc-host-profile.ts`, `apps/ptah-electron/src/di/container.smoke.spec.ts` | rpc-handlers, ptah-electron | L3 |
| L5 | backend | `apps/ptah-extension-vscode/src/di/expected-absent.ts`, `libs/backend/cli-engine/src/lib/rpc/expected-absent.ts` | ptah-extension-vscode, cli-engine | L3 |
| D1 | frontend | `view-model.types.ts`, `surface-view-model.ts`, `surface-node.component.ts`, `surface-layout.component.ts`, `surface-renderer.component.ts`, `surface-layout.component.spec.ts` | declarative-dashboard | S2 |
| D2 | frontend | `dashboard-stat.component.ts`, `dashboard-stat.component.spec.ts`, `dashboard-sparkline.component.ts`, `charts/sparkline-geometry.ts`, `dashboard-avatar.component.ts`, `dashboard-avatar.component.spec.ts` | declarative-dashboard | D1 |
| D3 | frontend | `surface-container-width.spec.ts`, `trust-boundary.spec.ts`, `declarative-dashboard/src/index.ts` | declarative-dashboard | D2 |
| C1 | frontend | `chat-ui/src/lib/services/ptah-ui-host-sources.ts`, `chat-ui/src/index.ts`, `ptah-ui-block.component.ts`, `ptah-ui-block.component.spec.ts` | chat-ui | S5, D1 |
| C2 | frontend | `sources/ptah-ui-agents.source.ts`, `.spec.ts`, `sources/ptah-ui-lane-limits.source.ts`, `.spec.ts` | chat-ui | C1, L1 |
| C3 | frontend | `ptah-ui-display-chip.component.ts`, `.spec.ts`, `ptah-ui-message-text.component.ts`, `.spec.ts`, `chat-ui/src/ptah-ui.ts` | chat-ui | C1 |
| C4 | frontend | `turn-recap/turn-summary.model.ts`, `.spec.ts`, `turn-summary-chip.component.ts`, `.spec.ts`, `chat-ui/src/turn-recap.ts` | chat-ui | S1 |
| C5 | frontend | `chat-ui/src/display-panel.ts`, `display-panel/display-surfaces.ts`, `.spec.ts`, `display-surface-sync.component.ts`, `.spec.ts`, `tsconfig.base.json` | chat-ui (+ root config) | C2, C3 |
| C6 | frontend | `display-panel.component.ts`, `.spec.ts`, `turn-summary.component.ts`, `.spec.ts` | chat-ui | C4, C5, D2 |
| H1 | frontend | `ptah-ui-fence-line.ts` (+ spec), `transcript-display-candidates.ts`, `.spec.ts`, `transcript-agent-facts.ts`, `.spec.ts` | chat | S3 (types only) |
| H2 | frontend | `display-dock.state.ts`, `.spec.ts`, `transcript-ptah-ui-host-sources.ts`, `chat-ui/.../atoms/sidebar-tab.component.ts` | chat, chat-ui | C1, H1 |
| H3 | frontend | `chat-transcript.component.ts`, `.html`, `chat-transcript.display.spec.ts`, DELETE `turn-tests-row.component.ts`, DELETE `turn-tests-row.component.spec.ts`, `chat-ui/src/turn-recap.ts` | chat, chat-ui | H2, C4, C5 |
| H4 | frontend | `display-dock.component.ts`, `.spec.ts`, `chat-view.component.ts`, `.html`, `chat-view.dock.spec.ts`, `agent-monitor-panel.component.ts` | chat | H3, C6 |
| P1 | frontend | `tool-language.utils.ts`, `.spec.ts`, `copy-text-button.component.ts`, `.spec.ts`, `code-output.component.ts`, `code-output.component.spec.ts` | chat-ui | none |
| P2 | frontend | `tool-call-header.component.ts`, `tool-call-header.component.spec.ts`, `chat-ui/src/index.ts`, `tool-call-item.component.ts`, `tool-call-item.component.spec.ts` | chat-ui, chat | P1, C1 (both edit `chat-ui/src/index.ts`) |
| P3 | frontend | `diff-display.component.ts`, `.spec.ts`, `tool-input-display.component.ts`, `.spec.ts`, `tool-output-display.component.ts`, `.spec.ts` | chat-ui | P1 |
| A1 | backend | `ptah-ui-hint.ts`, `ptah-ui-hint.spec.ts`, the two host-data specs | agent-sdk, chat | S6, L1, C4 |
| DOC1 | backend | 3 asset skill files plus 3 `.claude/skills` copies | apps/ptah-extension-vscode assets, .claude | S6 |
| DOC2 | backend | `content-manifest.json` (generated), `measurement.md`, `surface-catalog-reference.spec.ts` (A8, only if it changes) | root, vscode-lm-tools | DOC1, A1 |
| G1 | backend | `scripts/eager-closure-gate.js`, `apps/ptah-electron/src/config/eager-closure-gate.spec.ts` | scripts, ptah-electron | H4 |
| V1 | team-leader runs it once; visual-reviewer reviews | **The single user-approved build and launch (decisions.md #17).** It runs once, after every frontend batch (D*, C*, H*, P*) and G1 have passed their scoped checks. Steps: (1) one production Electron webview build with `statsJson`, which produces `dist/apps/ptah-extension-webview/stats.json`; (2) `node scripts/eager-closure-gate.js dist/apps/ptah-extension-webview/stats.json` runs the forbidden-input check. The `--base` growth check runs only if a merge-base `stats.json` already exists on disk, because a second build is not allowed. If it does not exist, `measurement.md` says "growth check not run (single build, decisions.md #17)" and lists the eager inputs added by this task, read from the head stats, by name and bytes; (3) one Electron app launch for the visual reviewer, covering the four R9 widths, both themes, the collapsed and expanded states, R7.9 checked against the design's stated 36 px collapsed height (R7.9 permits the Gate 1.7 figure, so no merge-base launch is needed), the R9.5 width script and axe. No other build, serve or launch is allowed. Any second run needs a new user decision. | webview app, ptah-electron | all frontend batches, G1 |

Notes on the table:

- `chat-ui/src/index.ts` appears in C1 and P2, and `turn-recap.ts` appears in C4 and H3. These are sequential edits, so
  do not run those batches in parallel.
- H3 keeps the `TurnTestsRowComponent` export removal and the deletion together, so every batch boundary compiles.

### Verification points

Run these per batch. They follow the CLAUDE.md memory-safe rules: changed projects only, one heavy check at a time,
`--parallel=1`, `--maxWorkers=2`, and no build, serve, e2e or package. The one exception is step V1, approved once by decisions.md #17.

- **shared batches (S*, L1):**
  - `npx jest -c libs/shared/jest.config.ts <changed specs> --coverage=false --maxWorkers=2`
  - `npx nx typecheck shared --parallel=1`
  - `npx nx lint shared --parallel=1`
  - After S6: also run `surface-contract.spec.ts`, `dashboard-trust-boundary.spec.ts`, `surface-budgets.spec.ts` and
    `host-source-registry.contract.spec.ts` with the same Jest form (`/3` unchanged; registry unchanged).
- **L2:**
  - `npx jest -c libs/backend/vscode-lm-tools/jest.config.ts libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/agent-limit.formatter.spec.ts libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-response-formatter.spec.ts --coverage=false --maxWorkers=2`
- **L3-L5:**
  - `npx jest -c libs/backend/rpc-handlers/jest.config.ts <handler spec> libs/backend/rpc-handlers/src/lib/host-profile/resolve-handler-plan.spec.ts --coverage=false --maxWorkers=2`
  - `npx nx typecheck rpc-handlers --parallel=1`
  - For L4 and L5, `npx nx typecheck <app or cli-engine project> --parallel=1`, plus the specs that read
    `EXPECTED_ABSENT_CAPABILITIES` (A5) and `apps/ptah-electron/src/di/container.smoke.spec.ts` (A2).
- **D*:**
  - `npx jest -c libs/frontend/declarative-dashboard/jest.config.ts <changed specs> --coverage=false --maxWorkers=2`
  - `npx nx typecheck declarative-dashboard --parallel=1`
  - `npx nx lint declarative-dashboard --parallel=1`
- **C*, P1, P3:**
  - `npx jest -c libs/frontend/chat-ui/jest.config.ts <changed specs> --coverage=false --maxWorkers=2`
  - `npx nx typecheck chat-ui --parallel=1`
  - `npx nx lint chat-ui --parallel=1`
- **H*, P2:** the chat-ui commands above, plus:
  - `npx jest -c libs/frontend/chat/jest.config.ts <changed specs> --coverage=false --maxWorkers=2`
  - `npx nx typecheck chat --parallel=1`
  - `npx nx lint chat --parallel=1`
  - After H4: the existing `chat-view.component.spec.ts`, `chat-view.keepalive.spec.ts` and
    `execution-node.ptah-ui.spec.ts`.
- **A1:**
  - `npx jest -c libs/backend/agent-sdk/jest.config.ts libs/backend/agent-sdk/src/lib/prompt-harness/ptah-ui-hint.spec.ts <host-data spec> --coverage=false --maxWorkers=2`
  - The chat host-data spec runs with the chat Jest config.
- **DOC2:**
  - `npm run manifest:generate`, then `npm run manifest:check`. These are scripts, not build targets.
  - The `surface-catalog-reference.spec.ts` Jest run.
- **G1:**
  - `npx jest -c apps/ptah-electron/jest.config.ts apps/ptah-electron/src/config/eager-closure-gate.spec.ts --coverage=false --maxWorkers=2`
  - The real-build half runs only in step V1 (decisions.md #17), once.
- **Contracts to honour throughout:**
  - `/3` behaviour unchanged;
  - 610 corpus deep-equal except `catalogVersion`;
  - `provider:getPlanLimits` unchanged;
  - the `formatPlanLimitsSection` and `formatAgentList` output byte-identical;
  - the hint gate unchanged;
  - the VS Code transcript unchanged except R7.
