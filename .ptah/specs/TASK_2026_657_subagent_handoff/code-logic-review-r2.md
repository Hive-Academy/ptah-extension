# Code logic review R2 — subagent handoff fixes

Reviewed commit `45485a0c1` against the five findings in `code-logic-review.md` and the fix report. Static review only; no tests, builds, Nx commands, or code changes were run.

| R1 finding | Status | Evidence |
| --- | --- | --- |
| 1. Foreground notice lost on queue eviction | FIXED | `main-thread-notice-queue.ts:64-77,117-120` calls `onDropped` on eviction/clear; `subagent-handoff-delivery.ts:67-73` routes that notice to a user turn. |
| 2. Failed background send loses handoff | PARTIAL | `subagent-handoff-delivery.ts:88-142` retries and queues a fallback, but `:127-132` discards it after the final drop-triggered send fails; `:105-114` also abandons a `SEND_TIMEOUT` with no confirmed read. |
| 3. File operation can hold handoff indefinitely | FIXED | `subagent-handoff-files.ts:121-135` races file work against 5 seconds and clears the timer; `subagent-budget-monitor.ts:840-875` sends one degraded handoff after expiry. The late file result cannot trigger another send. |
| 4. Hard-stop message lacks a task output reference | FIXED | `subagent-budget-monitor.ts:715-719,858-864` correlates the spawning result's output path with its tool call and task id; `subagent-handoff-message.ts:89-93` names the path or explicitly says it is not yet known and gives the task id. |
| 5. Unknown workspace omits notes status | FIXED | `subagent-handoff-files.ts:118-120` returns no paths; `subagent-handoff-message.ts:80-87` explicitly says the notes file is unavailable because the workspace is unknown. |

**Verdict: NEEDS_REVISION.** Finding 2 still has a reachable silent-loss endpoint after a successful stop.

## Per-finding assessment

1. **FIXED.** An evicted foreground notice now starts a user-turn send (`main-thread-notice-queue.ts:71-77`; `subagent-handoff-delivery.ts:68-73`). `take` removes notices without calling the drop callback, and `withdraw` removes only a pending matching notice (`main-thread-notice-queue.ts:85-113`). The queue-eviction failure from R1 is addressed. Ultimate send failure is covered under finding 2.
2. **PARTIAL.** Background delivery has three attempts with bounded backoff, then places the text in the main-thread queue (`subagent-handoff-delivery.ts:88-143`). On a queue drop, the callback calls `send(..., false)` (`:134-138`); if all three attempts fail again, `:127-132` logs and returns with no pending notice. A timeout is also treated as success-possible and returned without an acknowledgment (`:105-114`); `subagent-message-dispatcher.ts:254-268` proves only that `streamInput` failed to settle in 10 seconds, not that the parent read the message. Preserve an observable, session-owned pending handoff until a delivery acknowledgment, or surface a terminal delivery failure to the parent/owner; handle indeterminate timeout with an idempotent acknowledgment protocol so retry cannot duplicate it.
3. **FIXED.** File work is time-bounded (`subagent-handoff-files.ts:121-135`). The monitor continues to compose and deliver after `prepareHandoffFiles` resolves (`subagent-budget-monitor.ts:840-875`). Its single race result means a late save or stat does not cause a second notice.
4. **FIXED.** A known background output path is recorded from the spawning tool result (`subagent-budget-monitor.ts:715-719`) and included with the task id (`subagent-handoff-message.ts:89-93`). When the path is not yet known, the message says so and points to the notification for that exact task id. This meets R1's explicit-unavailable-with-id alternative.
5. **FIXED.** The notes line is unconditional and gives an explicit unavailable status for unknown workspaces (`subagent-handoff-message.ts:80-87`).

## New defect introduced by the fix

- **Terminal fallback can discard an undelivered notice.** The new drop callback posts a user-turn send (`subagent-handoff-delivery.ts:134-138`), but sets `keepPending=false`; after three more ordinary rejections, `:127-132` only logs and drops the handoff. A reachable sequence is: the background send rejects three times, its queued fallback is cleared at turn end (`session-budget.service.ts:262-268`), then the final send rejects three times while the session remains live. The queue is empty and the stopped task cannot generate another handoff (`subagent-budget-monitor.ts:819-826`). **Fix:** retain a session-owned pending record through terminal delivery failure, with explicit acknowledgment or escalation; do not treat a warning log as delivery.

No separate timer or retry continuing unbounded after session end, second notice from a late file write, or prompt/task text in the changed log calls was found. A retry wait may finish after release, but the live-session check precedes its next push (`subagent-handoff-delivery.ts:89-97`; `subagent-budget-monitor.ts:570-584`).
