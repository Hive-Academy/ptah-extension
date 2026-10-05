# Architecture evidence — TASK_2026_610_6a10

Relayed by the orchestrator from four read-only evidence agents (2026-10-04). Paths are relative to
the worktree root `D:\projects\ptah-extension\.claude-worktrees\task-610-a2ui-coding-chat\`.
Citations are the agents' own; spot-check before relying on an exact line.

---

## A. Renderer and contract evidence

### A1. `libs/frontend/declarative-dashboard/src/index.ts` (32 lines)
Exports: `SurfaceRendererComponent`, `SURFACE_VIEW_MODEL_BUILDER` (+ type `SurfaceViewModelBuilder`) from
`./lib/components/surface-renderer.component`; `buildSurfaceViewModel` (+ type `SurfaceViewModelBuild`);
`SURFACE_PAGE_SIZE`; types `SurfaceRenderable`, `SurfaceViewState`, `SurfaceComponentViewState`;
types `SurfaceInteractionState`, `SurfaceActionUiState`, `SurfaceInputCommit`, `SurfaceActionInvoke`,
`SurfaceSelectionChange`; `buildDashboardViewModel`, `mapDisplayNode`; types `LayoutNode`, `InputNode`,
`DisplayNode`, `SurfaceNode`, `DashboardViewModel`, `SurfaceViewModel`.

`SurfaceRendererComponent` (`lib/components/surface-renderer.component.ts`):
- :182-206 selector `ptah-surface-renderer`, standalone, `imports: [SurfaceNodeComponent]`, OnPush.
- :210-218 signal inputs `renderable = input.required<SurfaceRenderable>()`,
  `viewState = input<SurfaceViewState>(EMPTY_VIEW_STATE)` (:44 `{ components: {}, drafts: {} }`),
  `interaction = input<SurfaceInteractionState>(NO_INTERACTION)` (:46-53, null selection, empty maps,
  `submitDisabled: false`). Outputs: `viewStateChange`, `selectionChange`, `inputCommit`,
  `actionInvoke`, `renderFailed: void`.
- Injects only `SURFACE_VIEW_MODEL_BUILDER` (:208), `providedIn: 'root'`, factory `() => buildSurfaceViewModel`
  (:39-42). No store, no RPC, "no I/O, no markup" (:160).
- `actionInvoke` emits `{ actionId }` only for `surface.submit` buttons (flushes drafts first, `invoke()`
  :323-337). Submit buttons only from `surface.submit` actions on layout nodes (`surface-view-model.ts:52-56`).
  Selectable only with `dashboard.select` (`surface-view-model.ts:47-50`). Re-click emits `null` (:313-315).
  No other `dashboard.*` action renders a control.
- No `readonly`/`inert` input. Options: `interaction.submitDisabled: true` (disables submit,
  `surface-layout.component.ts:104,142`); leave outputs unbound; strip `surface.submit`/`dashboard.select`
  and input kinds before render; or override `SURFACE_VIEW_MODEL_BUILDER`. Caveat: input components stay
  editable (`commit()` local pending overlay :306-310).
- Charts are hand-built SVG (`dashboard-chart.component.ts`, `viewBox="0 0 600 280"` :72, geometry from
  `../charts/chart-geometry`). No chart library.
- Local view state (`surface-view-state.ts:11-21`): `sort {columnKey, direction}`, `filter`, `page`,
  `chartAsTable`, `expanded`; page size 25 (:9). Table: sort/filter/page/expand
  (`dashboard-table.component.ts:136-141`); list: filter/page/expand; chart: show-as-table/page/expand
  (`dashboard-chart.component.ts:155-163`). Renderer keeps a working copy (`state = linkedSignal(...)` :235,
  `publish` :339-342), so these work without the parent feeding state back.

### A2. View-model builders
- `buildSurfaceViewModel(renderable: SurfaceRenderable): SurfaceViewModelBuild` (`view-model/surface-view-model.ts:177`), never throws.
  `SurfaceViewModelBuild = { renderFailed: false; viewModel } | { renderFailed: true; reason: string; viewModel: null }` (:23-25).
- `buildDashboardViewModel(spec: DashboardSpecEnvelope): DashboardViewModel` (`dashboard-view-model.ts:89`), v1 only, throws `TypeError`.
- `mapDisplayNode(component, children?)` (`dashboard-view-model.ts:14`).
- `SurfaceRenderable = SurfaceContent` (`surface-view-state.ts:7`); `SurfaceContent` (`surface.types.ts:187-196`):
  `{ contract: 'dashboard-spec/2'; surface: Omit<SurfaceEnvelope,'dataModel'>; dataModel: SurfaceDataModel }`
  | `{ contract: 'dashboard-spec/1'; spec: DashboardSpecEnvelope }`. Split `dataModel` out (`{}` if absent).
- `view-model.types.ts`: `SurfaceViewModel {title, description?, components}` (:53-57); `LayoutNode` adds
  `selectable`, `children`, `submitActions` (:27-39); `InputNode` adds `selectable`, `hostValue`, `draftError?` (:40-44).
- No dedicated static/inert snapshot mode.

### A3. `libs/shared/src/mcp-apps-contracts`
- `surface.index.ts`: `export type * from './surface.types'` (:12); catalog consts :15-41
  (`SURFACE_SCHEMA_VERSION`, `SURFACE_CATALOG_VERSION`, kinds, `SURFACE_ACTIONS`,
  `SURFACE_HOST_SUPPORTED_ACTIONS`, `SURFACE_LIMITS`, `SURFACE_STORE_LIMITS`, ...); schemas :44-52
  (`SurfaceIdSchema` and `SurfaceEnvelopeSchema` NOT exported from the barrel); `readSurfacePath` :55;
  bindings :58-70; patch :73-79; concurrency :82-93; validator :96-106; `renderSurfaceText`,
  `describeSurfaceLimits` :109-112; `formatSurfaceSubmitMessage` :115; `describeSurfaceSelection` :118.
- `index.ts` (v1): catalog :28-40, types :41-72, schemas :74-95, `validateDashboardSpec` :97-100,
  `renderDashboardSpecText` :108-111, v2 version constants :113-120.
- `surface.validator.ts`:
  - `formatSurfaceIssues = formatDashboardSpecIssues` (:72)
  - `validateSurfaceEnvelopeVersions(input: unknown): SurfaceVersionCheck` (:128); `SurfaceVersionCheck` (:93-100).
  - `validateSurfaceUpdateInput(input: unknown, countBytes: DashboardJsonByteCounter): SurfaceUpdateInputValidation` (:516)
  - `validateSurfaceDocument(doc: unknown, countBytes: DashboardJsonByteCounter): SurfaceDocumentValidation` (:617) — the whole-envelope validator. No `validateSurfaceEnvelope`.
  - `SurfaceValidationRejected = { ok: false, reason, bytes? }` (:74); `SurfaceUpdateInputAccepted {ok:true; input; bytes}` (:75-80); `SurfaceDocumentAccepted {ok:true; surface; bytes; dataModelBytes}` (:83-89).
  - `SURFACE_MAX_RAW_JSON_DEPTH = 2*maxTreeDepth+8` (:344).
- `SurfaceEnvelope` (`surface.types.ts:122-130`): `schemaVersion: 'dashboard-spec/2'`, `catalogVersion: 'dashboard-catalog/2'`,
  `surfaceId`, `title: SurfaceRichText`, `description?`, `components: readonly SurfaceComponent[]`, `dataModel?`.
  `SurfaceDataValue` :114-120; `SurfaceDataModel` :121; `SurfaceComponent` union :101-111.
- `surface.schemas.ts`: `SurfaceIdSchema` :67-84 (1..128, no `v1:` prefix, `/^[A-Za-z0-9][A-Za-z0-9._-]*$/`);
  `SurfaceEnvelopeSchema` :482-495 strict, components min 1 max `maxComponents`; `SurfacePatchOpSchema` :497-535
  (`set-data`, `remove-data`, `add-component`, `replace-component`, `remove-component`, `set-title`);
  `SurfaceUpdateInputSchema` :536-562 on `operation`: `create{surface}`, `replace{baseRevision, surface}`,
  `patch{surfaceId, baseRevision, ops 1..maxPatchOps}`, `delete{surfaceId, baseRevision}`;
  `SurfaceComponentSchema` :403-419 over 13 kinds.
- `SURFACE_LIMITS` (`surface-catalog.ts:102-139`): maxComponents 200, maxTreeDepth 8, maxStringLength 2000,
  maxTableRows 1000, maxTableColumns 50, maxSeriesPoints 5000, maxChildrenPerNode 50, maxGridColumns 4,
  maxActionsPerComponent 8, maxInputs 100, maxOptions 50, maxOptionValueLength 200, maxSurfaceIdLength 128,
  maxComponentIdLength 128, maxPathSegments 8, maxPathSegmentLength 64, maxDataModelDepth 6,
  maxDataModelArrayLength 200, maxDataModelObjectKeys 100, maxDataModelBytes 64 KiB, maxSurfaceBytes 256 KiB,
  maxUpdateRequestBytes 300 KiB, maxRpcRequestBytes 16 KiB, maxSubmitMessageBytes 32 KiB,
  maxStateReadBytes 548 KiB, maxPatchOps 100, maxWriteLogEntries 32, maxWriteLogPathsPerEntry 16.
- `SURFACE_STORE_LIMITS` (`surface-catalog.ts:145-155`): maxRoutingIds 32, maxSurfacesPerRoutingId 8,
  maxLedgerRoutingIds 64, maxStoreBytes 24 MiB, maxOperationRecordsPerRoutingId 128, operationRecordBytes 1024,
  operationRetentionMs 600000, maxPendingOperationsPerRoutingId 4, maxOperationClockSkewMs 300000.

### A4. Catalogs
- `surface-catalog.ts`: `SURFACE_SCHEMA_VERSION = 'dashboard-spec/2'` (:10), `SURFACE_CATALOG_VERSION = 'dashboard-catalog/2'` (:11).
  No `SURFACE_SPEC_VERSION`. Layout `section|stack|grid|card` (:23-28); input `text|select|radio-group|checkbox` (:29-34);
  display `= DASHBOARD_COMPONENT_KINDS` (:35); combined (:36-40). `SURFACE_ACTIONS = [...DASHBOARD_ACTIONS, 'surface.submit']` (:41-44);
  `DASHBOARD_ACTIONS` = `dashboard.refresh|pin|export|copy|open-url|select|drill-down` (`dashboard-catalog.ts:75-90`).
  `SURFACE_HOST_SUPPORTED_ACTIONS = ['surface.submit','dashboard.select']` (:45-48). Stack direction/gap (:49-50).
  `SURFACE_PATH_SEGMENT_PATTERN` (:72), separator `.` (:73), denylist `__proto__|prototype|constructor` (:67-71).
- `dashboard-catalog.ts:56-62`: `DASHBOARD_COMPONENT_KINDS = ['stat','line-chart','bar-chart','table','list']`. No text/heading/note/status kind.
- **Display props are literal values only.** No data-model path binding for display kinds. Only `data?: DashboardDataRef {resultId, rowCount?, truncated?}`
  (`dashboard-spec.types.ts:87-93`). `SurfaceDisplay<T>` (`surface.types.ts:91-100`). Common display fields
  `id, title?, description?, actions?` (`surface.schemas.ts:325-330`).

| Kind | Props | Source |
|---|---|---|
| `stat` | `value: string \| number`, `unit?`, `delta?: number` | types :136-142; schema :331-339 |
| `line-chart`/`bar-chart` | `xLabel?`, `yLabel?`, `series?: {name; points: {x: string\|number; y: number}[]}[]` XOR `data?` | types :95-105, :145-162; schema :340-357 |
| `table` | `columns: {key; label: RichText; align?}[]` (min 1), `rows?: (string\|number\|boolean\|null)[][]` (cells = columns) XOR `data?` | types :107-115, :165-171; schema :358-385 |
| `list` | `ordered?`, `items?: {text: RichText; detail?; url?}[]`, `data?` | types :118-122, :174-180; schema :386-400 |
| `section` | `title: RichText`, `description?` | types :29-33; schema :197-204 |
| `stack` | `direction?`, `gap?` | types :34-38; schema :205-212 |
| `grid` | `columns: 1..4`, `gap?` | types :39-43; schema :213-220 |
| `card` | `title?`, `description?` | types :44-48; schema :221-228 |

Layout base `{id, children, actions?}` (`surface.types.ts:24-28`). `RichText = {text; format?: 'plain'}`
(`dashboard-spec.types.ts:53-56`). Action `{id, action, label: RichText, url?, params?}` (`surface.types.ts:19-22`).

### A5. `surface-text-fallback.ts`
`renderSurfaceText(view: SurfaceStateView): string` (:35-81) — v1 delegates to `renderDashboardSpecText`; v2 prints
title, description, indented components (layout by title/id; inputs `label: value [required]`; display via
`renderStat/renderTable/renderList/renderChart`), last line `surface <id> revision <n>`. Takes
`SurfaceStateView {surfaceId, revision, content, selection, lastSubmit}` (`surface.types.ts:211-217`).
`describeSurfaceLimits()` (:84-91).

### A6. `surface-bindings.ts`
Bindings are dotted-path strings on inputs only: `SurfaceInputBase {id; label; path: string}` (`surface.types.ts:60-64`),
`SurfacePathSchema` (`surface.schemas.ts:109-132`). `readSurfacePath(model, path, kind?)` (`surface-data-model.ts:79-106`).
Helpers: `isSurfaceLayoutComponent` :34, `isSurfaceInputComponent` :40, `surfaceActionsOf` :47,
`visitSurfaceComponents` :67, `collectSurfaceInputs` :94, `checkBindingCompatibility` :142, `checkDraftValue` :201,
`checkSubmitValues` :297, `findSurfaceAction` :334, `collectSubmitScope` :374.

### A7. Zod-free check and aliases
`libs/shared/src/index.zod-free.spec.ts` asserts `surface.types.ts` and `surface-catalog.ts` never reach `zod` (:50-62),
and that the walker detects zod in `surface.schemas.ts` (:64-74). Main barrel re-exports types
(`libs/shared/src/index.ts:34-35`). Aliases (`tsconfig.base.json`): `@ptah-extension/shared/mcp-apps-contracts` →
`index.ts` (:198-200); `.../surface` → `surface.index.ts` (:201-203); `@ptah-extension/declarative-dashboard` (:175-177).
Importers of the zod entry points must set `strict: true` (`index.ts:19-25`).

### A8. TASK_2026_594 / `dashboard-catalog/3`
No code contains `dashboard-catalog/3`, `alert`, `badge`, `radial-progress`. Only spec docs (commit `e224b1757`).
594 is `in_progress`, depends on 595. It plans `alert {tone, title?, text}`, `badge {tone, text, optional select}`,
`progress`/`radial-progress {value 0-100 or binding, tone, label}`, `divider {text?, direction}`, a spec/catalog
`/3` bump, a `ptah-surface-authoring` skill and an `APPS_SYSTEM_PROMPT` pointer. No text/heading kind planned.

### A9. How `mcp-apps-page` consumes the renderer
Route `apps` (`apps/ptah-extension-webview/src/app/app.routes.ts:162-168`): `canMatch: [electronOnlySurface]`,
`SURFACE_ACTIVE` provider, `loadComponent: () => import('@ptah-extension/mcp-apps-page')`. Comment :59-62: this
dynamic import is the only entry. `apps-surface-panel.component.ts` imports the renderer statically (:14-22),
`imports: [SurfaceRendererComponent, LucideAngularModule, DatePipe]` (:142); usage :231-239 binds every input and
output inside `@for (id of [entry.surfaceId]; track id)`. No providers in the lib. Fallback renders
`renderSurfaceText`/`renderDashboardSpecText` (imports :23-24; template :214-227).

---

## B. Chat transcript and store evidence

Premise corrections: `MarkdownBlockComponent` (`libs/frontend/markdown/src/lib/markdown-block.component.ts:35-58`)
has only `content` (:36), `active = input(true)` (:38), `variant: 'invert'|'auto'` (:51) — no preset input.
Assistant text does NOT go through `ptah-markdown-block`. `chat-ui` is `type:feature`.

### B1. Markdown rendering sites
`<ptah-markdown-block>` chat consumers: `chat-ui/.../subagent-transcript-viewer.component.ts:170-173`,
`chat-ui/.../notifications/compaction-marker.component.ts:72-75`,
`chat-ui/.../compact-session/compact-session-activity.component.ts:427`. Non-chat consumers: update-dialog :57,
system-prompt-drawer :243, output-style-instructions-field :89, git-ui spot-editor :329, tribunal crucible-verdict :249,
tasks-ui task-detail :433/:593, skill-synthesis-ui (4 sites). `libs/frontend/chat/src/lib/components/index.ts:23`
re-exports `MarkdownBlockComponent`.

Raw `<markdown>` in chat:
- **Assistant text node:** `libs/frontend/chat/src/lib/components/organisms/execution/execution-node.component.ts`
  (`ptah-execution-node`). Branch l.115-141: agent-summary text → `<ptah-agent-summary>` (l.124); else
  `<markdown [data]="renderedContent() | surfaceMarkdown: surfaceActive()" />` (l.136-138).
  Inputs l.314-340: `node = input.required<ExecutionNode>()`, `isStreaming`, `isFinalizing`, `getPermissionForTool`;
  output `permissionResponded`. No message-id input; node id is `node().id`. `renderedContent` is a copy of
  `node().content` updated at most once per animation frame while streaming (l.369-420). Recurses for message/tool/agent.
- Message bubble: `message-bubble.component.html:104-110` mounts `<ptah-execution-node [node]="message().streamingState!" ...>`;
  fallback `<markdown [data]="message().rawContent || '' | surfaceMarkdown: surfaceActive()">` (l.113-118); user text l.252-261.
- Thinking `chat-ui/.../thinking-block.component.ts:78-79`; agent card `agent-card-output.component.ts:283-284`,
  `agent-summary.component.ts:78,107`; tool views `code-output.component.ts:47`, `diff-display.component.ts:62`,
  `tool-input-display.component.ts:78`. Outside chat: `setup-wizard/.../analysis-results.component.ts:156`.

### B2. Types and `$context`
`ExecutionChatMessage` (`libs/shared/src/lib/types/execution/agent.ts:85-151`): `id` (87), `role` (90), `timestamp` (93),
`streamingState: ExecutionNode | null` (100), `rawContent?` (103), `nativeUuid?` (114), `files?` (117), `imageCount?` (120),
`inboundPeer?` (132), `sessionId?` (135), `agentInfo?` (141), `tokens?: MessageTokenUsage` (144), `cost?: number|null` (147),
`duration?` (150). `MessageTokenUsage` (`node.ts:60-69`) `{input; output; cacheRead?; cacheCreation?}`.
`ExecutionNode` (`node.ts:138-222`): `id`, `type` (`message|agent|tool|thinking|text|system`, :24-30), `status`
(`pending|streaming|complete|interrupted|resumed|error`, :35-41), `content`, `error?`, `toolName?`, `toolInput?`,
`toolOutput?`, `toolCallId?`, `parentToolUseId?`, `startTime?/endTime?/duration?` (189-193), `tokenUsage?`, `cost?`,
`model?`, `children` (209), `isCollapsed`, `retention?` (221).

**No per-message context snapshot.** `session-live-stats.util.ts`: `TurnModelUsage` (l.9-19) with
`lastTurnContextTokens?`, `contextWindow`, `contextCapacity?`; `deriveLiveModelStats` (l.38-105). Live value stored per
tab as `TabState.liveModelStats` (`chat-types.ts:651-662`) via `session-stats-aggregator.service.ts:159-179`. After
reload only a session-level `stats.contextSnapshot` (`rpc-session.types.ts:426-432`, rebuilt
`session-loader.service.ts:1044-1074`). Per-message tokens/cost/duration from `StreamingState.pendingStats`
(`chat-types.ts:156-160`) or `message_complete` (`message-finalization.service.ts:153-171`).

### B3. Transcript
`chat-transcript.component.html`: slot loop l.34-68; bubble mounted only `@if (renderWindow.isMounted(msg.id) ||
prependAnchor.isForcedMounted(msg.id))` (l.46-60), else placeholder with `renderWindow.placeholderHeight` (l.61-67);
change-set block l.69-103 (`@if (changeSetAnchors().get(msg.id); as changeSets) { @defer (when changeSets.length > 0) {
@for ... <ptah-change-set-card [changeSet] [host]="changeSetHost()" [reconciled] [conflicted] (review) (openFile) (openScm)/>`,
then error `<p role="alert">` l.84-99).
`chat-transcript.component.ts`: `providers: [TranscriptRenderWindow]` (l.153); `ChangeSetCardComponent` from
`@ptah-extension/chat-ui/change-set-card` (l.32); `streamingMessages` (l.363-389); `allMessages` (l.415-430); `vm`
(l.446-467, frozen while hidden); `changeSetAnchors` (l.476-485) = `anchorChangeSets(view.messages,
changeSetStore.changeSetsFor(this.sessionId()))`; `changeSetKey = `${turnStartedAt}:${turnEndedAt}`` (l.498-500);
`ensureLoaded` effect (l.571-576); render-window feed (l.659-680); `attach()` in `afterNextRender` (l.681-690).
Anchors (`transcript-change-set-anchors.ts`): `anchorInTurnWindow` (l.47-60) = last assistant message with
`transcriptOrderKey` (`streamingState?.startTime ?? timestamp`, l.25-27) in `(turnStartedAt, turnEndedAt]`; fallback
`anchorAfterUserMessage` (l.79-98) with `ANCHOR_CLOCK_SKEW_MS` 2000; `anchorChangeSets` returns
`ReadonlyMap<messageId, TurnChangeSet[]>` (l.116-135). No shared turn id ("nothing in a replayed transcript carries a
turn id", l.104-107).
`TranscriptRenderWindow` (`transcript-render-window.ts:40-310`): IntersectionObserver, rootMargin 2000px (l.9, 95-101);
last 6 messages always mounted (`ALWAYS_MOUNTED_TAIL` l.17) plus ids past `streamingBoundary` (l.161-184); replay
retention (l.187-200); `isMounted()` l.215-222; placeholder default 120px (l.24, 230-233). Bubble destroy/recreate on
window enter/leave and `msg.id` change; streaming→finalized keeps the id (l.395-403); hidden freezes `vm` (l.203-212).

### B4. `ChangeSetStore` (`libs/frontend/chat/src/lib/services/change-set/change-set.store.ts`)
`@Injectable({ providedIn: 'root' })`, `implements MessageHandler` (:240-241). `handledMessageTypes` =
`GIT_TURN_CHANGE_SET`, `SESSION_TURN_ENDED`, `GIT_STATUS_UPDATE` (:245-249). `_changeSets: signal<ReadonlyMap<sessionId,
readonly TurnChangeSet[]>>` (:251). API: `changeSetsFor(sessionId)` (:299), `marksFor(changeSet): ChangeSetMarks` (:312;
`{reconciled; conflicted}` :46-51), `ensureLoaded(sessionId): Promise<void>` (:327), `handleMessage` (:337). `load()`
= `rpcCall<GitTurnChangeSetsResult>(vscode, 'git:turnChangeSets', {sessionId}, 30_000)` (:351-379); auto-load effect
on `activeTabSessionId()` (:288-291); push `onChangeSetPushed` (:381-394). Keyed session → turn; sorted by
`turnEndedAt`; cap 100/session, 8 sessions (:32-34, 127-141). Registered `{ provide: MESSAGE_HANDLERS, useExisting:
ChangeSetStore, multi: true }` (`apps/ptah-extension-webview/src/app/app.config.ts:206`).
`TurnChangeSet` (`libs/shared/src/lib/types/rpc/rpc-change-set.types.ts:47-70`): `sessionId`, `workspaceRoot`,
`turnStartedAt`, `turnEndedAt`, `files: TurnChangeSetFile[]` (`{path; origPath?; status: 'A'|'M'|'D'|'R'|'U';
additions: number|null; deletions: number|null; binary?}` :18-34), `truncatedCount`, `totals {files; additions;
deletions}` (:37-44), `countsUnavailable`, `baselineMissing?`. RPC result `{ changeSets }` (:78-80); push `{ changeSet }` (:83-85).

### B5. Change-set card and footer badges
`ChangeSetCardComponent` (`chat-ui/src/lib/molecules/change-set/change-set-card.component.ts`, selector :101): inputs
`changeSet` (295), `host: 'electron'|'vscode'` (296, type :13), `reconciled` (298), `conflicted` (303); outputs
`review`, `openFile`, `openScm`. Entry point `libs/frontend/chat-ui/src/change-set-card.ts` (`tsconfig.base.json:49-50`).
Footer (`message-bubble.component.html`): collapsed l.127-143 (cost + duration when `tokens !== undefined`); main
l.156-175 (`ptah-token-badge [count]="tokens.input + tokens.output"`, `ptah-cost-badge`, `ptah-duration-badge`).
`CostBadgeComponent` (`chat-ui/src/lib/atoms/cost-badge.component.ts`): `cost = input.required<number|null|undefined>()`
(l.57); null/undefined/non-finite → "cost unavailable" `data-testid="cost-unavailable"` (l.37-45); `0` → "$0.0000" (l.64-69).

### B6. Nx tags (`@nx/enforce-module-boundaries` = error, `eslint.config.mjs:222-403`)
| Project | Tags |
|---|---|
| `chat` | scope:webview, type:feature |
| `chat-ui` | scope:webview, type:feature |
| `markdown` | scope:shared, type:ui |
| `declarative-dashboard` | scope:webview, type:ui, platform:angular |
| `chat-streaming` | scope:webview, type:feature |
| `chat-types` | scope:webview, type:util |
| `chat-state` | scope:webview, type:data-access |
| `mcp-apps-page` | scope:webview, type:feature, platform:angular |
| `libs/shared` | scope:shared, type:util |

`scope:webview` → shared|webview (264-266); `scope:shared` → shared (256-258); `type:feature` → feature, data-access,
ui, util, core (365-373); `type:data-access` → data-access, util (375-377); `type:ui` → ui, util (379-381);
`type:util` → util (383-385); `type:core` → core, util (387-389); no `platform:*` constraint.
`chat`/`chat-ui` → `declarative-dashboard`: allowed. `markdown` → `declarative-dashboard`: **not allowed** (scope).
`checkDynamicDependenciesExceptions` (l.248-253) lists only tasks-ui, harness-builder, marketplace subpaths.

### B7. Existing use
Neither `chat` nor `chat-ui` imports `@ptah-extension/declarative-dashboard` or `mcp-apps-contracts`. Only consumer is
`mcp-apps-page` (see A9). Deferred precedent: separate entry point + `@defer` (`chat-ui/src/change-set-card.ts`).

### B8. Turn completion
No per-message terminal flag. `[isStreaming]="i >= vm().streamingBoundary"` (`chat-transcript.component.html:55`);
`streamingBoundary` = finalized count (`.ts:455-457`); `finalizedMessageIds` (l.349-355). Tab `isStreaming =
status === 'streaming' || 'resuming'` (l.325-328); finalizing 300ms (l.636-657). `SessionStatus` (`chat-types.ts:477`):
`fresh|draft|loaded|streaming|resuming|switching|awaiting-background|sleeping`. `TabState.lastTerminalReason?`
(`chat-types.ts:751`; set `tab-manager.service.ts:2182`). Node `status`; `ExecutionNodeComponent.isNodeStreaming =
isStreaming() || node().status === 'streaming'` (l.353-355). `MESSAGE_TYPES.SESSION_TURN_ENDED = 'session:turnEnded'`
(`message-constants.ts:138`), handled `chat-message-handler.service.ts:182`, `change-set.store.ts:342`. Finalization keeps
tree id as message id and copies stats (`message-finalization.service.ts:153-171`).

---

## C. Backend prompt and tool evidence

### C1. System prompt assembly (`libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts`)
`build(input: QueryOptionsInput): Promise<QueryConfig>` :972 → `buildSystemPrompt(...)` :1045-1053; private
`buildSystemPrompt(sessionConfig?, enhancedPromptsContent?, mcpServerRunning = true, initialUserQuery?, cwd?,
authEnvOverride?, resolvedModel?)` :1675. Pure `export function assembleSystemPrompt(input: AssembleSystemPromptInput):
SystemPromptAssemblyResult` :295; input :234-262 (`providerId, resolvedModel, userSystemPrompt?, outputStyleBody?,
mcpServerRunning, enhancedPromptsContent?, preset?`). `appendParts` :305-327 order: model identity (:306-309),
`PTAH_CORE_SYSTEM_PROMPT` always (:310), `sessionConfig.systemPrompt` (:311-313; where Apps `APPS_SYSTEM_PROMPT`
arrives), `outputStyleBody` (:318-320), `enhancedPromptsContent` (:321-323); joined `\n\n` (:327). Second join
:1729-1737 `[sessionStartBlock, corpusPrimeBlock, memoryBlock, codeSymbolBlock, result.content]`; returned
`{ type: 'preset', preset: 'claude_code', append: finalContent }` :1758-1762. `mcpServerRunning` and `preset` unread
by `assembleSystemPrompt`.
Fragments: `PTAH_MCP_SUBSTITUTION_SECTION` (`prompt-harness/ptah-core-prompt.ts:31`, embedded :109/:138);
`PTAH_MCP_MANDATE_PROMPT` :279 (exported `prompt-harness/index.ts:12`, unused); `PTAH_CORE_SYSTEM_PROMPT_TOKENS =
Math.ceil(length/4)` :267, pinned `<= 4000` by `ptah-core-prompt.spec.ts:17`. `APPS_SYSTEM_PROMPT`
(`libs/frontend/mcp-apps-page/src/lib/apps-system-prompt.ts:9`) sent as `chat:start options.systemPrompt`
(`apps-session.service.ts:249`). MCP `buildServerInstructions()` (`vscode-lm-tools/.../mcp-core/server-instructions.ts:119`,
512-char cap :34), profile-independent.
**Best hint location:** new constant in `prompt-harness/` beside `PTAH_CORE_SYSTEM_PROMPT`, pushed in
`assembleSystemPrompt` right after :310. Covers `SdkQueryOptionsBuilder` and `PtahCliSpawnOptionsService`. Not inside
`PTAH_CORE_SYSTEM_PROMPT` (4000-token pin). For coding-only: `sessionConfig.mcpToolProfile` is available in
`buildSystemPrompt`; pass as a new `AssembleSystemPromptInput` field.

### C2. Session origin
No `origin/surface/clientKind/isAgentLane` field. `ChatStartParams` (`rpc-chat.types.ts:44-111`): `prompt?`, `tabId`,
`name?`, `workspacePath?`, `ptahCliId?`, `surfaceMode?`, `mcpToolProfile?` ("Absent means `coding`"), `options?
{model?, systemPrompt?, files?, images?, preset?, thinking?, effort?, includePartialMessages?}`, `mcpServersOverride?`.
`ChatContinueParams` (:124-159): `prompt`, `sessionId`, `tabId`, `name?`, `workspacePath?`, `model?`, `files?`,
`images?`, `thinking?`, `effort?`, `surfaceMode?`, `mcpToolProfile?`. `AISessionConfig.mcpToolProfile`
(`ai-provider.types.ts:161`); `AIMessageOrigin` (:75-80) is who sent a turn. Host identity only `HostProfile.host:
'vscode'|'electron'|'cli'|'tui'` (`rpc-handlers/.../host-profile/host-profile.ts:46`), not in session config.
VS Code, Electron, TUI (`apps/ptah-tui/src/hooks/use-chat.ts`) and ptah-cli (`apps/ptah-cli/src/cli/session/chat-bridge.ts`)
all go `chat:start/continue` → `ChatSessionService.launchSdkSession` (`chat-session.service.ts:556-568, 745`) →
`SdkQueryOptionsBuilder.build`. Ptah CLI lanes call `assembleSystemPrompt` directly
(`cli-agent-runtime/.../ptah-cli/helpers/ptah-cli-spawn-options.service.ts:185`). One-shot queries:
`SdkQueryRunner.buildOneShotMcpServers` (`sdk-query-runner.service.ts:638`). System CLIs get no Ptah prompt.

### C3. Tool profile (TASK_2026_595)
`libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-tool-profile.ts`: `MCP_TOOL_PROFILES = ['coding','apps']`
(`ai-provider.types.ts:150-151`); `APPS_ONLY_TOOL_NAMES` (:9-13) = `ptah_dashboard_propose_spec`, `ptah_surface_update`,
`ptah_surface_get_state`; `resolveMcpToolProfile` (:16-24); `appsOnlyToolMessage` (:27); `withAppsNamespaceProfile` (:36).
Flow: `apps-session.service.ts:245,327` → zod `chat-rpc.schema.ts:61,75` → `AISessionConfig` →
`buildMcpServers(mcpServerRunning, routingSessionId, toolProfile)` (`sdk-query-options-builder.ts:1802`; URL
`.../session/{id}/profile/apps` :1823-1827) → `extractCallerToolProfile` (`mcp-http/http-server.handler.ts:313-319`;
body `_caller*` stripped :384-395). `handleMCPRequest` (`protocol-dispatcher.ts:256`), `tools/list` (:277) →
`handleToolsList` (:385-400) → `buildToolSet` (:410-422) → `markEagerTools` (apps eager :667). `tools/call` guard
:880-882. Profile into request context :292. `system-namespace.builders.ts:717-720` profile-aware `ptah.help()`.

### C4. `surface-tools.ts` (`vscode-lm-tools/src/lib/code-execution/mcp-core/surface-tools.ts`)
`generate()` uses `z.toJSONSchema(schema, { io: 'input', target: 'draft-7' })` (:54-62, strips `$schema`);
`flattenOperationUnion(fragment, discriminator)` (:72-127); `buildUpdateInputSchema()` (:129-131);
`export function buildSurfaceUpdateTool(): MCPToolDefinition` (:160-208); description interpolates catalog and
`SURFACE_STORE_LIMITS` (:196-199), ends with `ANONYMOUS_RULES` (:150-157). 595 measured 65,264 chars.
Handler: dispatcher `case SURFACE_UPDATE_TOOL_NAME` (`protocol-dispatcher.ts:2033-2049`; scope `{ sessionId:
getCallerSessionId(), toolCallId: request.id.toString() }`) → `handleSurfaceToolCall(name, args, surface, caller,
logger)` (`mcp-core/surface-tool-handlers.ts:96-116`) → `buildSurfaceNamespace().update`
(`namespace-builders/surface-namespace.builder.ts:100-173`): validates with `validateSurfaceUpdateInput` (:102-106);
anonymous create/replace → render-only text (:70-82, :108-116); patch/delete → unavailable (:117-120); no service →
"surface state unavailable on this host" (:90-93).
Commit (`vscode-lm-tools/src/lib/surface/surface-state.service.ts`): `applyAgentUpdate(routingId, input, toolCallId)`
:183 → `executeAgentPlan` :463; delete → `store.delete` :502 + `publish` :504; else `commitRecord` :567-591
(`store.commit` → `publish` → `publishEvictions`). Revision +1 (`surface-commit.ts:103,145`;
`surface-agent-mutations.ts:253`). `publish` (:675) → `pushSurfaceChange` (`surface/surface-push.ts:17-26`) →
`createDashboardBroadcast` → `MESSAGE_TYPES.SURFACE_UPDATED` to all active webviews.
`SurfaceToolReply { isError; text }` (`surface-tool-handlers.ts:29-32`); rejected/unavailable → isError; delivery-failed
→ isError + committed text; throw → `SURFACE_TOOL_UNEXPECTED_FAILURE` (:91-93). Store `SurfaceStateStore`
(`surface/surface-state.store.ts:145`, limits :157); ledger `surface-operation-ledger.ts:230`. No `SurfaceUpdateInbox` class.

### C5. Skills
`ptah-surface-authoring` does not exist (only spec mentions). Shipped skills live at
`apps/ptah-extension-vscode/assets/plugins/<plugin>/skills/<name>/SKILL.md` with `.claude-plugin/plugin.json`
(e.g. `ptah-core`). YAML frontmatter `name`, `description`; optional `references/`, `assets/`. Distribution via root
`content-manifest.json` (`scripts/generate-content-manifest.js`, `npm run manifest:generate`; CI gate `manifest:check`
in `.github/workflows/content-manifest.yml:54`); `ContentDownloadService`
(`libs/backend/platform-core/src/content-download.service.ts`) mirrors to `~/.ptah/user`. A new skill needs
`manifest:generate` or CI fails.

### C6. 595 measurement
`.ptah/specs/TASK_2026_595_1c01/measurement.md`: `JSON.stringify(result.tools).length` from real `handleMCPRequest`
tools/list, tokens `ceil(chars/4)`, temporary Jest spec (deleted). Coding 54,471 chars (Electron-like), 56,776
(VS Code-like); apps adds 69,097. No committed size assertion; closest guard `protocol-dispatcher.spec.ts:7661`
(counts 59/56). Others: `dashboard-propose-spec.tool.spec.ts:770,783`, `mcp-contract.sweep.spec.ts:1922`.

### C7. Token counting in Jest
`TokenCounterService` (`workspace-intelligence/src/services/token-counter.service.ts:27-60`) needs DI
(`PLATFORM_TOKENS.TOKEN_COUNTER`). Direct: `countTokens(text): number` (`libs/backend/tool-output-reducers/src/lib/token-measure.ts:51`,
re-exported index :10-14; `gpt-tokenizer` `encode`; Jest-tested). `CliTokenCounter`
(`platform-cli/src/implementations/cli-token-counter.ts`). `gpt-tokenizer ^4.0.0` (`package.json:169`).

### C8. TurnChangeSet push
`rpc-handlers/src/lib/chat/change-set/turn-change-set-recorder.service.ts`: baseline on prompt-submit hook (:159-173);
`onTurnEnded/onTurnFailed` (:143-148) → `recordTurn` (:207-268) → `store.append` (:249; key
`ptah.turnChangeSets:<sessionId>`) → `webviewManager.broadcastMessage(MESSAGE_TYPES.GIT_TURN_CHANGE_SET, { changeSet })`
(:259-267). Broadcast target per host: CLI/TUI `container.register(TOKENS.WEBVIEW_MANAGER, { useValue: pushAdapter })`
(`cli-engine/src/lib/container.ts:397`; `CliWebviewManagerAdapter` / `TuiWebviewManagerAdapter`); Electron
`apps/ptah-electron/src/activation/bootstrap.ts:394`; VS Code `WebviewManager`. Not filtered by session; clients filter
on `changeSet.sessionId`.

---

## D. TUI and build-gate evidence

### D1. TUI events and RPC
`apps/ptah-tui/src/main.tsx:117` `new TuiWebviewManagerAdapter()` → `withEngine({ host: 'tui', pushAdapter, filePicker })`
(:126-135). `TuiWebviewManagerAdapter` (`transport/tui-webview-manager-adapter.ts:3-8`) extends
`CliWebviewManagerAdapter` (`cli-engine/src/lib/transport/cli-webview-manager-adapter.ts:20`, EventEmitter;
`sendMessage` :25-32, `broadcastMessage` :38-40 → `dispatch` :71-82 emits by `type`, unwraps BATCH; no wildcard).
Registered as `TOKENS.WEBVIEW_MANAGER` (`container.ts:396-397`).
`SessionController` (`hooks/use-sessions.ts:207`) subscribes `session:stats` (:250), `session:id-resolved` (:251),
`off` in `dispose()` (:254-257), `handleStats` active-session only (:382-391), `unresolvedPushes` (:229), hook via
`useMemo` + version (:423-444). Other subscriptions: `use-chat.ts:177-184` (`chat:chunk|complete|error`,
`session:id-resolved`), `use-agent-config.ts:116`, `App.tsx:176-177`, `use-thoth-status.ts:193-194`,
`use-login-progress.ts:106-107`, `GatewayPanel.tsx:95`, `AgentMonitor.tsx:104-106`, `MemoryPanel.tsx:155`. Helpers
`usePushEvents<T>(pushAdapter, eventType)`, `usePushEventList<T>(pushAdapter, eventType, reducer, initial)`
(`hooks/use-push-events.ts:10-53`).
`git:turnChangeSet` reaches the TUI: recorder injects `TOKENS.WEBVIEW_MANAGER` (`turn-change-set-recorder.service.ts:133-134`),
broadcasts at :259-261; `MESSAGE_TYPES.GIT_TURN_CHANGE_SET = 'git:turnChangeSet'` (`message-constants.ts:307`; payload
map `payload-map.ts:408`); CLI container calls `registerSharedRpcHandlers` + `activateSessionLifecycleNotifier`
(`container.ts:829-830`), which resolves the recorder (`register-shared-rpc-handlers.ts:72-77`). Not subscribed in the
TUI today; `session:turnEnded` not subscribed either.
RPC: `CliMessageTransport.call<TParams, TResult>(method, params): Promise<{success; data?; error?; errorCode?}>`
(`cli-engine/src/lib/transport/cli-message-transport.ts:35`, in-process `rpcHandler.handleMessage` :44-46); via
`useTuiContext().transport` (`context/TuiContext.tsx:11-14, 74-80`) or `useRpc()` (`hooks/use-rpc.ts:14-49`).
Example `session:stats-batch` (`use-sessions.ts:317-323`). `git:turnChangeSets` handler registered on every host
(`rpc-handlers/.../host-profile/manifest.ts:204-207`, `requires: []`; handler
`handlers/git-change-set-rpc.handlers.ts:42-58`, zod-strict `{ sessionId: string(1..512) }`).

### D2. TUI rendering and turn end
`components/chat/ChatPanel.tsx:73` `useChat` → `MessageList.tsx:118-125` → `MessageBubble.tsx:74` (diff → `DiffViewer`
when not streaming, `isDiffContent` :10-15; else `<Markdown text streaming cursorColor/>` :122-140) →
`components/chat/Markdown.tsx:188` → `parseMarkdown(text)` (:194), code via `CodeBlockView` (:82-117).
In-house parser `apps/ptah-tui/src/lib/markdown.ts`: `parseMarkdown(text): MarkdownBlock[]` (:196), `FENCE_RE` (:215-239),
code block `{ kind: 'code'; language; lines; closed: boolean }` (:41-45) — `closed` false until the closing fence;
`parseInline` (:363), `stripTerminalControls` (:169). `components/chat/CodeBlock.tsx` exists but is unused by `Markdown.tsx`.
Turn end (`hooks/use-chat.ts`, `ChatStreamController`): `handleComplete` (:346-351, `chat:complete` by `tabId`) →
`finalizeStreaming()` (:389-398) → `markStreamingDone()` (:400-406). `failTurn` (:377-387: `chat:error`, watchdog
:508-521, RPC failure); `stop()` (:270-273). `message_complete` only flushes (:332-334). Deltas keyed
`messageId:blockIndex`; `source: 'complete'|'history'` replaces (:308-313, 477-486).
**No execution tree in the TUI.** Only `ChatToolRow { id; toolName; status }` (`use-chat.ts:8-12`), from
`tool_start`/`tool_result` (:320-331, `upsertTool` :417-446). Drops `ToolStartEvent.toolInput`
(`libs/shared/src/lib/types/execution/stream.ts:145-154`), ignores `tool_delta`. Only `toolInput` use:
`PermissionPrompt.tsx:23,42`. `chat-execution-tree`/`chat-streaming` are scope:webview. `loadSession` only calls
`session:load` and seeds stats (`use-sessions.ts:286-304`); no history messages loaded.

### D3. TUI imports
`apps/ptah-tui/project.json` tags `scope:cli`, `type:app`. `scope:cli` → shared, cli, extension
(`eslint.config.mjs:327-331`); `type:app` → feature, data-access, ui, util, core (:355-363). `libs/shared` is
scope:shared/type:util. `tsconfig.app.json`: `strict: true`, `moduleResolution: bundler`, `jsx: react-jsx`.
`tsconfig.build.json` maps `@ptah-extension/shared`, `/schemas`, `/mcp-apps-contracts`, `/mcp-apps-contracts/surface`
(also `tsconfig.base.json:197-202`). Main barrel used widely (`use-sessions.ts:3-8`, `use-chat.ts:4`, ...);
`mcp-apps-contracts` not imported by the TUI today.
`renderSurfaceText` exported only from `.../mcp-apps-contracts/surface` (`surface.index.ts:109-112`); signature
`renderSurfaceText(view: SurfaceStateView): string` (`surface-text-fallback.ts:35`); its transitive imports are zod-free,
but the `surface.index.ts` barrel re-exports zod schemas (:44-53). Other zod files: `dashboard-spec.schemas.ts`,
`dashboard-spec.validator.ts`.
Bundle gates: `apps/ptah-tui/src/esm-bundle-gate.spec.ts` (:122-204: ESM target discovered, `createRequire` before any
`Dynamic require of` shim, no `-worker` targets); `build-artifact-gate.ts` `describeIfBuiltOrFail` (:33; skip with
`PTAH_ALLOW_SKIP_UNBUILT=1`). `zod` is esbuild-external. Angular excluded in practice by the scope:cli lint rule.

### D4. Framework-free shared place
Use `libs/shared/src/lib/utils/` (exported via `utils/index.ts`). Precedent `pickPrimaryModel`
(`pick-primary-model.ts:47`, exported `utils/index.ts:10`; used by TUI `use-sessions.ts:4,137,182` and webview
`session-live-stats.util.ts:2,67`). `chat-types` (scope:webview) and `markdown` (Angular) are unusable from the TUI.

### D5. TASK_2026_494 Req 9.1 measurement
Requirement `.ptah/specs/TASK_2026_494_ca38/task-description.md:171` (risk :197); gate doc `lazy-load-gate.md`:
`npx nx build ptah-extension-webview --configuration=production --skip-nx-cache --stats-json` on branch and base
`9afac1aa2`; "initial" = console "Initial chunk files" (main.js, 6 chunk-*.js, styles.css, scripts.js, polyfills.js);
3,399,489 B vs 3,395,273 B (:43-82); attribution via `stats.json` `outputs[file].inputs` union + forbidden-path regexes
(:88-114); zod inputs 95 files both trees (:126-134); string-search fallback on `main.js`. Task `batches.md:1140-1170`;
re-check `code-logic-review-batch-19-round-2.md:35-39`. No committed script. Closest reusable:
`scripts/electron-only-chunks.js` (reads `dist/apps/ptah-extension-webview/stats.json`; `assertEagerClosureKept(stats,
electronOnly)` :154-173 walks `main.js` via `import-statement` imports; exports `generate`, `classify`,
`isElectronOnlyInput`, `assertStatsMatchBuild`, `assertEagerClosureKept` :195-201; used by `scripts/copy-webview.js:10`,
tested `apps/ptah-electron/src/config/packaged-deps.spec.ts:69,215`).
Budgets `apps/ptah-extension-webview/project.json:57-68`: initial warn 2.5mb, error 3.5mb; anyComponentStyle 10kb/20kb;
`"statsJson": true` now at :71. **Current initial ≈ 3.40 MB: over the warning, under the error.**

### D6. Lazy-loading patterns in `libs/frontend/chat`
`@defer`: `chat-transcript.component.html:72` (change-set card, own entry point `@ptah-extension/chat-ui/change-set-card`,
`chat-transcript.component.ts:30-32`, `imports` :150-151 "Used only inside `@defer`"); `app-shell.component.html:3,10,20`
(`when ...; prefetch on idle`); `settings.component.html:160,171` (`on immediate`); `agent-behaviour-section.component.ts:258`;
`voice-config.component.ts:197`; `orchestration-settings.component.ts:45`; `output-style-config.component.ts:120`;
`providers-settings.component.ts:56,156,180,204`.
Dynamic `import(`: `electron-shell.component.ts:377` (`@ptah-extension/git-ui` → `dockComponent.set(...)`, failure flag);
`file-link-router.service.ts:123`; `change-set-actions.service.ts:141`; `workspace-coordinator.service.ts:128`.
`ngComponentOutlet`: `electron-shell.component.ts:70,277`; `app-shell.component.html:734` (DI token
`ORCHESTRA_CANVAS_COMPONENT`, `app-shell.component.ts:201-213`). No `loadComponent` or `createComponent` in chat.

### D7. Frontend RPC/push pattern
`ChangeSetStore` (see B4). `libs/frontend/core/src/lib/services/`: `rpc-call.util.ts:185-209` `rpcCall<T>(vscodeService,
method, params, timeoutMs?)` and typed overload `rpcCall<K extends RpcMethodName>(...)`; `claude-rpc.service.ts:93`
`ClaudeRpcService` (`call<T extends RpcMethodName>(method, params, options?)` :129-133, handles `RPC_RESPONSE` :99);
`message-router.types.ts:33-38` `MessageHandler`, :49 `MESSAGE_HANDLERS`; `message-router.service.ts:88`
`MessageRouterService` (dispatch by `handledMessageTypes` :127, BATCH unwrap :210).
