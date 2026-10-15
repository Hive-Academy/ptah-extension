# Batch B3 report

## Files changed

- `libs/frontend/canvas/src/lib/canvas-running-cap.ts` and `.spec.ts`: named cap and pure counter for distinct canvas sessions.
- `libs/frontend/canvas/src/lib/canvas.store.ts` and `.spec.ts`: reactive running count and availability, plus corrected tile-bound comment.
- `libs/frontend/canvas/src/lib/orchestra-canvas.component.ts` and `.spec.ts`: disabled New Session control with a focusable explanation, guards on both creation paths, and a header message that clears when a slot opens.
- `.ptah/specs/TASK_2026_629_c0b3/lane-B3-report.md`: this report.

## Assumption checks and decisions

- A5: `TabState.status` exists (`libs/frontend/chat-types/src/lib/chat-types.ts:585`). Its `SessionStatus` documentation identifies `streaming` as an active turn and `resuming` as an in-flight resume (`:468-469`, `:478-486`). `TabManagerService.tabs` is a public signal (`libs/frontend/chat-state/src/lib/tab-manager.service.ts:393`). The counter uses these two tab states; `switching` is a tab transition and `awaiting-background` has an idle SDK turn.
- A6: `AgentStatus` is `running | completed | failed | timeout | stopped` (`libs/shared/src/lib/types/agent-process.types.ts:43-44`), and monitor agents carry it (`libs/frontend/chat-streaming/src/lib/agent-monitor.store.ts:393`). The plan's `error` terminal value is stale: the source uses `failed`. Only `running` counts.
- A7: The relevant `AgentMonitorStore.SubagentRecord` has a status field (`libs/frontend/chat-streaming/src/lib/agent-monitor.store.ts:526,561-569`), with terminal `completed | failed | killed | stopped`. `pending | running | paused | background` count. This is distinct from the shared registry's `SubagentRecord`; the monitor's public subagent map is at `:736`.
- A8: Count only session IDs attached to the active canvas tile set. Null IDs and duplicate IDs do not count. CLI and subagent ownership follows the existing `agentVisibleInSession` rule (`libs/frontend/chat-streaming/src/lib/session-scope.ts:60`).
- The tile bound remains `MAX_CANVAS_TILES = 20` (`libs/frontend/canvas/src/lib/canvas-layout-intent.ts:13`); `CanvasStore.MAX_TILES` and `canAddTile()` are unchanged. Adopt/open and `cap-reached` paths are unchanged.
- Angular 22.1.7 comes from `package.json:97`; the adjacent canvas controls and empty state use standalone OnPush component templates. No untrusted markup or external call was added.

## Checks

- `npx prettier --write` on every changed file: completed.
- `npx nx test @ptah-extension/canvas --testFile=canvas-running-cap.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`: 3 passed.
- `npx nx test @ptah-extension/canvas --testFile=canvas.store.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`: 16 passed.
- `npx nx test @ptah-extension/canvas --testFile=orchestra-canvas.component.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`: 33 passed. This includes the rendered disabled-trigger and description check, creation refusal, and message reset. Existing component specs exercise adopt/open and tile `cap-reached` behavior.
- `npx nx typecheck @ptah-extension/canvas --parallel=1 --skip-nx-cache`: passed; one existing NG8107 warning in `peer-session-send-dialog.component.ts`.
- `npx nx lint @ptah-extension/canvas --parallel=1 --skip-nx-cache`: passed; three existing non-null-assertion warnings in `canvas-tile.component.spec.ts`.

## Open items

- Plan-part-3.md G1 remains: a user can start a turn from an already existing idle canvas tile through the chat send path. That path is in 628-owned files and is outside Batch B3, so the end-to-end AC 7.1 guarantee needs the planned chat-side gate.
- `ptah_agent_report` is unavailable in this agent's tool list; this report and final summary provide the handoff.
