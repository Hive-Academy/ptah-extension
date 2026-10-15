# Code logic review R3 — commit 51fb2c3cb

## Verdict

**NEEDS_REVISION.** Finding 2 is **PARTIAL**. The new pending record closes the immediate six-failure loss path, but a live session can still lose an undelivered handoff. Static review of the four changed files and delivery boundaries. No source edited. The fix report records 79 passing targeted tests; its cap test explicitly asserts record deletion (subagent-handoff-delivery.spec.ts:174-194). Scoped diagnostics found zero errors with analyzed: null.

## Finding 2 — PARTIAL

The queue-drop callback sends with keepPending=false (subagent-handoff-delivery.ts:142-145), and all-failed sends now store a pending record (:128-140). A later main-thread message calls retryPending (subagent-budget-monitor.ts:358-373), which can deliver and remove it (subagent-handoff-delivery.ts:167-181). This fixes the R2 six-failure sequence when a later retry succeeds. It does not satisfy the no-loss requirement: five further rejected pushes delete the only record with just a warning (subagent-handoff-delivery.ts:182-193), and a stopped task cannot produce another handoff (subagent-budget-monitor.ts:894-903).

The SEND_TIMEOUT-as-delivered decision is not established by its evidence. The dispatcher races streamInput against a 10-second timer without cancelling the underlying call (subagent-message-dispatcher.ts:254-268). Retrying could duplicate a write, but timeout also does not prove that a buffered or pending write will finish or be consumed. There is no acknowledgment. This policy predates the commit and is preserved at subagent-handoff-delivery.ts:229-240 and tested at subagent-handoff-delivery.spec.ts:196-224; I do not count it as a newly introduced defect.

## New findings

1. **Blocking — retry cap discards an undelivered handoff.** Evidence: subagent-handoff-delivery.ts:167-193. Scenario: three initial sends reject, the fallback queue drops its notice, the drop-triggered three sends reject, then five later main-thread messages each prompt a rejected retry. The fifth retry deletes the sole record. Only a logger warning remains; neither parent nor owner receives the handoff or an actionable terminal failure. The cap moves R2's loss endpoint from six failures to eleven. **Fix:** retain the session-owned record until delivery is confirmed, or surface a terminal failure through an owner-visible channel before deletion. Bound memory with explicit escalation or durable state.

2. **Serious — a parent message can arrive before the pending record exists.** Evidence: subagent-handoff-delivery.ts:128-135,142-145,207-243; subagent-budget-monitor.ts:358-373,588-589. Scenario: turn-end queue clear starts the asynchronous drop-triggered send. Its retries wait 500 ms and 1 s. The next parent assistant message arrives during that interval; retryPending sees an empty map. The callback's three sends then reject and create the record after the final main-thread message. It remains invisible until release discards it. The test waits for both backoffs before the next message (subagent-handoff-delivery.spec.ts:54-63,122-140). **Fix:** register pending state before the drop-triggered send with an in-flight guard, or remember opportunities during that send and retry after it fails.

## Failure-mode checks

1. Silent success: the cap deletes the handoff and retryPending returns normally (subagent-handoff-delivery.ts:182-195).
2. User action: ending a turn drops the queued notice; a quick next parent message can miss pending-record creation (subagent-handoff-delivery.ts:142-145,207-243; subagent-budget-monitor.ts:358-373).
3. Wrong answer from input: SEND_TIMEOUT becomes settled although the timer proves only that streamInput did not settle (subagent-message-dispatcher.ts:254-268; subagent-handoff-delivery.ts:229-240).
4. Dependency failure: eleven rejected pushes exhaust the route without owner-visible escalation (subagent-handoff-delivery.ts:112-151,167-193).
5. Missing contract: there is no delivery acknowledgment or owner-visible terminal failure for a live session (subagent-handoff-delivery.ts:70-71,180-193). The inFlight guard prevents concurrent retryPending pushes of the same record (:167-179), and release sweeps released-session records (:197-204). I found no new unbounded retry loop, released-session record leak, or prompt text in changed log payloads (:122-150,184-192,224-237).

