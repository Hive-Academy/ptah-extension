Verdict: REVISE
Score: 3/10

## Batch A re-check

| Finding | Status | Current evidence |
|---|---|---|
| 1 — owned compact deadlock | Resolved | `session-stream-pump.service.ts:95-103` bypasses admission only for `owned-compact`; `:289-304` marks and queues it. |
| 2 — history-reader DI | Resolved | `session-handover-coordinator.service.ts:123-124` injects `SDK_SESSION_HISTORY_READER`; `di/register.ts:753-755` resolves that token. |
| 3 — budget DI / interrupt gate | Resolved | `session-lifecycle-manager.ts:417-418` injects `SDK_SESSION_BUDGET`; terminal handling reads it at `:500-518`. |
| 4 — millisecond compact wait | Resolved | `session-history-reader.service.ts:187-209` polls to a wall-clock deadline while the owned compact remains live. |
| 5 — failed restore reported as restored | Resolved | `session-handover-coordinator.service.ts:411-422` sets `restored` only after `restoreInputs` succeeds and publishes the restore error. |
| 6 — agent text evicts durable seed | Resolved | `session-handoff-builder.ts:642-655` caps the supplement to residual seed capacity before prefixing it. |
| 7 — stale close announced closed | Resolved | `session-handover-coordinator.service.ts:374-381` reports a token mismatch as `failed`, not `closed`. |
| 8 — captured/null successor host | Resolved | `di/register.ts:747-760` supplies a lazy, per-begin host resolver; `session-handover-coordinator.service.ts:327-330` resolves it then. |
| 9 — throwing snapshot strands operation | Resolved | Snapshot capture is inside `complete`'s guarded block at `session-handover-coordinator.service.ts:321-388`. |
| 10 — divergent limit predicates | Resolved | The adapter delegates result release at `sdk-agent-adapter.ts:1739-1742`; lifecycle owns the sole predicate at `session-lifecycle-manager.ts:500-518`. |
| 11 — steer text rejected during handover | Deferred | Still returns `interrupt-failed` when steer interruption is refused at `session-spawner.service.ts:578-596`; this is the stated Batch D deferral. |

## Batch B findings

1. **blocking** — `session-handover-coordinator.service.ts:362-383`; `child-chat-session-host.adapter.ts:97-123`; `chat-session.service.ts:790-795`  
   **Defect:** The coordinator snapshots `operation.inputs` before starting the successor. The adapter starts the successor and sends that FIFO before it asks the webview to bind; it then waits up to 15 seconds. Inputs admitted in `starting-successor` are appended by `admitOrHold` (`session-handover-coordinator.service.ts:217-228`) after the snapshot and are never transferred or restored when the source closes. Conversely, inputs already sent to the live successor are restored to the source if bind times out, so they can run twice.  
   **Failure scenario:** Send a follow-up while the replacement waits for bind, or let the webview acknowledgement time out after the successor consumed a queued task. The follow-up is silently lost on close; the timeout path can execute an already-sent task again on the source. This violates FIFO exactly-once delivery.  
   **Exact fix:** Split successor creation/bind from FIFO delivery. After a successful bind, have the coordinator atomically detach the final held FIFO while admission remains closed, transfer that one batch, and close only after transfer acknowledgement. On pre-transfer failure restore that untransferred batch only.

2. **blocking** — `chat-stream-broadcaster.service.ts:357-397`; `sdk-agent-adapter.ts:1739-1742`; `session-handover-coordinator.service.ts:186-214,402-422`  
   **Defect:** A normal SDK `result` is the only path that invokes `onTurnTerminal`; a stream that exits/crashes without it token-closes the registry record in the broadcaster, but never fails/cancels the coordinator operation. The coordinator has no source-ended callback and retains its non-restartable operation and FIFO. Idle eviction cannot repair it because it only evicts records with `query === null` (`session-registry.service.ts:619-638`).  
   **Failure scenario:** A successor request is `waiting-for-turn-end`, or a turn reaches the limit, and the SDK process is killed. The source record is removed at `chat-stream-broadcaster.service.ts:388-397`, while the operation remains held indefinitely; its FIFO cannot be restored and later begins only return the stale operation.  
   **Exact fix:** Route every token-matched stream exit, abort, and session teardown through a coordinator `sourceEnded`/failure path before removing the record. It must publish a terminal error, restore while the source is recoverable, or explicitly surface unrecoverable held-input loss; remove/restart the operation so it cannot poison later requests.

