# B7a detail service and panel report

## Files created

- `libs/frontend/canvas/src/lib/canvas-detail/canvas-detail.service.ts`
- `libs/frontend/canvas/src/lib/canvas-detail/canvas-detail.service.spec.ts`
- `libs/frontend/canvas/src/lib/canvas-detail/canvas-detail-panel.component.ts`
- `libs/frontend/canvas/src/lib/canvas-detail/canvas-detail-panel.component.spec.ts`
- `libs/frontend/canvas/src/lib/canvas-detail/canvas-detail-transcript.component.ts`
- `libs/frontend/canvas/src/lib/canvas-detail/canvas-session-details.component.ts`
- `libs/frontend/canvas/src/lib/canvas-detail/canvas-session-details.component.spec.ts`
- `.ptah/specs/TASK_2026_629_c0b3/lane-B7a-report.md`

## Part 2 A findings

- Context: no reusable context-bar component was found in the chat/chat-ui component selectors. The existing compact card reads `liveModelStats.contextPercent` when `contextKnown` at `libs/frontend/chat/src/lib/components/molecules/compact-session/compact-session-card.component.ts:135-138`. The inspector uses that same tab field in a native `<progress>`.
- Git: the compact card reads `tab.agentOrigin?.branch` at `libs/frontend/chat/src/lib/components/molecules/compact-session/compact-session-card.component.ts:129`. The inspector shows this branch when present. A session-level git change count is not available from the tab state; `decisions.md:17` records the host-data-path gap. The Changes field shows `—`.
- Todos: `libs/frontend/chat-ui/src/lib/molecules/tool-execution/todo-list-display.component.ts:97` requires one `TodoWriteToolInput`, not a session-level todo collection. `decisions.md:17` records the missing public source. The inspector shows `—`.
- Tokens, cost, turns: the compact card reads the authoritative session snapshot at `compact-session-card.component.ts:248-256`; the schema declares `tokenCount`, `totalCost`, and assistant `messageCount` at `libs/shared/src/lib/types/rpc/rpc-session.types.ts:353-370`. The inspector uses those fields, with `messageCount` labeled Turns. Unknown values show `—`.

## Decisions

- The service is component scoped and focuses a tab on open. It accepts orchestrator or keys validated by chat's `parseLaneKey`, and steps in `CanvasStore.tiles()` order with wrap.
- The transcript uses the normal `ChatViewComponent` with the existing session context/visibility/focus/surface tokens and `HIDE_AGENT_SIDEBAR`. Its child injector and visible-tab registration release on destroy. It does not build or cache an execution tree.
- The panel provides a named lane-tab projection slot and a named lane-view slot for B8a. The Orchestrator view mounts only while its lane is selected. The panel has a notch positioned by `--ptah-notch-pct` and a 300 px inspector at desktop width. It scrolls into view on mount.
- The detail uses the B6 provisional GO sibling-overlay contract (`decisions.md:27`); no existing canvas, chat, or task-628-owned file was edited.

## Checks

- `npx nx test @ptah-extension/canvas --testFile=libs/frontend/canvas/src/lib/canvas-detail/canvas-detail.service.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`: 1 suite, 3 tests passed.
- Same command with `canvas-session-details.component.spec.ts`: 1 suite, 2 tests passed.
- Same command with `canvas-detail-panel.component.spec.ts`: 1 suite, 1 test passed.
- `npx nx typecheck @ptah-extension/canvas --parallel=1 --skip-nx-cache`: passed.
- `npx nx lint @ptah-extension/canvas --parallel=1 --skip-nx-cache`: passed with 0 errors and 4 warnings in existing grid specs.
- `npx prettier --write libs/frontend/canvas/src/lib/canvas-detail/*.ts`: completed.

## Open items

- B7b must provide `CanvasDetailService` in the canvas host, mount the panel through the grid's `[ptahCanvasDetail]` slot, and wire card/keyboard actions.
- B8a must fill the projected lane tabs and lane view.
- Session-level todos and git change counts await the decision in `decisions.md:17`. The current UI explicitly displays `—` for those unavailable values.
- The B6 manual Electron geometry check remains outstanding per `decisions.md:27`.
