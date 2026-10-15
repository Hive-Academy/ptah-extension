# B4 needs-you queue report

## Files changed

- `libs/frontend/canvas/src/lib/canvas-needs-you-queue.ts` — pure ordered merge and strict lane ownership.
- `libs/frontend/canvas/src/lib/canvas-needs-you-queue.spec.ts` — routing, filtering, ownership, ordering.
- `libs/frontend/canvas/src/lib/canvas-needs-you-queue.component.ts` — accessible popover, actions and focus.
- `libs/frontend/canvas/src/lib/canvas-needs-you-queue.component.spec.ts` — simultaneous sessions, external removal, questions, lane denial.
- `libs/frontend/canvas/src/lib/orchestra-canvas.component.ts` — header import and element only.
- `libs/frontend/canvas/src/lib/orchestra-canvas.component.spec.ts` — queue stub and header order assertion.

## Check-first findings

- `libs/frontend/chat-streaming/src/lib/permission-handler.service.ts:68-69,360,585` exposes a routing revision signal and separate permission/question target tab lookups. The component reads the revision before building the queue.
- `libs/frontend/chat-streaming/src/lib/agent-monitor.store.ts:985-987` derives `pendingPermissions` from agents with nonempty permission queues.
- `libs/frontend/chat/src/lib/services/agent-permission-responder.ts:20-57` owns lane and session responses; session response receives an explicit tab ID. The queue uses this responder.
- `libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.ts:826-860` forwards lane responses to both handlers; `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/copilot-permission-bridge.ts:260-269` ignores unknown request IDs. `libs/backend/agent-sdk/src/lib/sdk-permission-handler.ts:1087-1094` logs and returns for unknown IDs.
- `libs/frontend/ui/src/lib/native/popover/native-popover.component.ts:64-109` provides the existing popover. `libs/frontend/canvas/src/lib/canvas-layout-controls.component.ts:58-88` shows its local usage.
- `.ptah/specs/TASK_2026_629_c0b3/prototypes/01-board.html:63-70` places attention in the board header; `prototypes/shared.css:101-135` gives the compact trigger and popover shape. The implementation uses existing DaisyUI semantic classes.

## Decisions

- A lane appears only when `agent.parentSessionId === tile.sessionId`, per the B4 handoff. Unresolved parents are excluded.
- SDK requests resolve by direct canvas tab, routed canvas target, then matching session. Surface-mode requests and requests without a canvas tile are excluded. Question routing uses `questionTargetTabsFor`.
- Items sort oldest first, then key. The queue does not modify tile order. Text is interpolated by Angular; no untrusted HTML is rendered.
- Allow/Deny uses `AgentPermissionResponder`. Lane denial passes `User denied`; session decisions pass the item's tab ID. Answered buttons are disabled until their row leaves; the pending key is then cleared.
- Questions offer Open session only. The action closes the popover and calls `CanvasStore.focusTile(tabId)`.

## Checks

- `npx prettier --write` ran on all six changed files.
- `npx nx test @ptah-extension/canvas --testFile=libs/frontend/canvas/src/lib/canvas-needs-you-queue.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`: 3 passed.
- `npx nx test @ptah-extension/canvas --testFile=libs/frontend/canvas/src/lib/canvas-needs-you-queue.component.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`: 4 passed.
- `npx nx test @ptah-extension/canvas --testFile=libs/frontend/canvas/src/lib/orchestra-canvas.component.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`: 33 passed. Initial run failed because the existing dock test omitted the new child from its override; the stub and order assertion fixed it.
- `npx nx typecheck @ptah-extension/canvas --parallel=1 --skip-nx-cache`: passed. One existing NG8107 warning in `peer-session-send-dialog.component.ts:181`.
- `npx nx lint @ptah-extension/canvas --parallel=1 --skip-nx-cache`: passed, 0 errors; 3 existing non-null assertion warnings in `canvas-tile.component.spec.ts`.

## Open items

- B7b owns opening lane detail after focusing its tile. The queue currently focuses the tile, as requested for B4.
- No files owned by TASK_2026_628 were changed.
