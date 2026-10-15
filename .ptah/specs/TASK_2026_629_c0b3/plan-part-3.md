# Implementation Plan - TASK_2026_629_c0b3 - Part 3 (steps 6-7, performance)

## Inputs and constraints

- Requirements used: `.ptah/specs/TASK_2026_629_c0b3/task-description.md` (glossary `:91-96`, step 6 `:180-194`, step 7 `:196-208`, NFR `:210-227`, constraints `:229-239`, ownership `:243-292`).
- Scope: delivery steps 6 and 7, and the performance measurement procedure. Steps 1-5 are in plan parts 1 and 2. This part does not plan them.
- Not read (tool budget): `context.md`, `prototypes/01-board.html`, `shared.js`. Effect: the visual layout of the queue popover follows the existing canvas header controls. A designer or the step-1 architect can adjust markup. No contract depends on the prototype.
- Fixed decisions from the TASK_2026_628 owner: no edits to `AgentMonitorStore`, agent-monitor output paths, `tab-manager.service.ts` `updateTabInternal` region, `stream-presentation-store.service.ts`, `batched-update.service.ts`, `chat-lifecycle.service.ts`, canvas tile and Gridstack adapter leak areas. Part 3 does not touch `canvas-tile.component.ts` or the grid adapter.
- Angular 22: standalone, `OnPush`, `inject()`, signals. No `content-visibility`. No new host channel (`task-description.md:237-238`).

## Codebase evidence

| Evidence | Location | Implication |
| --- | --- | --- |
| `PermissionHandlerService` exposes `permissionRequests` and `questionRequests` as read-only signals. They hold requests of all sessions (not tab-scoped). | `libs/frontend/chat-streaming/src/lib/permission-handler.service.ts:43,111,118,123` | The queue reads these two signals directly. No new store. |
| Per-prompt target tabs: `targetTabsFor(promptId)`. The backing Map is not reactive; consumers read `routingTargetRevision()` first. | `permission-handler.service.ts:61-69,360` | The queue computed reads `routingTargetRevision()` before it calls `targetTabsFor`. |
| `handlePermissionResponse(response)` removes the request by `id`, records hard-deny, sets `decisionPulse`, posts `SDK_PERMISSION_RESPONSE`. | `permission-handler.service.ts:408-440` | Inline Allow/Deny for session permissions calls this method. Removal is by id, so other sessions' requests stay. |
| `decidingTabId` comes from `tabManager.activeTabId()`. | `permission-handler.service.ts:426` | From the canvas header, the active tab can be another session. See risk R1. |
| `PermissionRequest`: `id`, `toolName`, `toolInput`, `timestamp`, `description`, `timeoutAt`, `sessionId?`, `tabId?` (authoritative), `surfaceMode?`. | `libs/shared/src/lib/types/permission.types.ts:30-81` | Item shape fields. `tabId` first, then target tabs, then `sessionId`. |
| `PermissionResponse.decision`: `'allow' \| 'deny' \| 'always_allow' \| 'deny_with_message'`, `reason?`. | `permission.types.ts:89-101` | Queue sends `allow` or `deny` only. |
| `AskUserQuestionRequest`: `id`, `questions`, `timestamp`, `timeoutAt`, `sessionId?`, `tabId?`, `surfaceMode?`. | `permission.types.ts:172-194` | Question items. Answer is not inline (step 6 AC4). |
| `AgentPermissionRequest`: `requestId`, `agentId`, `kind`, `toolName`, `toolArgs`, `description`, `timestamp`, `timeoutAt`. | `libs/shared/src/lib/types/agent-permission.types.ts:26-48` | Lane permission items. |
| Agent permission answer: `postMessage(AGENT_MONITOR_PERMISSION_RESPONSE, {requestId, decision, reason?})` then `agentStore.clearPermission(agentId)`. | `libs/frontend/canvas/src/lib/tile-agent-mini-panel.component.ts:125-143` | The queue reuses this exact message. The canvas lib already imports `VSCodeService`, `MESSAGE_TYPES` and `AgentMonitorStore` here, so the Nx tags already allow these imports. |
| `clearPermission(agentId, requestId?)` filters by `requestId` when given, else drops the head. | `libs/frontend/chat-streaming/src/lib/agent-monitor.store.ts:1494-1513` | The queue passes `requestId`, so only the selected entry clears. No store edit. |
| `AgentMonitorStore.agents` (all sessions); `pendingPermissions` = agents with a non-empty queue; `MonitoredAgent.status`, `parentSessionId`, `permissionQueue`. | `agent-monitor.store.ts:794,985-988,393,427,437` | Cross-session lane items come from `pendingPermissions()`. Public signals only. |
| `agentVisibleInSession(parentSessionId, sessionId)` scopes agents to a session; `subagents` signal and `SubagentRecord.parentSessionId`. | `agent-monitor.store.ts:845,858,736,890` | Use it to map a lane item or a running lane to a tile session. |
| Header: `ptah-canvas-layout-controls` then the "New session" popover guarded by `canvasStore.canAddTile()`. | `libs/frontend/canvas/src/lib/orchestra-canvas.component.ts:111-125` | The queue button goes between these two. The `ptah-native-popover` pattern is reused. |
| New session paths: `canvasStore.addTile(name)` from `handleCreateSession` and from the `newCanvasSessionRequest` effect. | `orchestra-canvas.component.ts:391-397,550-555` | These are the canvas "start new session" entry points for the running cap. |
| Adopt/open paths return `cap-reached` when `adoptTab` / `addTileFromSession` return falsy. | `orchestra-canvas.component.ts:497-522` | These stay on the hard tile bound only (step 7 AC2, AC4). |
| `canvasStore.focusTile(tabId)`. | `orchestra-canvas.component.ts:426,491,525` | "Open session" uses it. |
| `MAX_CANVAS_TILES = 20`. | `libs/frontend/canvas/src/lib/canvas-layout-intent.ts:13` | Hard tile bound stays. |
| `CanvasStore.MAX_TILES = MAX_CANVAS_TILES`; stale "nine" comment above it. | `libs/frontend/canvas/src/lib/canvas.store.ts:85-91` | Correct the comment only. |
| Persistence schema bounds tiles with `.max(MAX_CANVAS_TILES)`. | `libs/frontend/canvas/src/lib/canvas-layout-persistence.service.ts:39,60` | Do not change. The running cap is not a persistence bound. |

