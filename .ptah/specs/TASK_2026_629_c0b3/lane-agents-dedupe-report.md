# Lane agents dedupe report — decision 112

## Part A — Electron display dock

| Removed item | Source | Spec evidence |
| --- | --- | --- |
| `Agents (n)` tab, tablist, new dot and running count | `libs/frontend/chat/src/lib/components/organisms/display-dock/display-dock.component.ts:67` | `display-dock.component.spec.ts:140` checks the one labelled display region and absence of the Agents UI; axe check at :294 passes. |
| Embedded `ptah-agent-monitor-panel`, `agents`, `sessionId`, and `hideAgents` inputs | `display-dock.component.ts:36,67,111` and `chat-view.component.html:292` | `display-dock.component.spec.ts:140`; `chat-view.dock.spec.ts:503` verifies no dock monitor in a host with `HIDE_AGENT_SIDEBAR`. |
| Agent badge and running auto-open in Electron | `chat-view.component.html:255`; `chat-view.component.ts:1352,1390` | `chat-view.dock.spec.ts:525,732,794` covers running agents, chip requests, Rail and single chat; none opens the dock. The agent effects remain for VS Code only. |
| Agent monitor fallback after a dock chunk failure | `chat-view.component.html:300-309` | `chat-view.dock.spec.ts:721` verifies the alert and absence of a fallback monitor. |

`sessionAgents` and `agentBadgeType` remain in ChatView solely for the VS Code sidebar (`chat-view.component.html:310-346`). `HIDE_AGENT_SIDEBAR` remains a VS Code sidebar token (`session-context.token.ts:13`); `chat-view.dock.spec.ts:506` verifies it still hides that sidebar. The conductor comment now states that scope.

### Decision 77 capabilities retained

- [x] Dock and display surface selection, summary actions, pin and close: `display-dock.component.spec.ts` (14/14, including panel bindings, summary action failures and axe).
- [x] `ptah-ui display [id]` opens and updates in place: `chat-view.dock.spec.ts:503,804` and `canvas-detail-transcript.component.spec.ts:65`.
- [x] `$diff $tests $usage $agents $limits` display references: display panel and display sync remain mounted; `chat-view.dock.spec.ts` retains the single chat fenced-display case. No reference parsing code changed.
- [x] Width, resize, side and overlay behavior: `chat-view.dock.spec.ts:540-720` and `chat-view.keepalive.spec.ts` (9/9).
- [x] Dock state restores by chat tab id: `display-dock.component.spec.ts` tab-id restore case; `chat-view.dock.spec.ts:746` context round trip.

## Part B — sub-agent click

The Rail transcript provider called `CanvasDetailService.selectLaneFor` at `canvas-detail-transcript.component.ts:74`. That selected a lane but did not focus its session. `CanvasDetailService.open` at `canvas-detail.service.ts:42-48` focuses the tile and selects its lane; this is the required Rail action. The sub-agent tile already sends `sub:` or `bg:` keys through `SESSION_CARD_ACTIONS`; the compact CLI card already uses `cli:` and the Rail card already calls `detail.open`.

| Path | Fix / behavior | Spec evidence |
| --- | --- | --- |
| Rail transcript sub-agent click | Provider now calls `detail.open(tabId, laneKey)` at `canvas-detail-transcript.component.ts:74`; session action uses `open(tabId, 'orchestrator')`. | `canvas-detail-transcript.component.spec.ts:157` checks the child injector callback gets `('parent', 'sub:tool')`, with no dock or single-chat view. Existing `canvas-detail.service.spec.ts:36` checks `open` calls `focusTile`. |
| Single chat sub-agent click | Existing `ChatTranscriptComponent.singleChatCardActions` at `chat-transcript.component.ts:728-732` continues to call `openSubagentLane`, displaying `ptah-single-chat-subagent-view`; no production change was needed. | `chat-transcript.component.spec.ts:1267` checks the live full view, Back, draft and absence of the display dock (39/39). |
| Agent activity / monitor chip | Electron ChatView ignores monitor panel open requests, so they cannot send an agent click to the display dock. | `chat-view.dock.spec.ts:525` and :794. |

## Tests

- `node .ptah/tmp/check-run.mjs dedupe-1 -- npx nx test @ptah-extension/chat --testFile=display-dock.component.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`: 14 passed.
- `dedupe-7` with `chat-view.dock.spec.ts` and the same lock/Nx flags: 23 passed.
- `dedupe-4` with `@ptah-extension/canvas`, `canvas-detail-transcript.component.spec.ts` and the same flags: 10 passed.
- `dedupe-5` with `chat-view.keepalive.spec.ts` and the same flags: 9 passed.
- `dedupe-6` with `chat-transcript.component.spec.ts` and the same flags: 39 passed.
- Scoped `ptah_get_diagnostics` after edits was unavailable: TypeScript compiler checks exceeded the 45-second tool window. No typecheck or lint was run, per the task's strict check scope.

## Decisions

- Kept `DisplayDockState`'s agent branch because the VS Code sidebar still uses it. Electron ignores its agent open requests and renders only the display region.
- Kept `AgentMonitorPanelComponent` because the VS Code sidebar and Tribunal vendor card still use it.
- Kept the existing single chat sub-agent full view and its provider; the bug was the Rail provider callback.

## Clarifications Needed

- The separate `Workflow launched` chip at `workflow-card.component.ts:109` still requests the old Agents panel. In Electron that request is now ignored. It represents a workflow group, not one identified sub-agent lane. Recommendation: decide a workflow-group destination during the planned main-view tile redesign; retain the VS Code sidebar shortcut meanwhile. This change was not made because a workflow-group lane is absent from the current canvas contract.

## Proposed Removals

None beyond the user-approved dock Agents tab, badge, count, auto-open and embedded/fallback monitor.

## Changed files (absolute)

- D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5\libs\frontend\canvas\src\lib\canvas-detail\canvas-detail-transcript.component.ts
- D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5\libs\frontend\canvas\src\lib\canvas-detail\canvas-detail-transcript.component.spec.ts
- D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5\libs\frontend\chat\src\lib\components\organisms\display-dock\display-dock.component.ts
- D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5\libs\frontend\chat\src\lib\components\organisms\display-dock\display-dock.component.spec.ts
- D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5\libs\frontend\chat\src\lib\components\organisms\transcript\chat-transcript.component.spec.ts
- D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5\libs\frontend\chat\src\lib\components\templates\chat-view.component.ts
- D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5\libs\frontend\chat\src\lib\components\templates\chat-view.component.html
- D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5\libs\frontend\chat\src\lib\components\templates\chat-view.dock.spec.ts
- D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5\libs\frontend\chat\src\lib\components\templates\chat-view.keepalive.spec.ts
- D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5\libs\frontend\chat\src\lib\tokens\session-context.token.ts
- D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5\libs\frontend\tribunal-panel\src\lib\components\conductor-tile.component.ts
