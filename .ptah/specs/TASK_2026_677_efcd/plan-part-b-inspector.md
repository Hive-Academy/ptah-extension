# Implementation Plan, Part B (Inspector "This session") - TASK_2026_677_efcd

Part B of a three-part plan. Part A covers the turn, header and composer. Part C covers the agent dock and avatars. This part covers:

- design-spec §2 (shell, docked inspector vs overlay sheet).
- §4.1-4.6 and §4.8.
- §8.2 (per-theme status inks).
- §8.3 (overlay focus).
- §9 / §9.1 (the one session-scoped aggregate).
- Decisions rows 19 and 36, D42 and D43 (open state).
- Requirement 6 (shell), 7 (orchestrator card), 8 (AGENTS list container), 9 (request routing), 10 (TODOS), 11 (GIT), 12.1-12.2 (aggregate and count), 17 (TASK).

## Inputs and constraints

- **Requirements used:** `context.md` (via handoff-2.md), `task-description.md` §6-12 and §17, `parity-inventory.md` A-8..A-15, C-2..C-5, C-15, C-16, D-1..D-11, `decisions.md` rows 3, 9, 15, 19, 21, 24, 34-36, `design-spec.md` §2, §4 (except §4.7), §8.2, §8.3, §9, §9.1, D27, D30, D42, D43, line 1187, and `handoff-2.md` §3-§4.
- **Corrections applied** (design-spec vs source):
  - **Organization field.** The design calls it `taskIds`. The real shape is `organization.tasks[]` with `taskId / role / source / createdAt / missing`.
  - **Todo helper line numbers.** `parseTodoList` is at `compact-session-metrics.ts:67` and `summarizeTodos` is at `:105`. The spec has them swapped.
  - **Open path.** The design suggests `editor:openFile`. This plan uses `FILE_LINK_OPENER`, the path the Tasks board already uses (Decision B-2).
- **Cross-part agreements:**
  - Part C owns the agent roster. It is created in the chat lib, not canvas, because canvas → chat is the only allowed direction (Decision B-1). Part C confirmed this by message.
  - Part C owns `ptah-agent-avatar` in `@ptah-extension/chat-ui`.
  - Part A owns the header, including the toggle and the "N needs you" chip. Part A consumes this part's `InspectorShellController` and `SessionInspectorStore`. The contracts are listed in component 3 and component 4.
- **Missing decision-critical input:** TASK_2026_648 (session-embed, `TabState.workflow`) is not on main.
  - It blocks the workflow-tab initial-open source.
  - Resolution: a per-tab `inspectorInitialOpen` input that works today. 648 needs one line to hook it up (component 4).

## Codebase evidence