## Step 6 - Cross-session "Needs you" queue

### Architecture decision

- Chosen approach: one pure builder function plus one presentational-with-actions component in the canvas lib. The builder merges the three existing signals into a sorted item list. The component renders the header button and the popover, and calls the existing response paths.
- Rationale: all data is already in public signals (`permission-handler.service.ts:111,123`, `agent-monitor.store.ts:985`). The response paths already exist (`permission-handler.service.ts:408`, `tile-agent-mini-panel.component.ts:125-143`). No store and no host change is necessary.
- Rejected alternative: a new `NeedsYouStore` service in `chat-streaming`. It loses because it adds a layer for one consumer and it lands in a 628-adjacent lib. Rejected alternative 2: make the queue part of `canvas-layout-controls`. It loses because that component owns layout (lock, presets, tile count); mixing permission actions breaks one responsibility.
- Effect on existing code: `orchestra-canvas.component.ts` header gets one new element. `tile-agent-mini-panel.component.ts` stays as it is (its head-only `clearPermission(agentId)` is out of scope).

### Component 6.1 - `buildNeedsYouItems` (pure function)

- File: CREATE `libs/frontend/canvas/src/lib/canvas-needs-you-queue.ts`.
- Purpose: turn the three request sources plus the canvas tile list into one ordered list.
- Item shape (contract):

```ts
export type NeedsYouItemKind = 'permission' | 'question' | 'lane-permission';

export interface NeedsYouItem {
  readonly key: string;            // 'perm:<id>' | 'q:<id>' | 'lane:<agentId>:<requestId>'
  readonly kind: NeedsYouItemKind;
  readonly requestId: string;      // PermissionRequest.id | AskUserQuestionRequest.id | AgentPermissionRequest.requestId
  readonly tabId: string;          // canvas tile tab the item belongs to
  readonly sessionLabel: string;   // tile/tab title
  readonly requester: string;      // 'Session' for SDK items; agent display name for lanes
  readonly agentId: string | null; // set for 'lane-permission' only
  readonly summary: string;        // toolName + description, or first question text
  readonly timestamp: number;      // request timestamp (epoch ms)
}
```

