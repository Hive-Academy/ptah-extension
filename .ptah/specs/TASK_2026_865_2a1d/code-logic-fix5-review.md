# Code Logic Fix 5 Review — `TASK_2026_865_2a1d`

## Summary

| Metric | Result |
| --- | --- |
| Verdict | **REVISE** |
| Score | **5/10** |
| Findings | 1 Serious, 1 Moderate |

The main timeout → retry sequence is closed while the host holds the old ticket. A separate early renderer release still permits a late launch to bind without any carry-over claim. The score reflects real failure paths in the new correlation contract; the bounded timeout and ordinary fresh-chat behavior keep it above the 3–4 band, while those paths rule out 7–8.

## Numbered findings

1. **Serious — a chat error releases the renderer while the host ticket and late launch remain live.** `libs/frontend/chat/src/lib/services/provider-carry-over.service.ts:434-437` deletes pending on *any* tab chat error, without an expired marker. The caller runs this for every `CHAT_ERROR` with a tab ID, before checking which session failed (`libs/frontend/chat/src/lib/services/chat-store/chat-lifecycle.service.ts:252-260`). If an old-session error arrives after launch A was admitted but before its init, A's later tagged resolution finds neither pending nor marker and returns `none` (`provider-carry-over.service.ts:448-465`). The lifecycle then attaches A as an ordinary session (`chat-lifecycle.service.ts:145-176`), without the carry-over notice. This also violates the stated invariant that the host tag cannot outlive renderer release. Preserve correlation through early errors, or retire/cancel the host launch and ensure its later resolution is skipped. Add a test for old-session error followed by A's init.

2. **Moderate — a legitimate slow init is discarded during the accepted renderer wait.** The host ends the tag at `min(admission + 90 s, receipt + 120 s)` (`libs/backend/rpc-handlers/src/lib/chat/session/chat-carry-over.service.ts:443-453`). If admission takes over 30 s after receipt, an init can arrive before the renderer's accepted-result + 90 s deadline yet without a tag. `libs/frontend/chat/src/lib/services/provider-carry-over.service.ts:373-392` aborts every such untagged resolution while pending. The user sees an expiry/retry notice for a session that did start. This is acknowledged in the implementer report, but is a real loss of the accepted launch within the advertised wait. The correlation contract needs a safe way to recognize this resolution or a shorter renderer deadline consistent with the host's tag.

## Five judgments

1. **A binds as B / refusal window:** For the specified timeout sequence, B is refused by `holdsTicket` until A's resolution claims the ticket or `blockUntil` passes (`chat-carry-over.service.ts:219-230, 432-453`). The arithmetic is bounded: tag ≤ admission + 90 s and ≤ receipt + 120 s; block ≤ admission + 210 s and ≤ receipt + 240 s. The host prunes lapsed tickets on the next launch, so there is no permanent retry refusal. A resolution retires the ticket even after tag expiry. Start errors drop a matching ticket (`:300-307`). Tab close and service disposal have no immediate ticket deletion; a closed tab's ticket stays in the map until another launch prunes it. The early-error path in Finding 1 means the design is not closed end to end.
2. **Ordinary new chat after deadline release:** Closed for the stated case. Its new tab session ID is null, so `claimExpired` returns `none` (`provider-carry-over.service.ts:476-492`); the host tag has expired by the renderer's timed release. Early `onChatError` release still leaves a live host tag, as Finding 1 explains.
3. **Untagged resolution while pending:** It no longer binds (`provider-carry-over.service.ts:380-392`). Finding 2 is a legitimate resolution now wrongly aborted when admission is slow. The old-session ID and already-bound ID exemptions avoid aborting those IDs.
4. **Residual:** An old init after `blockUntil` can claim a retry's tag and bind as B. It is bounded in time only by process behavior after the block: the initial ticket may expire by admission + 210 s or receipt + 240 s, whichever is earlier. This is an **accepted Moderate residual** under the user's no registry-change choice: rare timing, but wrong-session binding when it occurs. It is **not the only remaining gap**, because Findings 1 and 2 occur inside the intended windows.
5. **Other contracts / cleanup:** `IN_FLIGHT` is reused for a blocked retry (`chat-carry-over.service.ts:219-224`; `provider-carry-over-launch.ts:251-261`); this commit does not change `chat:continue` or the AUTH_REQUIRED refusal. `ngOnDestroy` clears renderer deadline timers (`provider-carry-over.service.ts:366-369`), and `deletePending` clears the per-tab timer (`:510-518`). Host tickets have no timers; their cleanup is claim, failure, or lazy pruning on another launch. The modified specs exercise those ordinary paths, but do not exercise Finding 1 or the slow-admission resolution in Finding 2.

## Five logic questions

1. **Silent failure:** Finding 1 attaches the late session through the normal resolution path, without a carry-over notice.
2. **Unexpected user action:** A retry inside the block gets `IN_FLIGHT` as intended; an ordinary chat error during a pending carry-over can release it early and allow the wrong binding.
3. **Wrong input/timing:** Admission more than 30 s after receipt, followed by an init inside the accepted 90 s wait, produces Finding 2.
4. **Dependency failure:** A host start failure drops its ticket; an asynchronous `CHAT_ERROR` from an old or unrelated session clears renderer pending without coordinating with the host (Finding 1).
5. **Missing requirement:** The design needs an explicit rule for chat errors that are not proof that the pending carry-over launch has retired.

## Evidence and limits

Reviewed commit `99f6a8150` via `git show`, including the committed backend service (the working-tree copy is concurrently edited), renderer service and launch module, shared constants, changed spec paths, the implementer report, previous final review, and the session-resolution lifecycle. Commit `17cb79892` contains only spec alignment and did not alter this verdict. The implementer reports 48/48 backend and 78/78 renderer scoped tests passing; I did not rerun tests, builds, Nx, or `npm run verify` under this read-only assignment. Scoped `ptah_get_diagnostics` returned unavailable after 45 s, so it supplies no typecheck evidence.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Treat the >blockUntil wrong binding as an accepted Moderate residual, while requesting revision for earlier failures. | Approve the chosen bound; or require process-level ownership. | The user chose a bounded tab ticket with no agent-sdk registry change; Findings 1–2 do not require changing that choice. | Yes. |