| Evidence | Location | Architectural implication |
| --- | --- | --- |
| canvas imports `@ptah-extension/chat` (26 imports); chat and chat-ui never import canvas | grep of `libs/frontend/canvas/src`, `libs/frontend/chat/src` | Aggregate, open state and inspector components live in **chat**. Canvas (Rail board, dock) consumes them. Design §9.1 "canvas lib" placement would create a cycle. |
| ChatViewComponent root: `div.flex.h-full.w-full.relative` → main column, then the Electron display dock (`@defer (when panelOpen())`) or the VS Code agent monitor panel | `libs/frontend/chat/src/lib/components/templates/chat-view.component.html:1-3, 250-345` | The inspector slots in as a sibling after the main column and before the dock or panel. Both existing panels are kept (parity C-6). |
| `SESSION_CONTEXT`, `SESSION_FORCED_CARD` injected optionally | `chat-view.component.ts:276-290` | The chat-view hosts the inspector only without `SESSION_CONTEXT` (main panel). Rail panes get it from the Rail board aside (Decision B-3). |
| `SESSION_CARD_ACTIONS {openLane(key), openSession()}` provided by `canvas-detail-transcript` (Rail panes) | `libs/frontend/chat/src/lib/tokens/session-context.token.ts:56-63`; `canvas-detail-transcript.component.ts:82` | Tells whether a lane surface exists. Used for the inspector `hasLaneSurface` input. |
| Rail board renders `ptah-canvas-session-details` in three asides, always inside `@defer (on idle)`; `detailsOpen` signal; band from `railWidthBand` (sm < 1120) | `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.ts:26-28, 180-245, 270, 310, 643, 717`; `canvas-board-mode.ts:18-23` | The Rail board swaps in `ptah-session-inspector` (D-1..D-10), keeps its aside (D-11), and adds the <400 px overlay (req 6.5). |
| Focus header already has a details button and a `detailsRequested` output | `canvas-focus-header.component.ts:63, 111`; `canvas-focus-area.component.ts:54, 100` | The Rail <400 px overlay opener reuses this button. |
| `SessionOrganizationSummary.tasks: SessionTaskLinkSummary[]` `{taskId, role, source, createdAt, missing}` | `libs/shared/src/lib/types/session-organization.types.ts:91-100, 115-126` | The TASK lead link comes from this shape. |
| `ChatSessionSummary.organization?` is set only when the host serves organization | `libs/shared/src/lib/types/execution/node.ts:257-261` | The link read is `chatStore.sessions()` filtered by session id. |
| `SessionListResult.organizationAvailable?` (absent means false; VS Code has no organization store) | `libs/shared/src/lib/types/rpc/rpc-session.types.ts:118-129` | Unavailable organization means link state `unknown`, and the TASK section is not rendered. |
| `chatStore.sessions`, `chatStore.organizationAvailable` | `libs/frontend/chat/src/lib/services/chat.store.ts:104, 110` | Signals already in the chat lib. |
| `session:organizationChanged` push → `handleSessionMetadataChanged()` debounced `session:list` refresh | `libs/frontend/chat/src/lib/services/chat-message-handler.service.ts:192-197, 485-490`; payload `libs/shared/src/lib/types/messages/payload-map.ts:295-306` | Link-change refresh uses this existing signal (req 17.15). No new push. |
| `IFileLinkOpener.open({path, line?, column?, origin?})`, token `FILE_LINK_OPENER` (core port, chat implements it) | `libs/frontend/core/src/lib/tokens/file-link-opener.token.ts:7-42` | Artifact open path. |
| `FileLinkRouterService`: Electron opens in the git dock spot editor (`ReviewNavigationService.openFile`); VS Code calls `file:open` natively; rejects on failure; resolves quietly on user cancel | `libs/frontend/chat/src/lib/services/file-link-router.service.ts:95-170` | Opens "the way the git sidebar opens files" in Electron and natively in VS Code. The backend re-authorizes every path. |
| Tasks board `openArtifact`: validates `detail.artifacts.includes(file)`, composes `${root}/.ptah/specs/${folderName}/${file}`, then `fileLinkOpener.open` | `libs/frontend/tasks-ui/src/lib/services/tasks-store.service.ts:1351-1376` | Exact pattern to mirror, including traversal protection. |
| `editor:openFile {target, path, line?, workspaceRoot?, scope?}` launches an external editor target | `libs/shared/src/lib/types/rpc/rpc-editor.types.ts:45-86`; `rpc.types.ts:872-875`; `editor-launcher.service.ts:137-148` | Rejected as the open path (needs target detection and leaves the app; Decision B-2). |
| `TasksStoreService.handleMessage` returns early when `!this.surfaceOpen` | `tasks-store.service.ts:1121-1128` | The inspector needs its own `tasks:changed` consumer. |
| `TASKS_CHANGED_MESSAGE_TYPE = 'tasks:changed'`, defined in the tasks store file | `tasks-store.service.ts:48-53` | Move the constant to a board-free file so the feed can import it. |
| `TasksChangedNotification {workspaceRoot, reason, folderNames?}`; `TasksGetParams {workspaceRoot?, taskId}`; `TasksGetResult {task: TaskSpecDetail \| null}` | `libs/shared/src/lib/types/rpc/rpc-tasks.types.ts:27-29, 55-60, 753-757` | Reader contract. |
| `TaskSpecSummary {id, folderName, status, title, ...}`; `TaskSpecDetail {body, artifacts: string[]}` | `libs/shared/src/lib/types/task-spec.types.ts:141-150, 193-196` | No phase field, so Stage is derived. |
| `task-presentation.ts` imports only `@ptah-extension/shared`; exports `TASK_STATUS_LABELS` (:27), `TASK_STATUS_BADGE` (:37), `WorkflowArtifact` (:361), `WORKFLOW_ARTIFACTS` (:379) | `libs/frontend/tasks-ui/src/lib/task-presentation.ts:11-24` | Safe for a narrow entry point. Already in the initial bundle through the eager `TasksStore`, so the import costs nothing. |
| `CARRIER_FILE = 'task.md'`; `DOC_FILES` ordered list | `libs/shared/src/lib/types/task-spec.contract.ts:39, 74-` | Document ordering. |
| Secondary entry precedent `@ptah-extension/tasks-ui/services` → `src/services.ts` | `tsconfig.base.json:105-107`; `libs/frontend/tasks-ui/src/services.ts` | Add `@ptah-extension/tasks-ui/presentation` the same way. |
| tasks-ui depends only on core, markdown, shared, ui (no chat or canvas) | grep of `libs/frontend/tasks-ui/src` | chat → tasks-ui/presentation creates no cycle. Tags `scope:webview` / `type:feature` match chat. |
| `MESSAGE_HANDLERS` multi-provider; `TasksStore`, `TaskSessionLinksService` and `SessionGitStatsStore` are registered in the webview `app.config.ts` | `libs/frontend/core/src/lib/services/message-router.types.ts`; `apps/ptah-extension-webview/src/app/app.config.ts:183-262` | The new feed registers there. No separate listener. |
| `MonitoredAgent.startedAt` (:399), `completedAt?` (:401), `permissionQueue: AgentPermissionRequest[]`; `agentsOwnedBySession` (:891), `sessionSubagentsForSession` (:955) | `libs/frontend/chat-streaming/src/lib/agent-monitor.store.ts:394-442, 891, 955` | Completion time exists for CLI lanes. |
| `AgentPermissionRequest.requestId`, `.toolName` | `libs/shared/src/lib/types/agent-permission.types.ts:26-37` | Lane request identity. |
| needs-you queue identity: session `requestId = request.id`, lane `requestId = queue entry requestId`; source-scoped `key` (`perm:` / `q:` / `lane:`) | `libs/frontend/canvas/src/lib/canvas-needs-you-queue.ts:57-110` | The aggregate dedups on `requestId`, not `key`. Canvas logic is left alone (cross-session Rail queue). |
| Compact card request handling: `targetsTab` (:621-641), `respond` → `AgentPermissionResponder.respondSession / respondLane` with stale checks (:478-513), `openLane` → `SESSION_CARD_ACTIONS` (:541-553) | `libs/frontend/chat/src/lib/components/molecules/compact-session/compact-session-card.component.ts` | Request panel response semantics are copied 1:1. Targeting comes from Part C `requestsForTab`. |
| `AgentPermissionResponder` | `libs/frontend/chat/src/lib/services/agent-permission-responder.ts:14` | Single response path for session and lane requests. |
| `SessionGitStatsStore.track(root, tabId): () => void` (:122), `stateFor(root)` (:156) | `libs/frontend/chat/src/lib/services/session-git-stats/session-git-stats.store.ts` | GIT section lifecycle (D-9) moves into the inspector. |
| canvas-session-details derives `sessionWorkingRoot(...)` and `track(root, tabId)` via `onCleanup` | `libs/frontend/canvas/src/lib/canvas-detail/canvas-session-details.component.ts:147, 176` | Moved verbatim into the GIT section. |
| `parseTodoList(input): readonly TodoItem[] \| null` (:67), `summarizeTodos` (:105) | `libs/frontend/chat-ui/src/lib/molecules/compact-session/compact-session-metrics.ts` | TODOS source. |
| `TabManagerService` view mode: `viewMode ?? 'full'` (:3109), set (:3101-3102) | `libs/frontend/chat-state/src/lib/tab-manager.service.ts:3089-3109` | Per-tab initial default by mode. |
| `TabState.status: SessionStatus` | `libs/frontend/chat-types/src/lib/chat-types.ts:559` | Orchestrator state input. |
| `TabState.workflow` absent on main | grep of `chat-types.ts` (only a comment at :537) | Do not reference it. Use the input instead (component 4). |
| `resolvedQuestionRequests` computed in chat-view (:1210); question cards rendered at `chat-view.component.html:171-183` | `chat-view.component.ts:1210` | `Answer` targets the C-16 card in this host. |
| Angular `22.1.7`; re-projection idiom `<ng-container ngProjectAs="[x]"><ng-content select="[y]" /></ng-container>` | `package.json`; `libs/frontend/chat/src/lib/settings/providers/routing-map.component.ts:134-135` | `[inspectorSection]` re-projection follows the repository idiom (component 5). |
| Webview initial budget: warning 2.5 MB, error 3.5 MB | `apps/ptah-extension-webview/project.json:59-61` | Inspector is `@defer`. Eager additions are kept to services only. |
| Status-ink utilities fall back to daisyUI (`var(--state-ink-run, oklch(var(--in)))` ...); anubis inks at :111-115 and :185-189 | `apps/ptah-extension-webview/tailwind.config.js:32-36, 111-115, 185-189` | 32 stock themes get `[data-theme]` blocks in styles.css. |
| `--bcm` per-theme blocks (e.g. `sunset` :266-268); anubis-light focus ring rule at styles.css:704-709 | `apps/ptah-extension-webview/src/styles.css` | Generated ink blocks go after the `--bcm` blocks. The ring override reuses those selectors. |
| `state-ink-contrast.spec.ts` (37 lines) checks only `['anubis','anubis-light']` from `tailwind.config.js` | `apps/ptah-extension-webview/src/app/state-ink-contrast.spec.ts:5, 16-37` | A presence guard is a trivial extension. The full 34-theme contrast math is not (Decision B-9). |

## Architecture decision

- **Chosen approach:** one chat-lib feature slice, `session-inspector`.
  - (a) An eager, light `SessionInspectorStore` holds the cross-surface slice: agents, requests, the needs-you count and the orchestrator state. It is keyed by tab id and built over Part C's `SessionAgentRosterService`.
  - (b) An eager per-tab `InspectorOpenStateService` holds the docked open choice.
  - (c) A component-scoped `InspectorShellController` handles width band, sheet, inert and focus return.
  - (d) A deferred `ptah-session-inspector` component tree holds the sections. TASK, TODOS and GIT compute their own section state inside the deferred chunk, using the shared `SectionState<T>` type.
  - (e) A narrow `@ptah-extension/tasks-ui/presentation` entry carries the status labels, the Stage ladder, document ordering and a board-free `TasksChangedFeed`.
- **Rationale:**
  - §9.1 requires one source for the header chip, toggle dot, orchestrator state, AGENTS and live line. The store gives that.
  - Sections that only render inside the inspector (TASK, TODOS, GIT) stay out of the initial bundle and fetch nothing while the inspector is closed (req 17.17).
  - Dependency direction is chat ← canvas.
- **Rejected alternatives:**
  - Aggregate in canvas, as §9.1 states: the chat-view and the header could not import it (cycle).
  - One monolithic aggregate including task, todos and git: it would put the `tasks:get` lifecycle and git tracking into the eager chunk and fetch while closed, which violates req 17.17.
  - Reusing `TasksStoreService`: it drags the board in and is gated by `surfaceOpen`.
  - `editor:openFile` for artifacts: Decision B-2.