- Inputs (plain values, no injection): `permissions: readonly PermissionRequest[]`, `questions: readonly AskUserQuestionRequest[]`, `laneAgents: readonly MonitoredAgent[]` (from `pendingPermissions()`), `tiles: readonly { tabId; sessionId: string | null; title }[]`, `targetTabsFor: (id) => readonly string[]`.
- Tab resolution order for SDK items: `request.tabId` -> first id of `targetTabsFor(request.id)` that is a tile -> tile whose `sessionId === request.sessionId`. For lane items: first tile where `agentVisibleInSession(agent.parentSessionId, tile.sessionId)` is true. Assumption A1: `agentVisibleInSession` is exported from the `chat-streaming` public entry. Check: grep `libs/frontend/chat-streaming/src/index.ts`. If it is not exported, compare `parentSessionId === tile.sessionId` and record the gap.
- Filters: skip `surfaceMode === true` (those route to their own chrome, `permission.types.ts:75-80,189-194`). Skip items that resolve to no canvas tile (they are not "canvas sessions", AC2); they stay visible in their own surface.
- Ordering: `timestamp` ascending (oldest first, first-come first-served), tie-break by `key`. The order is stable: removal of one item does not move others. The queue never touches tile order (AC7); the builder does not read or write layout.
- Failure behaviour: pure; a malformed entry (missing tab) is dropped, never thrown.
- Verification seam: unit spec `canvas-needs-you-queue.spec.ts` with plain objects.

### Component 6.2 - `CanvasNeedsYouQueueComponent`

