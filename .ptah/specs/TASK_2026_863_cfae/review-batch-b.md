# Batch B code logic review — TASK_2026_863_cfae

**Verdict: CHANGES.** The root coordinator is eagerly injected by `ChatStore` (`chat.store.ts:106-114`), and adoption arms source closure only after `adoptHandoffTab` returns `adopted` (`agent-session-adoption.service.ts:317-322`). Two failure paths still prevent a reliable automatic hand-off.

| Severity | File:line | Problem | Suggested fix |
| --- | --- | --- | --- |
| major | `libs/frontend/chat/src/lib/services/session-auto-handoff-coordinator.service.ts:120-121,234-253` | A transient skill-probe or send failure sets a future `Date.now()` gate, but nothing wakes the effect when that time arrives. A settled tab at `limit` can remain unchanged indefinitely, so the promised retry never occurs. The spec at `session-auto-handoff-coordinator.service.spec.ts:423-447` manually patches the budget after advancing time and misses this case. | Schedule one cancellable wake-up for the earliest pending retry, or use an existing reliable session event. Recheck qualification at wake-up and test retry with no tab update. |
| major | `libs/frontend/chat/src/lib/services/session-auto-handoff-coordinator.service.ts:180-187` | When a slash command is the first queued item during streaming, `sendOrQueueMessage` reports success and a queue head with no `heldCommand` (`message-dispatch.service.ts:235-239`). The coordinator keeps its `fired` claim and returns. If the later queue flush fails, `sendQueuedMessage` restores the queued text (`message-dispatch.service.ts:302-320`), but the claim is never released or reconciled. The automatic hand-off can remain unsent with no new attempt. | Observe completion/failure of the queued head, or add a queue outcome signal/callback. Release the claim on a confirmed failed flush while avoiding duplicate sends when the text remains queued. Test the streaming queue-head failure path. |
| minor | `libs/frontend/chat/src/lib/services/session-auto-handoff-coordinator.service.ts:234-249` | `MAX_FAILED_ATTEMPTS` is 5, but `failures > MAX_FAILED_ATTEMPTS` gives up on the sixth failed attempt. | Change the comparison or clarify that five *retries* after the initial attempt are intended. |

## Five logic questions

1. **Silent failure:** A transient probe failure can leave the session at `limit` without a retry because elapsed time is not reactive (`session-auto-handoff-coordinator.service.ts:120-121,234-253`).
2. **User action:** If the user streams until the limit and the queued hand-off send later fails, the fired claim can remain while the command is unsent (`session-auto-handoff-coordinator.service.ts:180-185`; `message-dispatch.service.ts:318-320`).
3. **Input data:** A valid budget on a mounted background tab is included through `backgroundTabsRevision` and `findBackgroundTabs` (`session-auto-handoff-coordinator.service.ts:100-109`); no separate malformed-budget failure was established in this review.
4. **Dependency failure:** Immediate send failure releases the claim (`session-auto-handoff-coordinator.service.ts:174-178`); a subsequent queued-head send failure does not reach that branch.
5. **Unstated case:** Retry must progress when a session has no further tab updates; the current spec requires an artificial update (`session-auto-handoff-coordinator.service.spec.ts:442-445`).

**Verification:** Read task, research, decisions and Batch B report; traced coordinator, claim store, adoption, source closer, cross-partition close, queue dispatch and relevant specs. `ptah_get_diagnostics` timed out while checking three scoped files; it reported no completed diagnostic result. No build or tests were run. Remaining uncertainty: the full project test result was still pending in `batch-b-report.md` when reviewed.
