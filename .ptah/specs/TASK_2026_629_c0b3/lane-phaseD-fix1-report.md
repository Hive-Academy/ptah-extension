# Phase D Fix-D1 report

| Finding | Status | File:line | Test |
| --- | --- | --- | --- |
| S1 visible-tab ownership | Fixed: detail registers only absent tabs and releases only its registration | `libs/frontend/canvas/src/lib/canvas-detail/canvas-detail-transcript.component.ts:51` | `canvas-detail-transcript.component.spec.ts` (1 passed) |
| S2 hidden-surface keyboard | Fixed: keyboard handler reads the canvas `SURFACE_ACTIVE` signal | `libs/frontend/canvas/src/lib/orchestra-canvas.component.ts:344` | `orchestra-canvas.detail.spec.ts` (3 passed) |
| S3 lane tab arrows | Fixed: handled and tablist keys stay with lane tabs | `libs/frontend/canvas/src/lib/canvas-detail/canvas-detail-keyboard.ts:8`, `canvas-lane-tabs.component.ts:171` | `orchestra-canvas.detail.spec.ts`; canvas suite |
| S4 transcript refresh | Fixed: effect tracks primitive agent/session IDs; manual and automatic loads discard stale responses | `libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-view.component.ts:259` | `canvas-lane-view.component.spec.ts` (4 passed) |
| S5 + contenteditable minor | Fixed: nested controls suppress card toggles only; live clicks request focus; editable targets are interactive | `libs/frontend/canvas/src/lib/canvas-tile.component.ts:686` | `canvas-tile.component.spec.ts` (48 passed) |
| M1 card action | Fixed: `openSession()` calls `detail.open`; card host toggles | `libs/frontend/canvas/src/lib/canvas-tile.component.ts:645` | `canvas-tile.component.spec.ts` |
| M4 Escape scope | Fixed: handled events and input, menu, dialog and popover targets are ignored | `libs/frontend/canvas/src/lib/canvas-detail/canvas-detail-keyboard.ts:8` | `orchestra-canvas.detail.spec.ts` |
| M6 sub-agent permission | Fixed: lane matches `PermissionRequest.agentToolCallId` to sub-agent `parentToolUseId`, and calls `respondSession` with the deciding tab | `libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-view.component.ts:245` | `canvas-lane-view.component.spec.ts` |
| M6 standalone background Stop | Open: standalone `BackgroundAgentEntry` has a tool call ID but no task ID; `AgentMonitorStore.stopAgent` requires a task ID. The existing background tray only enables Stop when it resolves one. No safe path exists for a truly standalone entry. | `libs/frontend/chat-streaming/src/lib/background-agent.store.ts:43`; `agent-monitor.store.ts:2441` | Source inspection |
| Style 1 owner filtering | Fixed: one null-guarded helper shared by lane tabs, lane view and queue | `libs/frontend/canvas/src/lib/canvas-detail/lane-owner.ts:2` | Canvas suite (308 passed) |
| Style 2 deny reason | Fixed: responder supplies default `User denied`; canvas callers pass only decision | `libs/frontend/chat/src/lib/services/agent-permission-responder.ts:20` | `agent-permission-responder.spec.ts` (4 passed) |
| Style 3 lane branch | Fixed: sub-agent and background sub-agent branches share one template block | `libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-view.component.ts:118` | `canvas-lane-view.component.spec.ts` |
| Style 4 tab semantics | Fixed: presentation group labels, per-panel tab IDs and labelled panel; removed enclosing nav | `libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-tabs.component.ts:38`; `canvas-detail-panel.component.ts:47` | Canvas suite (308 passed) |

## Checks

- Changed canvas specs used `npx nx test @ptah-extension/canvas --testFile=<spec> --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`; final targeted runs passed (tile 48, lane view 4, detail transcript 1, detail keyboard 3, panel 1, queue component 6, mini panel 1).
- `npx nx test @ptah-extension/chat --testFile=agent-permission-responder.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`: 4 passed.
- `npx nx test @ptah-extension/canvas --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`: 24 suites, 308 tests passed.
- `npx nx typecheck @ptah-extension/canvas --parallel=1 --skip-nx-cache`: passed. `npx nx lint @ptah-extension/canvas --parallel=1 --skip-nx-cache`: passed, 11 warnings, 0 errors.
- `npx nx typecheck @ptah-extension/chat --parallel=1 --skip-nx-cache`: passed. `npx nx lint @ptah-extension/chat --parallel=1 --skip-nx-cache`: passed, 38 warnings, 0 errors.
- File lines: `orchestra-canvas.component.ts` 694; `canvas-tile.component.ts` 871.

## Open items

- Standalone background Stop remains open for the task-ID gap described above. No background stop call was added with an unverified tool call ID.
- The `ptah_agent_report` tool was unavailable in this lane; the caller should use this report as the handoff.