- **Assumptions:**
  - **A1.** Part C ships `SessionAgentRosterService.roster(tabId)` and `requestsForTab(tabId)` with the agreed shape. Check: the Part C plan or files under `libs/frontend/chat/src/lib/services/session-agents/`.
  - **A2.** `PermissionRequest.agentToolCallId` exists (Part C cites `permission.types.ts:58`). Check: open that file. If it is absent, sub-agent permissions fall back to the Orchestrator row (§4.5 table).
  - **A3.** `ng-content` inside a `@defer` main block projects (component 5). Check: the first manual render in Electron or VS Code with a temporary projected `<section inspectorSection>` from a test host. If it does not project, use the fallback in Decision B-6.
- **Effect on existing code:**
  - `canvas-session-details.component.ts` and its spec are deleted. Their content moves to the inspector (D-1..D-9).
  - The Rail board swaps the component. The rest of its asides stays.
  - `tasks-store.service.ts` re-exports the moved constant (no behaviour change).
  - The compact card is untouched by Part B. Retiring its chat-host variant is Part A's job (A-6).

## Component specifications

### 1. Per-theme status-ink tokens (§8.2, decisions rows 15, D24)

- **Purpose:** status words, the accent and the focus ring reach ≥ 4.5:1 text and ≥ 3:1 UI in all 34 themes.
- **Responsibilities:**
  - Paste the 32 generated `[data-theme='x'] { --state-ink-run/need/err/done; --ptah-accent-ink }` blocks verbatim from design-spec §8.2 ("Generated block"), after the existing `--bcm` blocks.
  - In the same stock-theme scope `:where([data-theme]:not([data-theme^='anubis']))`:
    - add `--ptah-link: var(--ptah-accent-ink)`;
    - add the focus-ring `outline-color: var(--ptah-accent-ink)`, using the same selectors as the anubis-light rule at `styles.css:704-709`;
    - add `--ptah-check-edge: 70%`.
  - Add `--ptah-check-edge: 55%` to both anubis theme objects in `tailwind.config.js`. The pending-todo checkbox uses `border-[color-mix(in_srgb,oklch(var(--bc))_var(--ptah-check-edge),transparent)]`.
  - Leave the anubis inks unchanged.