3. **major** — `session-handover-rpc.handlers.ts:45-57`; `session-handover-coordinator.service.ts:133-137,280-283`  
   **Defect:** State is only broadcast on a future change. Registering a listener has no replay, and the RPC handler has neither a session-state query nor a webview-attach hook that republishes `snapshotFor`.  
   **Failure scenario:** The webview reloads/attaches after the coordinator has entered `awaiting-confirmation` or `starting-successor` and before a later transition. It receives no `session:stats` handover state, cannot render or acknowledge the operation, and the source times out/restores despite a live UI.  
   **Exact fix:** Persist the latest revision per source and publish it to each newly attached surface (or add a validated state-read RPC consumed on bootstrap); serialize broadcasts or retain revision filtering so a newer state cannot be overwritten by an earlier asynchronous send.

4. **major** — `session-lifecycle-manager.ts:456-476`; `child-chat-session-host.adapter.ts:97-105`; `child-chat-session-host.port.ts:34-71`  
   **Defect:** Every snapshot hard-codes `inheritedParentIds: []` and supplies no `mcpRootPath`; the successor adapter never consumes either field. It always starts a generic child session, so a replacement of a nested child has neither the closing child's parent link nor its MCP-root lease.  
   **Failure scenario:** Hand over a child session running in a leased worktree/MCP root. Its replacement is detached from the parent topology and loses the lease identity, risking wrong cleanup/routing after the original closes.  
   **Exact fix:** Populate the lease from child-session metadata, preserve its inherited parent ids and MCP root through the port, and dispatch a child replacement with that parent/lease; keep the top-level path parentless.

## Five logic questions

1. **Silent failure:** The post-snapshot FIFO is neither transferred nor restored (finding 1).
2. **Unexpected action:** Send while the successor tab is binding; the source closes without that new input (finding 1).
3. **Wrong answer:** A bind timeout can cause an already-delivered queued task to run again on the restored source (finding 1).
4. **Dependency/process failure:** SDK stream exit without `result` leaves the coordinator held after the record is removed (finding 2).
5. **Missing requirement:** The plan never defines recovery/replay when a webview attaches mid-operation; the current event-only state broadcast has no late-listener contract (finding 3).

## Scope and evidence

Read the changed Batch B host, chat, RPC/schema, shared and port paths; the coordinator/pump/lifecycle/stream-exit paths needed to trace their contracts; the prior Batch A review and fix report; and the relevant plan. Boundary validation is present (`session-handover-rpc.schema.ts:4-43`), unavailable begin returns before arming (`session-handover-coordinator.service.ts:143-162`), cancel is operation-id/phase scoped (`:257-274`), acknowledgement verifies operation and both tabs (`child-chat-session-host.adapter.ts:133-149`), and headless CLI reporting is supported by the CLI manager's empty active-webview list (`cli-webview-manager-adapter.ts:51-53`). The only source turns found during an active operation are the coordinator-owned compact (`session-stream-pump.service.ts:95-103`) and the plan's explicit `/compact`/`/clear` exemption (`chat-session.service.ts:928-936`); all ordinary pump callers pass the common admission gate (`session-stream-pump.service.ts:252-280`). No tests/builds/typechecks were run. Scoped diagnostics were unavailable after 45 seconds with all seven requested files unchecked.

Score rationale: 3/10 reflects two independent held-input loss/exactly-once failures plus two likely runtime integration gaps. Removing the two blocking paths would move this to 5–6; an end-to-end late-attach/child-lease implementation and focused failure tests would be needed for 7+.
