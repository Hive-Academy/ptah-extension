# Code Logic Re-review — Phase B fix commit 8f1334415 (TASK_2026_629_c0b3)

| Finding | Verdict | Evidence |
| ------- | ------- | -------- |
| M1 running set keyed `claudeSessionId ?? tab.id`, strict agent ownership | FIXED | `canvas-running-cap.ts:29-31` builds the map keyed `claudeSessionId ?? id`. Agent and subagent matches are guarded by `sessionId !== null` (`:37-44`), so an unbound tab matches no agent. `canvas.store.ts:165-168` uses the same key in the in-flight callback. A single tab moves from key `tab.id` to key `sessionId` at bind. It is never in both keys, so it is not counted twice. Two tabs on one session dedupe. |
| M2 count tiles across all workspaces, dedup by tab id | NOT FIXED (only half done) | The tile-id half is done: `canvas.store.ts:153-157` reads `_workspaceTiles()` with a `Set`. The tab lookup is not: `canvas.store.ts:152,158` still filters `tabManager.tabs()`. `TabManagerService.tabs` is the active workspace's tabs only. `switchWorkspace` stashes the old set in the partition and replaces `_tabs` (`chat-state/tab-manager.service.ts:773-785`, `tab-workspace-partition.service.ts:198-208`). Hidden-workspace tiles therefore have no matching tab in `canvasTabs` and are still not counted. The new spec (`canvas.store.spec.ts:149-166`) puts every tab in one flat `tabs` signal, which production never does, so it passes without exercising the bug. |
| M4 `respondLane` returns boolean, queue clears `answering` when not posted | FIXED | `agent-permission-responder.ts:25,26,38` returns false when already answered and true when posted. The throw path still deletes the guard. `canvas-needs-you-queue.component.ts:162-174` clears the key when `posted` is false. The spec at `canvas-needs-you-queue.component.spec.ts:168` and the responder spec assert this. |

## New findings (this diff only)

1. Serious: M2 is still broken in production, as above. A user can run 5 sessions in workspace A, switch to B, and the cap sees only B's. `canStartRunningSession` then allows more than nine. Fix: resolve tab state for hidden workspaces through `tabManager.getWorkspaceTabs(path)` (`tab-manager.service.ts:810`) for each key in `_workspaceTiles`. Also read it so the computed re-evaluates when background tabs stream, because partition maps are not signals. Change the spec to model per-workspace tab visibility (active `tabs()` holds only one workspace).
2. Moderate: the other `respondLane` caller, `compact-session-card.component.ts:310`, ignores the new boolean. This is harmless today because it keeps no pending state. It is a silent no-op if it ever gains one.
3. Moderate: if `respondSession` is skipped (permission request not found, `canvas-needs-you-queue.component.ts` `permission` branch), `answering` is not cleared. The Allow/Deny buttons stay disabled until the item leaves the queue. This is the same class as M4 but on the session branch. It is pre-existing and arguably out of scope; it is noted as a follow-up.

No double count at the bind moment. No deleted-workspace regression was introduced: `removeWorkspaceTileState` (`canvas.store.ts:509`) drops the tiles. A tab closed externally is handled by the unchanged `removeTileOnly` path, so a stale tile can be counted only if the tab is still in the active `tabs()`.

## Verdict: REVISE (M2 not fixed in the real runtime; the other two pass)