- **Verified contracts:** `tailwind.config.js:32-36, 111-115, 185-189`; `styles.css:148-268` (`--bcm` blocks), `:704-709`.
- **Dependencies:** none (CSS).
- **Failure behaviour:** a theme without a block falls back to daisyUI (today's behaviour). The guard below fails on a missing block.
- **Quality:** 34/34 themes pass per the design audit table. Raw CSS is about 5.5 kB and counts toward the initial budget (see bundle).
- **Verification seam:** extend the existing `state-ink-contrast.spec.ts` with a presence guard only:
  - read the theme names the same way `base-content-muted.spec.ts` does;
  - assert each non-anubis name has a `[data-theme='name']` block in `styles.css` defining all four `--state-ink-*` and `--ptah-accent-ink`.
  - The stock-theme contrast math is postponed with T2 (Decision B-9).
- **Files:**
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\clean-session-view\apps\ptah-extension-webview\src\styles.css`
  - MODIFY `...\apps\ptah-extension-webview\tailwind.config.js`
  - MODIFY `...\apps\ptah-extension-webview\src\app\state-ink-contrast.spec.ts`

### 2. tasks-ui narrow entry `@ptah-extension/tasks-ui/presentation`

- **Purpose:** give the chat graph the TASK presentation helpers and a board-free `tasks:changed` feed, without the board or `TasksStoreService`.
- **Responsibilities:**
  - **`src/presentation.ts`** re-exports `TASK_STATUS_LABELS` and `WORKFLOW_ARTIFACTS` from `lib/task-presentation.ts`, plus the new symbols below.
  - **`lib/tasks-changed.ts`** holds `export const TASKS_CHANGED_MESSAGE_TYPE = 'tasks:changed'`, moved from the tasks store. `tasks-store.service.ts` imports it and re-exports it under the same name so `services.ts` stays byte-compatible.
  - **`lib/task-stage.ts`** (pure):
    - `TASK_STATUS_INK: Record<TaskStatus, string>`:
      - `in_progress` → `text-state-run`
      - `in_review` → `text-state-need`
      - `blocked` → `text-state-err`
      - `done` → `text-state-done`
      - `backlog` and `cancelled` → `text-base-content-muted`
    - `deriveTaskStage(artifacts: readonly string[]): TaskStage | null`. It returns the furthest present step of the ladder, or `null` when none exist:
      1. Requirements: `task-description.md`
      2. Design: `design-spec.md`, `visual-design-specification.md`, `design-handoff.md`
      3. Plan: `implementation-plan.md`
      4. Build: `batches.md` or legacy `tasks.md`, via `BATCHES_FILE` / `LEGACY_BATCHES_FILE` from shared
      5. Review: `code-style-review.md`, `code-logic-review.md`, `visual-review.md`
      6. Test: `test-report.md`
    - Filenames come from shared `DOC_FILES` constants wherever they exist. `task-presentation.ts:1-9` forbids hand-written per-task `*.md` literals, and a CI ratchet enforces it. Assumption: every ladder file is in `DOC_FILES`. Check: open `task-spec.contract.ts:74-96` and use only the constants. A ladder file absent from `DOC_FILES` is dropped from the ladder; it is not hard-coded.
    - `orderTaskDocuments(artifacts)`:
      1. `CARRIER_FILE`, only if present in `artifacts`; never added when absent;
      2. then the documents in `DOC_FILES` order;
      3. then `handoff-N.md` ascending by N (regex on the name, not a literal list);
      4. then the remaining entries alphabetically.
  - **`lib/services/tasks-changed-feed.service.ts`** (`@Injectable({providedIn:'root'})`, implements `MessageHandler`):
    - `handledMessageTypes = [TASKS_CHANGED_MESSAGE_TYPE]`;
    - `handleMessage` validates the payload shape (`workspaceRoot` is a string, `folderNames` is a string[] when present) and drops anything malformed;
    - exposes `readonly changes: Signal<{seq: number; change: TasksChangedNotification} | null>`;
    - no fetching and no timers.
- **Dependencies:** `@ptah-extension/shared`, `@ptah-extension/core` (the `MessageHandler` type). Direction tasks-ui → shared/core only.
- **Integration:** the webview `app.config.ts` adds `{ provide: MESSAGE_HANDLERS, useExisting: TasksChangedFeed, multi: true }`.
- **Failure behaviour:** a malformed push is ignored.
- **Verification seam:**
  - `npx nx typecheck tasks-ui`;
  - the existing `tasks-store.service.spec.ts` still passes, which proves the constant re-export.
- **Files:**
  - CREATE `...\libs\frontend\tasks-ui\src\presentation.ts`
  - CREATE `...\libs\frontend\tasks-ui\src\lib\tasks-changed.ts`
  - CREATE `...\libs\frontend\tasks-ui\src\lib\task-stage.ts`
  - CREATE `...\libs\frontend\tasks-ui\src\lib\services\tasks-changed-feed.service.ts`
  - MODIFY `...\libs\frontend\tasks-ui\src\lib\services\tasks-store.service.ts` (import and re-export the constant)
  - MODIFY `...\tsconfig.base.json` (add the path next to `:106-107`)
  - MODIFY `...\apps\ptah-extension-webview\src\app\app.config.ts`
  - If the tasks-ui `project.json` or `package.json` declares secondary entries for `services`, mirror it. Check: grep `services.ts` in `libs/frontend/tasks-ui/*.json`.

### 3. `SessionInspectorStore`: the one session-scoped aggregate (§9.1, req 12.1-12.2)

- **Purpose:** the single source for agent rows, open requests, needs-you count, orchestrator state and the live-line verb.
- **Responsibilities:**
  - `modelFor(tabId: string): Signal<SessionInspectorModel>`. A per-tab `computed` is cached in a `Map`. Entries are released by `forget(tabId)` when `TabManagerService` drops the tab: a `computed` over the open tab ids prunes the map, so no timer is needed.
  - **Inputs:**
    - Part C `roster.roster(tabId)` and `roster.requestsForTab(tabId)` (A1);
    - `AgentMonitorStore.agentsOwnedBySession` / `permissionQueue`, already inside the roster;
    - `TabManagerService` tab (`status`, `sessionStats`, `liveModelStats`, `viewMode`);
    - `chatStore` for nothing extra. Request targeting stays in Part C.
  - **Request merge** (pure helper `session-inspector-requests.ts`, `mergeInspectorRequests(...)`):
    - collect session permissions (`requestId = PermissionRequest.id`), questions (`requestId = AskUserQuestionRequest.id`) and lane queue entries (`requestId = entry.requestId`);
    - dedup on `requestId`, and keep the lane-owned entry when both exist (it carries the owner);
    - owner = the roster entry whose `openRequestIds` contains the id, else `orchestrator`;
    - FIFO by `timestamp` per owner.
    - Fallback identity when a source lacks one: `{source}:{ownerKey}:{kind}:{toolName}` (design §9.1). The repository has no such source today (all three verified sources carry ids), so the branch is a typed guard, not live logic.
  - **`needsYouCount`** = unique open `requestId`s + roster lanes whose status is `waiting` with an empty `openRequestIds`.
  - **Orchestrator state**, first match wins:
    1. `needs you` when orchestrator-owned requests are > 0;
    2. `waiting on N agents` when the tab is busy (`status` streaming or resuming) and N roster agents are running, waiting or queued;
    3. `working` when the tab is busy;
    4. `idle` otherwise.
    - Dot tone: run / need / idle, per §4.1.
  - **AGENTS order:** roster minus the orchestrator, sorted as rows with open requests or `waiting` first, then running and queued (newest `startedAt` first, null last), then done, failed and stopped (most recent `endedAt` first).
  - **AGENTS header meta:** `{active} active · {finished} finished`, counted from the same rows.
- **Typed view model** (`session-inspector.types.ts`):

  ```ts
  export type SectionStatus = 'loading' | 'ready' | 'partial' | 'unknown' | 'error';
  export interface SectionState<T> { readonly status: SectionStatus; readonly data: T | null; readonly error?: string }
  export interface InspectorRequest {
    readonly requestId: string; readonly kind: 'permission' | 'question';
    readonly source: 'session' | 'lane'; readonly ownerKey: string; // 'orchestrator' | sub:/cli:/bg: laneKey
    readonly ownerName: string; readonly agentId: string | null;
    readonly toolName: string | null; readonly command: string; // full text, never truncated
    readonly questionPreview: string | null; // first 60 chars for questions
    readonly timestamp: number;
  }
  export interface InspectorAgentRow { readonly agent: SessionAgent; readonly requests: readonly InspectorRequest[] }
  export type OrchestratorState = { kind: 'working' } | { kind: 'waiting'; agents: number } | { kind: 'needs-you' } | { kind: 'idle' };
  export interface OrchestratorCardModel {
    readonly model: string | null; readonly state: OrchestratorState;
    readonly contextPercent: number | null; readonly contextWindow: number | null;
    readonly tokens: number | null; readonly cost: number | null; readonly turns: number | null;
    readonly requests: readonly InspectorRequest[]; // orchestrator-owned
  }
  export interface SessionInspectorModel {
    readonly tabId: string; readonly sessionId: string | null;
    readonly orchestrator: OrchestratorCardModel;
    readonly agents: SectionState<{ rows: readonly InspectorAgentRow[]; active: number; finished: number }>;
    readonly requests: readonly InspectorRequest[]; // unique, FIFO
    readonly needsYouCount: number;
  }
  // Inspector-only section models (computed in the deferred chunk, same SectionState contract):
  export interface TaskSectionData { readonly lead: { taskId: string; missing: boolean }; readonly task: TaskSpecDetail | null;
    readonly stage: TaskStage | null; readonly documents: readonly string[]; readonly related: readonly { taskId: string; title: string | null; status: TaskStatus | null }[] }
  export interface TodosSectionData { readonly items: readonly TodoItem[] | null; readonly done: number; readonly total: number; readonly activeTitle: string | null }
  export interface GitSectionData { readonly branch: string | null; readonly additions: number; readonly deletions: number; readonly partial: boolean; readonly isRepo: boolean }
  ```

  Unknown numbers stay `null`. The template prints `—` and never `0` (req 7.5).
- **Verified contracts:** `canvas-needs-you-queue.ts:57-110`; `agent-monitor.store.ts:394-442`; `agent-permission.types.ts:26-37`; `chat-types.ts:559`.
- **Dependencies:** chat → chat-state, chat-streaming, chat-types, shared. Part C's roster is in the same lib.
- **Integration (consumers):**
  - Part A header chip and live line read `modelFor(tabId)().needsYouCount` and `.orchestrator.state`.
  - Part C dock may read `requests` for the needs-you priority.
  - Rail and the inspector sections read `modelFor`.
- **Failure behaviour:**
  - A tab id with no tab gives a model with `agents.status='unknown'` and zero counts.
  - The roster is pure and has no async failure.
- **Quality:** O(agents + requests) per recompute. No timers. The duration tick lives in the row component (running rows only, §4.2).
- **Verification seam:**
  - `mergeInspectorRequests` is pure (future T2 unit seam);
  - `npx nx test chat` keeps existing suites green.
- **Files:**
  - CREATE `...\libs\frontend\chat\src\lib\services\session-inspector\session-inspector.types.ts`
  - CREATE `...\session-inspector\session-inspector-requests.ts`
  - CREATE `...\session-inspector\session-inspector.store.ts`
  - CREATE `...\session-inspector\index.ts`
  - MODIFY `...\libs\frontend\chat\src\lib\services\index.ts` (append-only export lines; Part C appends there too)

### 4. Open state: `InspectorOpenStateService` and `InspectorShellController` (§2.1, §8.3, rows 19 and 36, D42, D43)

- **Purpose:**
  - remember the per-tab docked choice;
  - own the width band and the modal sheet;
  - give every close path one routine.
- **The reconciled rule** (§3.8, §8.3 and initial-open agree):
  1. **Docked** (shell ≥ 960 px): `open = manual ?? initialDefault`. Here `initialDefault = initialOpen ?? (viewMode === 'full')`. `initialOpen` is the workflow input (D42).
     - `manual` is stored per tab as `{open, mode}`, in memory only. A stored choice whose `mode` differs from the tab's current `viewMode` counts as absent. That is how a mode change resets it (req 6.8) without a hook into `TabManagerService`.
  2. **Overlay** (< 960 px): the sheet is closed on load, on every tab or session switch and on resize into the overlay band. It opens only by toggle (req 6.9, §8.3 Default). Sheet open/close is ephemeral and is never written to the per-tab docked choice. The toggle shows the 7 px dot:
     - `bg-state-need` when `needsYouCount > 0`;
     - else `--sel` when `initialOpen === true` (D43).
  3. **Docked toggles** write `manual = {open, mode}` for the tab. Tab switches restore it (req 6.7).
  4. **Resize docked → overlay** (band change only): close the sheet via `closeInsp()` (path 6). The docked choice is kept.
  5. **Resize overlay → docked while the sheet is open:**
     - write `manual = {open: true, mode}`, so the inspector stays;
     - remove `inert` and dialog semantics;
     - keep focus.
     - While the sheet is closed, the docked state follows rule 1.
- **`InspectorOpenStateService`** (`providedIn: 'root'`, chat lib):
  - `dockedOpen(tabId, mode, initialOpen: boolean | null): boolean`
  - `setDocked(tabId, mode, open)`
  - `forget(tabId)`
- **`InspectorShellController`** (`@Injectable()`, provided in the `providers` of `ChatViewComponent` and `CanvasRailBoardComponent`).
  - **API:**
    - `attach(shell: HTMLElement, opener: () => HTMLElement | null, title: () => HTMLElement | null)`;
    - `band: Signal<'docked' | 'sheet' | 'full-sheet'>`, from a `ResizeObserver` that writes only on band change (≥ 960, 640-959, < 640);
    - `tab: input-fed signal {tabId, mode, initialOpen}`;
    - `isOpen: Signal<boolean>`, `isModal: Signal<boolean>`, `showDot: Signal<'need' | 'sel' | null>`, `toggleLabel` (`Show session details` / `Hide session details`);
    - `toggle()`;
    - `closeInsp(target?: HTMLElement | 'opener')`;
    - `onTabChanged()`, which calls `closeInsp()` with no target when modal.
  - **Inert handling:** sets `inert` on the main column through a signal the host binds.
  - **Focus:**
    - remembers the opener on open;
    - focuses `Close session details` immediately on open;
    - Tab wrap is a keydown handler on the sheet;
    - `Esc` closes the innermost layer: an open request panel first (the panel owns its own Esc and stops propagation), then the sheet.
  - **`closeInsp` fallback chain:** target → opener when connected and visible (`isConnected && offsetParent !== null`) → `h1[tabindex=-1]` of the session header (Part A provides it) → never `body`.
  - **Release:** `ResizeObserver.disconnect()` on `DestroyRef`.
- **Contract to Part A:** the header toggle injects `InspectorShellController` and binds `[attr.aria-pressed]`, `toggleLabel`, `showDot`, `(click)=toggle()`. Its element is the opener. The session-title `h1` gets `tabindex="-1"`.
- **648 hook-up (not on main):** `ChatViewComponent` gets `inspectorInitialOpen = input<boolean | null>(null)`.
  - Today nothing binds it, so the mode default applies.
  - After 648 lands, its session-embed binds `[inspectorInitialOpen]="tab.workflow ? true : null"`. That is one line in 648's template; 677 adds no reference to `TabState.workflow`.
- **Failure behaviour:** without `ResizeObserver` (not expected in Chromium 105+), band falls back to `docked`.
- **Verification seam:**
  - keyboard checks of §8.3 paths 1-7 at a 400 px shell, run in the visual review;
  - typecheck of chat.
- **Files:**
  - CREATE `...\libs\frontend\chat\src\lib\services\session-inspector\inspector-open-state.service.ts`
  - CREATE `...\session-inspector\inspector-shell.controller.ts`

### 5. `ptah-session-inspector` component tree (deferred; §4, §4.1-4.6, §4.8)

- **Purpose:** render the inspector body. The same component serves the chat-view (docked or sheet) and the Rail board aside.
- **Public contract** (`SessionInspectorComponent`, selector `ptah-session-inspector`, standalone, OnPush):
  - **Inputs:**
    - `tabId = input.required<string>()`;
    - `presentation = input<'docked' | 'sheet' | 'embedded'>('docked')`. `sheet` sets `role="dialog" aria-modal="true" aria-label="This session"`; the others render `<aside aria-label="This session">`;
    - `hasLaneSurface = input<boolean>(false)`.
  - **Outputs:**
    - `closeRequested = output<void>()`;
    - `laneRequested = output<string>()` (laneKey);
    - `answerRequested = output<string>()` (requestId).
  - **Content projection:** `<ng-content select="[inspectorSection]" />` after the Orchestrator card and before AGENTS. It renders no wrapper, so an empty slot leaves no box (§4.8).
  - **Header:** 48 px, `<h2>` "This session", and a close `x` button with aria-label `Close session details`.
- **Sections** (one standalone child component each, all in the same deferred chunk). Order: Orchestrator, slot, AGENTS, TASK, TODOS, GIT.
  1. **`inspector-orchestrator-card`** (§4.1, req 7):
     - reads `model.orchestrator`;
     - `<progress>` with ink thresholds 80 / 95, and `aria-valuetext`, including the unknown case;
     - stats `dl`;
     - the `Usage and limits` disclosure shows the same sources as chat-view `resolvedCompactionCount / resolvedStatsLimits / resolvedSessionBudget` (C-3..C-5). The host passes them as an optional `usage` input; the Rail board passes `null` and the disclosure is hidden;
     - orchestrator-owned requests render with the same request line and panel as AGENTS rows.
  2. **`inspector-agents-section`** (§4.2, req 8, 9):
     - a list of rows. Each row has a full-width `<button class="agent__main">` (selects; emits `laneRequested` only when `hasLaneSurface`), a Part C `ptah-agent-avatar` (size 32), name, status word and duration;
     - the duration ticks once per second only while at least one running row is visible. One section-level `interval` (not one per row) is started and cleared by an effect;
     - a sibling permission or question line with `Review` / `Answer`, `+N more`, and at most one open panel per row;
     - empty and skeleton states.
  3. **`inspector-request-panel`** (§4.5):
     - `Allow` / `Deny` go through `AgentPermissionResponder.respondSession(request, decision, tabId)` or `respondLane(agentId, requestId, decision, reason)`, with the compact card's stale re-checks (`compact-session-card.component.ts:478-513`);
     - while sending: `aria-busy`, both buttons disabled, a duplicate activation for the same `requestId` is ignored;
     - a send failure shows `Could not send your response` with `Retry` (same decision, same `requestId`);
     - when the request disappears from the store while the panel is open, the panel shows the `request-closed-elsewhere` status with `Close`;
     - `Open lane` is shown only when `hasLaneSurface`.
  4. **`inspector-task-section`** (§4.6, req 17), with the component-scoped `SessionTaskReader` (component 6).
  5. **`inspector-todos-section`** (§4.3, req 10):
     - `parseTodoList` over the latest `TodoWrite` result in the tab's messages;
     - the count-only fallback uses `summarizeTodos`;
     - show 8 items with in-progress first, then `+N more`;
     - the pending box uses `--ptah-check-edge`.
     - Assumption: canvas-session-details already locates the latest `TodoWrite` input (`:125-143`). Check: move that locator verbatim.
  6. **`inspector-git-section`** (§4.4, req 11):
     - `sessionWorkingRoot(...)` and `onCleanup(gitStore.track(root, tabId))`, moved from `canvas-session-details.component.ts:144-178`;
     - `stateFor(root)`;
     - U+2212 minus sign;
     - the ahead/behind pair is never rendered (G3);
     - `Retry reading git status` re-calls the store refresh. Assumption: the store exposes a refresh or retrack method. Check: the `session-git-stats.store.ts` API (`:93-160`). If none exists, Retry re-runs `track` (untrack, then track).
     - `Review changes` calls the existing review surface opener. Assumption: the method used by today's chat-view or git-ui entry; the implementer cites it, or hides the link when none exists in the host.
- **Answer routing:** `answerRequested(requestId)` goes to the host. The chat-view:
  - finds the C-16 card by `[attr.data-request-id]` (added on `ptah-question-card` in `chat-view.component.html:171-183`);
  - closes the sheet first via `closeInsp(card first option)`, the path-7 exception;
  - if the card is not found after a 1 s wait from activation, sends the row error back to the inspector through `SessionInspectorStore.reportAnswerMiss(requestId)`, a transient signal keyed by `requestId` and cleared on `Retry` or success.
  - Lane-owned questions never open the lane first (decisions row 24).
  - In the Rail board host the card lives in the pane's chat-view. The board forwards `answerRequested` to the focused pane's chat-view through `CanvasDetailService`. Assumption: no such forwarding exists today. Check `canvas-detail.service.ts`. If it is absent, the Rail board host emits nothing and the row shows the miss error. Accepted degradation; the request stays counted.
- **Live region:** one polite `role="status"` region in the inspector for request outcomes only (§4.5). TASK and status changes never announce (§4.6).
- **Re-projection path:** session-embed (648) → `<ptah-chat-view><section inspectorSection>...</section></ptah-chat-view>` → chat-view template:

  ```html
  @defer (...) { <ptah-session-inspector ...>
    <ng-container ngProjectAs="[inspectorSection]"><ng-content select="[inspectorSection]" /></ng-container>
  </ptah-session-inspector> }
  ```

  The projected nodes are created by the parent eagerly, as Angular always does for projected content. Only the inspector code is deferred.
- **Quality:**
  - targets ≥ 24 × 24;
  - the ring of §8.4 on every native button;
  - status never on surface-3 and no tinted status fills (R1, R2);
  - `prefers-reduced-motion` removes shimmer and transitions;
  - `@container` CSS, no viewport queries.
- **Verification seam:**
  - typecheck and lint of chat;
  - visual review against prototype states (`ask=*`, `task=*`, `body=*`, `narrow-400-overlay-focus`).
- **Files:**
  - CREATE `...\libs\frontend\chat\src\lib\components\organisms\session-inspector\session-inspector.component.ts` (+ `.html`)
  - CREATE `...\session-inspector\inspector-orchestrator-card.component.ts`
  - CREATE `...\session-inspector\inspector-agents-section.component.ts`
  - CREATE `...\session-inspector\inspector-request-panel.component.ts`
  - CREATE `...\session-inspector\inspector-task-section.component.ts`
  - CREATE `...\session-inspector\inspector-todos-section.component.ts`
  - CREATE `...\session-inspector\inspector-git-section.component.ts`
  - MODIFY `...\libs\frontend\chat\src\index.ts` (export `SessionInspectorComponent`, `InspectorShellController`, `SessionInspectorStore`, types). This is a value export used only inside `@defer` by hosts. It is not referenced eagerly anywhere else, so it stays a lazy chunk (precedent comment `canvas-rail-board.component.ts:26-28`).

### 6. `SessionTaskReader` (TASK data, req 17)

- **Purpose:** resolve the lead task link, read the task, refresh it live and open documents.
- **Scope:** `@Injectable()` provided in `inspector-task-section`'s `providers`. It exists only while the inspector renders, so a closed inspector fetches nothing (req 17.17).
- **Link resolution:**
  - `session = chatStore.sessions().find(s => s.id === tab.claudeSessionId)`.
  - Link state is `unknown` (section not rendered, D27) when any of these holds:
    - `!chatStore.organizationAvailable()` (VS Code);
    - the session is not in the loaded page;
    - `organization` is absent.
  - `tasks = session.organization.tasks`.
  - Lead = the entry with `role === 'primary'`, else the entry with the largest `createdAt` (req 17 Terms and PM-12, which override §4.6 "first in stored order"; Decision B-7).
  - Related = the rest, ordered by `createdAt` descending.
  - Re-evaluates on every `sessions()` change. That covers `session:organizationChanged` → debounced `session:list` (req 17.15).
- **Read:**
  - `rpcCall(vscode, 'tasks:get', {workspaceRoot, taskId: lead.taskId})`;
  - `workspaceRoot` = the tab's `workspacePath`, else `appState.workspaceInfo()?.path`;
  - one call in flight per task; a newer trigger during flight sets `dirty` and re-reads once after (req 17.14);
  - latest result wins (sequence number).
- **States:**
  - `missing: true` or `task: null` → `Task folder not found` (no Retry);
  - RPC failure → `error` with `Retry loading task`;
  - success with no artifacts → `partial`;
  - first load → `loading`;
  - a refresh keeps `ready` content (no skeleton).
- **Related titles:** shown as ID only. Titles are not fetched per related task (no N extra calls). `title: null` renders the ID alone. This is reversible (D30 spirit). Req 17.10 asks for "IDs and titles", so this is recorded as Decision B-8.
- **Live refresh:**
  - an `effect` on `TasksChangedFeed.changes()`;
  - act only when `normalize(change.workspaceRoot) === normalize(workspaceRoot)` and (`!folderNames` or `folderNames.includes(task.folderName)`) (req 17.11 and 17.13);
  - 300 ms trailing debounce via one `setTimeout`, cleared on destroy.
- **Open:** `openDocument(file, origin)`:
  - refuse when `!task.artifacts.includes(file)` and `file !== CARRIER_FILE`. Traversal guard, the same as `tasks-store.service.ts:1360`;
  - compose `${root.replace(/[\\/]+$/, '')}/.ptah/specs/${task.folderName}/${file}`;
  - `await inject(FILE_LINK_OPENER).open({path, origin})`;
  - a rejection sets a row-level `openError {file}` with `Retry`; focus stays on the row button;
  - a user cancel resolves quietly (router behaviour).
- **Files:** CREATE `...\libs\frontend\chat\src\lib\components\organisms\session-inspector\session-task-reader.ts`

### 7. Host wiring: ChatViewComponent (shared file with Part A)

- **Part B's edits only:**
  - **(a) Root:** `<div class="cs-shell flex h-full w-full relative">` with `container-type: inline-size` (component CSS), plus `controller.attach(...)` in `afterNextRender`.
  - **(b) Main column:** `[attr.inert]="shell.isModal() ? '' : null"`.
  - **(c) Inspector block,** after the main column and before the existing dock or agent panel, guarded by `hostsInspector()`:

    ```html
    @if (hostsInspector() && resolvedActiveTab(); as tab) {
      @if (shell.isOpen()) {
        @if (shell.isModal()) { <div class="cs-scrim" aria-hidden="true" (click)="shell.closeInsp()"></div> }
        @defer (on immediate) {
          <ptah-session-inspector [tabId]="tab.id"
            [presentation]="shell.isModal() ? 'sheet' : 'docked'"
            [hasLaneSurface]="hasLaneSurface" (closeRequested)="shell.closeInsp()"
            (laneRequested)="openLaneFromInspector($event)" (answerRequested)="focusQuestionCard($event)">
            <ng-container ngProjectAs="[inspectorSection]"><ng-content select="[inspectorSection]" /></ng-container>
          </ptah-session-inspector>
        } @placeholder { <aside class="w-[336px]" aria-hidden="true"></aside> }
      }
    }
    ```

  - **(d) `.ts` additions:**
    - `providers: [InspectorShellController]`;
    - `hostsInspector = computed(() => !this._sessionContext && !(this._forcedCard?.() ?? false))`;
    - `hasLaneSurface = inject(SESSION_CARD_ACTIONS, {optional: true}) !== null`, which is false in the main panel today;
    - `inspectorInitialOpen` input (component 4);
    - an effect that feeds `{tabId, viewMode, initialOpen}` to the controller and calls `onTabChanged()` on tab change;
    - `openLaneFromInspector(key)`, which uses `SESSION_CARD_ACTIONS.openLane` when present and then calls `closeInsp(laneTitle)` (path 4);
    - `focusQuestionCard(requestId)`.
  - **(e)** `[attr.data-request-id]="request.id"` on `ptah-question-card` (C-16 block, `:171-183`).
- **Ownership note:** Part A owns everything inside the main column (header, thread, composer, compact-card retirement). Part B owns only the root attributes, (b), (c), (e) and the listed `.ts` members.
- **Files:**
  - MODIFY `...\libs\frontend\chat\src\lib\components\templates\chat-view.component.html`
  - MODIFY `...\chat-view.component.ts`
  - MODIFY the component CSS (`chat-view.component.css` or `styles` array; check which exists)

### 8. Host wiring: Rail board (D-1..D-11, req 6.5)

- **Responsibilities:**
  - In the three asides (`canvas-rail-board.component.ts:184-245`), replace `<ptah-canvas-session-details [tabId]>` with `<ptah-session-inspector [tabId] presentation="embedded" [hasLaneSurface]="true" (laneRequested)="detail.selectLaneFor(id, $event)">`, keeping `@defer (on idle)` (D-10) and the existing placeholders.
  - The board's own `Close details` button is replaced by the inspector's close (`closeRequested` → `toggleDetails()` / `closeSplitDetails()`).
  - **Req 6.5:** when `layout.containerWidth() < 400` in the `sm` band:
    - hide the 44 px `Open details` button;
    - the focus header's existing details button opens the inspector instead (`detailsRequested`, `canvas-focus-header.component.ts:63, 111`). Assumption: that button is gated to split mode today. Check its `@if` and widen it to `width < 400`;
    - the inspector renders as a full-width sheet (`presentation="sheet"`, `absolute inset-0`) under a board-level `InspectorShellController`. The controller makes the board's pane region inert and returns focus to the header details button.
  - Delete `canvas-session-details.component.ts` and `.spec.ts`. Update `canvas-rail-board.component.spec.ts` only where it references the deleted selector (an existing spec, not a new one).
- **Files:**
  - MODIFY `...\libs\frontend\canvas\src\lib\canvas-rail\canvas-rail-board.component.ts`
  - MODIFY `...\canvas-rail-board.component.spec.ts`
  - MODIFY `...\canvas-focus-header.component.ts` (gate only)
  - DELETE `...\libs\frontend\canvas\src\lib\canvas-detail\canvas-session-details.component.ts`
  - DELETE `...\canvas-session-details.component.spec.ts`

## Parity row → location map

| Rows | New location |
| --- | --- |
| A-8, A-9 | AGENTS rows (roster from Part C) and `laneRequested` |
| A-10, A-11 | `inspector-request-panel` (`Allow` / `Deny`, `Open lane`) |
| A-12 | `Answer` → `focusQuestionCard` |
| A-13 | Part C `requestsForTab` |
| A-15 | Orchestrator card, TODOS, GIT |
| C-2..C-5 | stats strip unchanged; Orchestrator card plus the `Usage and limits` disclosure |
| C-15, C-16 | unchanged surfaces; shared `requestId` |
| D-1 | inspector `aside` / `h2` |
| D-2..D-5 | Orchestrator card |
| D-6 | TODOS |
| D-7, D-8 | GIT |
| D-9 | GIT `track` lifecycle |
| D-10 | `@defer` kept in both hosts |
| D-11 | Rail aside kept ≥ 400 px; sheet < 400 px |
| background-agent-strip | not Part B (Part A / Part C, req 4.7); its agents appear in AGENTS through the roster |

## Integration architecture

- **Data flow:**
  1. stores (agent monitor, background, permission handler, tab manager)
  2. → Part C roster
  3. → `SessionInspectorStore.modelFor(tabId)`
  4. → header (Part A), dock (Part C), inspector sections

  Organization: `session:organizationChanged` → `session:list` → `chatStore.sessions()` → `SessionTaskReader` → `tasks:get`. Changes: `tasks:changed` → `TasksChangedFeed` → reader (filter, debounce, single-flight). Open: row → `FILE_LINK_OPENER` → Electron dock spot editor, or VS Code `file:open`.
- **State:**
  - per-tab docked choice: root service, in memory;
  - sheet state and opener: per host controller;
  - task data: per inspector instance;
  - aggregate: root, per-tab computed, pruned on tab close.
- **External boundaries:**
  - push payloads are validated in the feed;
  - artifact filenames are validated against `task.artifacts` before the path is composed;
  - the backend re-authorizes every path (`file:open` uses `FileLinkRootPolicy`; Electron uses the review backend).
  - No path comes from user text.
- **Failure and rollback:**

  | Failure | Behaviour |
  | --- | --- |
  | Organization unavailable or session not loaded | TASK absent |
  | `tasks:get` fails | error + Retry; rest of the inspector usable |
  | Open fails | row error + Retry |
  | Response send fails | request stays, error + Retry |
  | Request resolved elsewhere | closed-elsewhere status |
  | Git read fails | error + Retry |
  | No repo | `Not a git repository` |
  | `@defer` chunk fails | `@error` block: `Session details failed to load` (`role="alert"`), like the display dock (`chat-view.component.html:300-312`) |

- **Observability:**
  - reader failures `console.error` once per failure with a `[SessionTaskReader]` prefix (precedent `FileLinkRouter`);
  - responder failures surface in the panel.

## Architecture-level quality requirements

- **Functional:**
  - header chip, toggle dot, orchestrator state and AGENTS agree in `ask=multi` / `ask=question` (G4);
  - TASK follows req 17.1-17.17 with the decisions below;
  - open-state rules 1-5 of component 4.
- **Performance:**
  - the initial bundle stays < 3.5 MB.
  - Estimated eager additions:

    | Item | Size |
    | --- | --- |
    | store + open state + controller | about 4-6 kB minified |
    | feed | about 0.5 kB |
    | theme CSS | about 5.5 kB raw |
    | task-presentation | 0 (already eager via `TasksStore`) |

  - Deferred inspector chunk: about 30-45 kB. Deleting `canvas-session-details` removes an existing lazy chunk.
  - At about 3.49 MB today this is about 10 kB from the limit. **Risk:** measuring needs a `build`, which CLAUDE.md allows only on user request (see Clarifications).
  - No per-row timers; one ticking interval per AGENTS section only while running rows exist; `ResizeObserver` disconnected on destroy.
- **Security:** traversal guard on artifact names; no new RPC; no new message listener.
- **Maintainability:**
  - chat ← canvas direction kept;
  - tasks-ui board stays out of chat through the narrow entry;
  - no edits to tab-bar, tab-item, canvas-rail-card, app-shell or canvas-detail-transcript;
  - no `TabState.workflow` reference.
- **Testability:**
  - no new spec files (row 3);
  - existing suites of chat, canvas, tasks-ui and ptah-extension-webview stay green;
  - pure seams for T2: `mergeInspectorRequests`, `deriveTaskStage`, `orderTaskDocuments`, `InspectorOpenStateService`.

## Decisions

| # | Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- | --- |
| B-1 | Aggregate, open state and inspector live in the chat lib. Part C's roster also lives in chat (agreed by message). | canvas (§9.1 text) / chat | canvas → chat 26 imports; chat never imports canvas; chat-view is the host (design-spec line 1187) | yes |
| B-2 | Artifact open goes through `FILE_LINK_OPENER` | `editor:openFile` with a detected target / `FILE_LINK_OPENER` | The board uses it (`tasks-store.service.ts:1351-1376`). Electron opens in the git dock spot editor, which is literally the git sidebar's viewer. VS Code opens natively (`file-link-router.service.ts:95-170`). `editor:openFile` needs target detection and leaves the app. | yes |
| B-3 | Chat-view hosts the inspector only without `SESSION_CONTEXT`. Rail panes use the Rail board aside. Grid tiles have none. | an inspector in every chat-view / host split | Two inspectors would show in Rail; D-11 keeps the board aside | yes |
| B-4 | Overlay sheet state is never persisted per tab. Per-tab manual choice applies to the docked aside only. Tab switch closes a modal sheet without reopening. | persist sheet state | §8.3 Default row, D43, req 6.9 | yes |
| B-5 | Workflow initial-open is a `ChatViewComponent.inspectorInitialOpen` input. 648 binds it in one line. | read `TabState.workflow` | field absent on main; row 34 forbids depending on 648 | yes |
| B-6 | `[inspectorSection]` re-projects through `ng-container ngProjectAs` inside `@defer` (A3). Fallback if it fails: an `INSPECTOR_SECTIONS` multi-token of `{kind, component}`, rendered with `NgComponentOutlet` in the slot, keyed by the tab's workflow kind input. | registry first | repository idiom `routing-map.component.ts:134-135`; projection keeps 648's template-driven sections | yes |
| B-7 | Lead task when there is no primary: most recent `createdAt`. | §4.6 "first in stored order" | req 17 Terms and PM-12 (user-gated) outrank the design spec | yes |
| B-8 | Related tasks show ID and stored status only (no title fetch). No-link and unknown both render no section (D27). | fetch each related task / show `No task linked` (req 17.6) | D27 is the later, gated design decision (Gate 1.7); the N-call fan-out has no requirement-level need beyond 17.10's titles | yes. Clarification Q2 asks the user for the conflicting text. |
| B-9 | Contrast guard: presence check only now; 34-theme math postponed with T2 | full math in `state-ink-contrast.spec.ts` | row 3 testing postponed; full math needs the daisyUI parsing that `base-content-muted.spec.ts` carries | yes |
| B-10 | Questions are owned by the Orchestrator row unless a future `laneKey` exists (Part C roster) | parse lane ownership | §4.5 rule "laneKey when present"; no laneKey source verified | yes |

## Clarifications Needed

1. Initial-bundle measurement: the plan adds about 10 kB eager against a budget about 10 kB from its 3.5 MB error. Verifying it needs one `npx nx build ptah-extension-webview`. CLAUDE.md allows that only when the user asks.
   - (Recommended) Allow one build after the last Part B batch.
   - Skip the measurement and rely on the pre-push `validate-deps` gate.
2. Req 17.6 says "show `No task linked to this session`". Design D27 (Gate 1.7) says render nothing.
   - (Recommended) Follow D27 (no section).
   - Follow req 17.6 (a quiet row).

## Team-leader handoff

- **Recommended executors:**
  - frontend-developer for components 1-8. All are Angular or CSS in webview libs.
  - Component 1 is mechanical (paste the block).
- **Complexity:** HIGH. Reasons:
  - the focus and overlay state machine across two hosts;
  - the cross-part contracts with A and C;
  - a shared template file with Part A.
- **Dependencies and ordering:**
  - Component 2 before 6.
  - Part C roster (`session-agents/`) before component 3.
  - Component 3 before 4, then 5 and 6 (they share types), then 7 and 8.
  - Part A header binds to the component 4 API. Component 4 must exist before the Part A header batch, or Part A stubs it.
  - Components 7 and 8 last.
- **Parallel-safe work:**
  - component 1 (app styles);
  - component 2 (tasks-ui and tsconfig);
  - components 3-6 (new chat files only, after Part C);
  - component 8 (canvas) is disjoint from 7.
- **Files that may also be touched by other parts:**
  - Part A: `chat-view.component.html`, `chat-view.component.ts` (root and main-column attributes; question-card attribute), the header component (consumes the controller).
  - Part C: `libs/frontend/chat/src/lib/services/index.ts` (append-only), `libs/frontend/chat/src/index.ts`, `libs/frontend/chat-ui/src/index.ts` (avatar, consumed only).
  - 648: `canvas-focus-header.component.ts` (decisions row 35, workflow badge).
- **Files affected:**
  - **CREATE**
    - `libs/frontend/tasks-ui/src/presentation.ts`
    - `libs/frontend/tasks-ui/src/lib/tasks-changed.ts`
    - `libs/frontend/tasks-ui/src/lib/task-stage.ts`
    - `libs/frontend/tasks-ui/src/lib/services/tasks-changed-feed.service.ts`
    - `libs/frontend/chat/src/lib/services/session-inspector/{session-inspector.types,session-inspector-requests,session-inspector.store,inspector-open-state.service,inspector-shell.controller,index}.ts`
    - `libs/frontend/chat/src/lib/components/organisms/session-inspector/{session-inspector.component.ts,.html,inspector-orchestrator-card,inspector-agents-section,inspector-request-panel,inspector-task-section,inspector-todos-section,inspector-git-section,session-task-reader}`
  - **MODIFY**
    - `apps/ptah-extension-webview/src/styles.css`
    - `apps/ptah-extension-webview/tailwind.config.js`
    - `apps/ptah-extension-webview/src/app/state-ink-contrast.spec.ts`
    - `apps/ptah-extension-webview/src/app/app.config.ts`
    - `tsconfig.base.json`
    - `libs/frontend/tasks-ui/src/lib/services/tasks-store.service.ts`
    - `libs/frontend/chat/src/lib/services/index.ts`
    - `libs/frontend/chat/src/index.ts`
    - `libs/frontend/chat/src/lib/components/templates/chat-view.component.{html,ts}` (+ its CSS)
    - `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.ts`
    - `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.spec.ts`
    - `libs/frontend/canvas/src/lib/canvas-rail/canvas-focus-header.component.ts`
  - **DELETE**
    - `libs/frontend/canvas/src/lib/canvas-detail/canvas-session-details.component.ts`
    - `libs/frontend/canvas/src/lib/canvas-detail/canvas-session-details.component.spec.ts`
- **Verification points:**
  - Confirm assumptions A1-A3. Also confirm the ladder files in `DOC_FILES`, the git store retry method, the `Review changes` opener, and the focus-header gate.
  - Run one heavy check at a time:
    - `node .ptah/tmp/check-run.mjs <label> -- npx nx test <project> --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`
    - the same with `npx nx typecheck <project>` and `npx nx lint <project>`
    - for projects `tasks-ui`, `chat`, `canvas`, `ptah-extension-webview` (only those changed in the batch).
  - Lint must show no `@nx/enforce-module-boundaries` error for chat → `@ptah-extension/tasks-ui/presentation`.
  - No new spec files.

## Open checks

Each item is unresolved by source reading in this pass; the implementer resolves it before or during the named component.

| # | Check | Component | How to resolve |
| --- | --- | --- | --- |
| O1 | Part C roster API (`roster(tabId)`, `requestsForTab(tabId)`, `SessionAgent` shape) as agreed by message | 3 | read Part C plan / created files |
| O2 | `PermissionRequest.agentToolCallId` exists (`permission.types.ts:58` per Part C) | 3 | open the file; else sub-agent permissions fall back to the Orchestrator row |
| O3 | `ng-content` re-projection inside `@defer` renders projected nodes | 5, 7 | first manual render with a temporary projected section; else Decision B-6 fallback |
| O4 | every Stage-ladder filename is in shared `DOC_FILES` (no hand-written `*.md` literal, CI ratchet) | 2 | `task-spec.contract.ts:74-96` |
| O5 | tasks-ui secondary-entry declaration beyond `tsconfig.base.json` (project/package json) | 2 | grep `services.ts` in `libs/frontend/tasks-ui/*.json` |
| O6 | `SessionGitStatsStore` refresh/retry method; `Review changes` opener per host | 5 | `session-git-stats.store.ts:93-160`; current review-surface entry |
| O7 | latest-`TodoWrite` locator in `canvas-session-details.component.ts:125-143` (move verbatim) | 5 | read before deleting the file |
| O8 | `canvas-focus-header` details button gate (split-only today?) | 8 | read `canvas-focus-header.component.ts:55-70` |
| O9 | Rail forwarding of `answerRequested` to the focused pane's chat-view | 5, 8 | `canvas-detail.service.ts`; else accepted degradation (row error, request stays counted) |
| O10 | `TabState.workspacePath` and `claudeSessionId` field names | 6 | `chat-types.ts` TabState (compact card reads `workspacePath` at `compact-session-card.component.ts:359-361`) |
| O11 | chat-view component CSS location (`styleUrl` vs inline `styles`) | 7 | `chat-view.component.ts` decorator |
| O12 | initial-bundle headroom after eager additions (~10 kB) | all | one webview build only if the user allows (Clarification 1) |