- File: CREATE `libs/frontend/canvas/src/lib/canvas-needs-you-queue.component.ts` (+ spec). Selector `ptah-canvas-needs-you-queue`. Standalone, `OnPush`.
- Dependencies (inject): `PermissionHandlerService`, `AgentMonitorStore`, `VSCodeService`, `CanvasStore`, `TabManagerService` (for tab titles and `sessionId`; Assumption A2: the tile-to-session mapping uses the same accessor the canvas already uses for tiles. Check: how `orchestra-canvas.component.ts` reads a tile's session id; reuse it, do not add a tab-manager method).
- State: `items = computed(() => buildNeedsYouItems(...))`. The computed reads `permissionHandler.routingTargetRevision()` first (`permission-handler.service.ts:61-69`). `open = signal(false)`.
- Template: a trigger button with text `{{ n }} need you` or `All clear` (AC1), and a `ptah-native-popover` (`orchestra-canvas.component.ts:119-125` pattern). The popover list has `aria-label="Requests that need you"`. Each row is a list item with: session label, requester, summary, and actions. Rows use `@for (item of items(); track item.key)`.
- Actions:
  - `permission`: Allow -> `permissionHandler.handlePermissionResponse({ id, decision: 'allow' })`; Deny -> `{ id, decision: 'deny', reason: 'User denied' }`.
  - `lane-permission`: Allow/Deny -> same `postMessage(MESSAGE_TYPES.AGENT_MONITOR_PERMISSION_RESPONSE, { requestId, decision, reason? })` as `tile-agent-mini-panel.component.ts:125-143`, then `agentStore.clearPermission(agentId, requestId)` (with `requestId`, `agent-monitor.store.ts:1509-1511`).
  - `question`: "Open session" only (AC4).
  - "Open session" (all kinds): close the popover, `canvasStore.focusTile(item.tabId)`. For a lane item, also select the lane in the card detail through the lane-selection API that plan part 1/2 defines for steps 4-5 (cross-part contract; Assumption A3: part 1/2 exposes a tile-level "open detail on lane <agentId>" call. If not, focus the tile only and record the gap).
- Keyboard: trigger and every row action are native `<button>` elements. Escape closes the popover (native popover behaviour).
- Failure behaviour:
  - A request answered elsewhere (card, transcript, sidebar) is removed from the source signal by the existing path (`permission-handler.service.ts:423-425`, `agent-monitor.store.ts:1494-1513`). The computed drops the row on the next change detection (AC6).
  - A double answer (row clicked while the same request is answered in a tile): the SDK row is already gone after the first `handlePermissionResponse`. For lanes, the second `postMessage` carries a stale `requestId`. Assumption A4: the host ignores an unknown `requestId`. Check: the host handler for `AGENT_MONITOR_PERMISSION_RESPONSE`. Mitigation in the component: disable the row buttons after the first click (local `answering` set keyed by `item.key`, cleared when the key leaves `items()`).
  - Timeout: expired SDK requests are removed by the existing effect (`permission-handler.service.ts:138-156`); the row disappears.
- Risk R1: `handlePermissionResponse` records `decidingTabId = activeTabId()` (`permission-handler.service.ts:426`). From the queue, the active tab can be another tile. Check: grep consumers of `decisionPulse`. If a consumer uses `decidingTabId` for more than "which surface answered", request a `decidingTabId` parameter from 628/chat owners instead of focusing the tile. Do not change the active tab only to answer.
- Quality: the component holds no timers and no observers. Cost is one computed over at most tens of items.
- Unit tests (`canvas-needs-you-queue.component.spec.ts`, `canvas-needs-you-queue.spec.ts`):
  1. Two sessions with simultaneous permissions: Allow on one calls `handlePermissionResponse` with that id only; the other row stays (AC3).
  2. Lane Allow posts `AGENT_MONITOR_PERMISSION_RESPONSE` with the row's `requestId` and calls `clearPermission(agentId, requestId)`.
  3. Question rows show only "Open session"; click calls `focusTile(tabId)` and closes the popover (AC4, AC5).
  4. Removing a request from the source signal removes the row (AC6).
  5. Ordering by timestamp; tile order of `CanvasStore` unchanged after any action (AC7).
  6. `surfaceMode` items and items without a canvas tile are excluded.
  7. Count text: "All clear" at 0, "N need you" otherwise.

### Component 6.3 - header integration

- File: MODIFY `libs/frontend/canvas/src/lib/orchestra-canvas.component.ts`: add `<ptah-canvas-needs-you-queue />` between `ptah-canvas-layout-controls` (`:111-116`) and the `canAddTile()` block (`:118`); add the import to `imports`. No logic in the canvas component.

## Step 7 - Running-session cap

### Architecture decision

- Chosen approach: one named constant and one pure counter in the canvas lib, one computed on `CanvasStore`, and a gate on the canvas "new session" entry points. The hard tile bound (`MAX_CANVAS_TILES`, `canAddTile`, `cap-reached`) stays as it is.
- Rationale: AC2 and AC4 keep adopt/open on the tile bound only (`orchestra-canvas.component.ts:497-522`). Only a new session is a new running start that the canvas controls (`:391-397,550-555`).
- Rejected alternative: change `MAX_CANVAS_TILES` to 9 or gate `addTileFromSession`/`adoptTab`. It loses because it hides finished and idle sessions (contrary to AC2) and would refuse adoption of a session that already runs.

### Definition of "running" (glossary `task-description.md:94-95`)

A canvas tile session is running when one of these is true:

1. Its tab has an SDK turn in flight. Assumption A5: the tab status signal has a streaming value (for example `status === 'streaming'` or `'resuming'`). Check: open the `TabState.status` type in `chat-types`/`chat-state` and list the in-flight values. Read through public `TabManagerService` signals only (no edit to `updateTabInternal`).
2. At least one CLI lane in `AgentMonitorStore.agents()` with `agentVisibleInSession(agent.parentSessionId, sessionId)` has a non-terminal `status` (`agent-monitor.store.ts:393`). Assumption A6: terminal values are `completed | error | stopped | timeout`. Check: the `AgentStatus` type.
3. At least one background sub-agent in `AgentMonitorStore.subagents()` (`agent-monitor.store.ts:736`) scoped with `agentVisibleInSession(r.parentSessionId, sessionId)` has a non-terminal status. Assumption A7: `SubagentRecord.status` exists with terminal values. Check: the `SubagentRecord` type.

A session counts once even when several sources are true.

### Component 7.1 - running cap constant and counter

- File: CREATE `libs/frontend/canvas/src/lib/canvas-running-cap.ts`.
- Contract:

```ts
export const MAX_RUNNING_SESSIONS = 9;
export function countRunningSessions(
  sessionIds: readonly (string | null)[],
  isTabTurnInFlight: (sessionId: string) => boolean,
  agents: readonly MonitoredAgent[],
  subagents: readonly SubagentRecord[],
): number;
```

- Scope: counts canvas tile sessions only. Assumption A8: running sessions without a canvas tile are not counted. The requirement scopes the cap to the canvas (`task-description.md:198`). Record this in the spec name.
- Failure behaviour: pure; a null session id (new empty tile) is not running.

### Component 7.2 - `CanvasStore` computed and comment fix

- File: MODIFY `libs/frontend/canvas/src/lib/canvas.store.ts`.
- Add `readonly runningSessionCount = computed(...)` (uses 7.1 with tile sessions, tab signals, `agents()`, `subagents()`), and `readonly canStartRunningSession = computed(() => this.runningSessionCount() < MAX_RUNNING_SESSIONS)`.
- Replace the stale "nine tiles" comment at `:85-91` with: the tile bound is `MAX_CANVAS_TILES` (20) for persistence and Gridstack; the running limit is `MAX_RUNNING_SESSIONS` in `canvas-running-cap.ts`.
- `MAX_TILES` and `canAddTile()` stay unchanged.

### Component 7.3 - gate in the canvas header

- File: MODIFY `libs/frontend/canvas/src/lib/orchestra-canvas.component.ts`.
- "New session" trigger (`:118-129`): keep the `canAddTile()` guard. When `!canvasStore.canStartRunningSession()`, the trigger is `disabled` and shows the reason: `9 sessions are running. Wait for one to finish to start another.` The text is in a visible `title` plus an `aria-describedby` element (keyboard and screen-reader reachable).
- `handleCreateSession` (`:550-555`) and the `newCanvasSessionRequest` effect (`:391-397`): check `canStartRunningSession()` before `addTile`. When refused, do not add the tile, clear the request, and set a header message signal with the same text (shown in the header; it clears when `canStartRunningSession()` becomes true again). No running session is stopped or queued (AC1).
- Adopt/open (`:497-522`): unchanged. `cap-reached` stays on the tile bound (AC4).
- Gap G1 (AC1 "start from the canvas"): an idle tile that exists already can start a turn from its own chat input. That send path is in the chat lib, and the turn start is in `chat-lifecycle.service.ts` (628-owned). Part 3 does not gate it. See "Requests to 628". Until then, the header gate covers new sessions only; the spec name states this.
- Unit tests (`canvas-running-cap.spec.ts`, additions to `canvas.store.spec.ts` and `orchestra-canvas.component.spec.ts`):
  1. Idle and finished tiles do not count (no in-flight tab, all lanes terminal).
  2. A session with only a running CLI lane counts; a session with only a running background sub-agent counts; a session with several sources counts once.
  3. With 9 running, "New session" is disabled, `handleCreateSession` adds no tile, and the message shows (AC1).
  4. With 9 running, adopting or opening a finished session still adds a tile below 20 (AC2).
  5. When one running session finishes (signal change), `canStartRunningSession()` is true and the message clears (AC3).
  6. At 20 tiles, adopt/open still resolve `cap-reached` (AC4).

## Performance measurement procedure

Output file: `.ptah/specs/TASK_2026_629_c0b3/perf-before-after.md` (manual; no automated check).

### Builds

- Before: `main` after TASK_2026_628 merges, before step 1 of this task. Record the commit SHA.
- After: this branch rebased onto that `main`, with all shipped steps. Record the commit SHA.
- Use the same packaged/dev Electron build type, the same window size, and the same machine for both. Close other heavy apps.

### Scenario (same for both runs)

1. Open the Orchestra Canvas with 6 tiles.
2. In each tile, send the same long prompt that makes the session stream for at least 60 s and start at least one sub-agent. In 2 of the 6 tiles, also start one CLI lane.
3. Wait until all 6 stream (about 10 s after the last send).

### Recording

1. Open DevTools on the renderer (webview) window. Performance panel: enable "Memory", disable screenshots.
2. Record about 30 s while all 6 stream. Do not touch the UI during the recording.
3. Before the recording ends, in the Console run `document.querySelectorAll('*').length` (include open shadow roots only if the app uses them; use the same command in both runs). Record the value. Also record the "Nodes" maximum from the Memory track.
4. Renderer private memory at the end of the recording: Windows Task Manager (Details, column "Memory (private working set)") for the renderer process, or PowerShell `Get-CimInstance Win32_Process -Filter "Name='<app>.exe'" | Select ProcessId,CommandLine,PrivatePageCount` and pick the `--type=renderer` process of the webview.
5. Long tasks: in the Main track summary, count tasks over 100 ms (red-corner tasks; or the Console with a `PerformanceObserver({type:'longtask'})` started before the recording, filtering `duration > 100`). Record count and total ms.
6. Recalculate Style: Bottom-Up tab, activity "Recalculate Style": record total self time and the event count; average = total / count.
7. Repeat each run 3 times. Report the median.

### Template for `perf-before-after.md`

```markdown
# Performance before/after - TASK_2026_629_c0b3

- Before commit: <sha> (main after TASK_2026_628)
- After commit: <sha> (this branch, rebased)
- Machine / OS / build type / window size: <...>
- Scenario: 6 streaming sessions, <N> sub-agents, 2 CLI lanes, 30 s recording, median of 3

| Metric | Before (median) | After (median) | Change | Pass rule |
| --- | --- | --- | --- | --- |
| DOM node count (`querySelectorAll('*')`) | | | | After < Before |
| DOM nodes, Memory track max | | | | info |
| Long tasks > 100 ms (count) | | | | info |
| Long tasks > 100 ms (total ms) | | | | info |
| Recalculate Style total (ms) | | | | After < Before |
| Recalculate Style average (ms) | | | | info |
| Renderer private memory (MB) | | | | info |

## Raw runs

| Run | Build | DOM nodes | Long tasks (n / ms) | Recalc Style (total / avg) | Private MB |
| --- | --- | --- | --- | --- | --- |

## Notes

- Deviations from the scenario: <none>
- Verdict: PASS if DOM node count and Recalculate Style total are lower after (task-description.md:219-220).
```

## Files to touch (part 3)

| Path | Create/modify | Step | Overlap with 628? |
| --- | --- | --- | --- |
| `libs/frontend/canvas/src/lib/canvas-needs-you-queue.ts` | create | 6 | no (new file) |
| `libs/frontend/canvas/src/lib/canvas-needs-you-queue.spec.ts` | create | 6 | no |
| `libs/frontend/canvas/src/lib/canvas-needs-you-queue.component.ts` | create | 6 | no (reads public signals of `PermissionHandlerService` and `AgentMonitorStore` only) |
| `libs/frontend/canvas/src/lib/canvas-needs-you-queue.component.spec.ts` | create | 6 | no |
| `libs/frontend/canvas/src/lib/canvas-running-cap.ts` | create | 7 | no |
| `libs/frontend/canvas/src/lib/canvas-running-cap.spec.ts` | create | 7 | no |
| `libs/frontend/canvas/src/lib/canvas.store.ts` | modify | 7 | no (two computeds and the comment at `:85-91`; not a 628-owned area; parts 1/2 may also edit this file: merge by hunk) |
| `libs/frontend/canvas/src/lib/canvas.store.spec.ts` | modify | 7 | no |
| `libs/frontend/canvas/src/lib/orchestra-canvas.component.ts` | modify | 6, 7 | no (header template `:111-129`, `:391-397`, `:550-555`; parts 1/2 may also edit: merge by hunk) |
| `libs/frontend/canvas/src/lib/orchestra-canvas.component.spec.ts` | modify | 6, 7 | no |
| `.ptah/specs/TASK_2026_629_c0b3/perf-before-after.md` | create (manual) | NFR | no |

Not touched by part 3: `canvas-tile.component.ts`, the Gridstack adapter, `canvas-layout-intent.ts`, `canvas-layout-persistence.service.ts`, `tile-agent-mini-panel.component.ts`, all 628-owned files.

Verification (only if the team-leader runs checks): `npx jest -c libs/frontend/canvas/jest.config.ts <changed specs> --coverage=false --maxWorkers=2`, or `npx nx test canvas --parallel=1`. One heavy check at a time. Filter output. No workspace-wide runs, no build/serve/e2e.

## Requests to 628 (part 3)

1. Keep these public members stable: `AgentMonitorStore.agents`, `pendingPermissions`, `subagents`, `clearPermission(agentId, requestId?)`, `MonitoredAgent.status/parentSessionId/permissionQueue`, `agentVisibleInSession`; `PermissionHandlerService.permissionRequests`, `questionRequests`, `targetTabsFor`, `routingTargetRevision`, `handlePermissionResponse`.
2. Keep a public, reactive "turn in flight" signal per tab (the `TabState.status` value used for A5) when `updateTabInternal` changes. If 628 changes the status values, tell 629 which values mean "in flight".
3. Gap G1 (optional, after 628 merges): the chat-input send for an existing idle canvas tile starts a turn through `chat-lifecycle.service.ts` (628-owned). If the product wants AC1 to cover that path, 628 (or a follow-up) adds a guard hook that the canvas can supply (for example an injectable "start allowed" predicate). Part 3 does not edit that file.
4. Risk R1: if `decisionPulse.decidingTabId` drives behaviour beyond "which surface answered", 629 needs `handlePermissionResponse` to accept an optional deciding tab id. `PermissionHandlerService` is not on the 628-owned list, but confirm before 629 edits it.
