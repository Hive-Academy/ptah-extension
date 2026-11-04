# Code Logic Review — `TASK_2026_865_2a1d`

Reviewer family: codex. Implementer family: claude. Phase 1 libraries only.

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 5/10 |
| Verdict | REVISE |
| Blocking / Serious / Moderate / Minor | 0 / 2 / 2 / 0 |

The core handoff preserves the old provider refusal and filters the transcript, but the readiness probe retains a live proxy, an indeterminate RPC can hold a tab indefinitely, and two state/UI edge cases remain. This is a 5 rather than 7 because normal offer checks can allocate a persistent resource and a lost launch response has no recovery. It is above 3 because the provider pin, transcript projection, and refusal paths are present and specifically guarded.

## Five logic questions

1. **Silent failure:** A `chat:carry-over` transport failure leaves the pending entry even when the request never reached the host; the tab remains busy without a recovery path (`provider-carry-over.service.ts:350-356`).
2. **Unexpected user action:** Opening a conversation that raises an offer without clicking it can start and retain a provider proxy (`chat-carry-over.service.ts:295-318`; `provider-proxy-pool.ts:38-42`). A failed `/compact` check shows extra dispatcher wording (`message-dispatch.service.ts:418-429`).
3. **Wrong input result:** A `SESSION_ID_RESOLVED` for a closed or rebound unclaimed tab rekeys liveness before the lifecycle rejects the carry-over (`chat-message-handler.service.ts:834-861`, `chat-lifecycle.service.ts:150-155`).
4. **Dependency failure:** Transcript read and provider re-check fail closed with fixed result text (`chat-carry-over.service.ts:170-185`); a transport failure instead remains pending without a deadline (`provider-carry-over.service.ts:350-356`).
5. **Unspecified case:** There is no policy for an offer-only readiness probe that starts a persistent proxy, nor for a launch whose acknowledgement is lost and whose session never resolves. Both need explicit lifecycle rules.

## Findings

### 1. Serious — Eligibility probes retain provider proxies

**Evidence:** `chat-carry-over.service.ts:295-318` calls `newSessionReady` from every check; `chat-runtime-profile.service.ts:120-139` resolves a profile; `provider-proxy-pool.ts:38-42` explicitly has no idle TTL and stops only on scope disposal or shutdown. `batch-4-report.md` A3 traces `buildProxyProviderProfile` to `proxyPool.acquire`.

**Impact:** A banner offer or `/compact` eligibility check can start a listener and reserve a credential-bearing proxy even if the user never launches carry-over. Repeated provider changes can retain a current and retired proxy generation per workspace until closure. This is a resource lifetime defect, though the probe does **not** resume or call the old provider: it passes `undefined` identity and never calls the session adapter.

**Suggested fix:** Make the check side-effect-free, or add a lease/release lifecycle for a probe-only acquisition that cannot stop an active session's proxy. Cover check without click and provider switch after check.

### 2. Serious — Lost launch acknowledgement can strand the tab

**Evidence:** `provider-carry-over.service.ts:339-356` retains pending on both thrown and failed RPC envelopes; `:440-450` prunes only closed tabs; `:287-304` and `:307-319` release it only on resolution or binding. `message-sender.service.ts:913-915` rejects subsequent sends while pending.

**Impact:** If the request never arrives or host dies before creating a session, no resolution or chat error follows. The tab stays busy for its lifetime and the user cannot retry the carry-over or send in it.

**Suggested fix:** Give indeterminate launches a bounded recovery state: query by request/tab ID or expire after a documented deadline, allowing a retry while preventing duplicate sessions if a late resolution arrives.

### 3. Moderate — Unclaimed-tab skip still rekeys liveness

**Evidence:** `chat-message-handler.service.ts:834-861` claims only when `claimedSurface` exists, then rekeys before `chatStore.handleSessionIdResolved`; `chat-lifecycle.service.ts:150-155` may subsequently return `skip` for a closed or rebound tab.

**Impact:** A skipped new session can inherit the placeholder's streaming liveness. The tab itself is not attached, but a stale workspace activity indicator can persist or be associated with the wrong session until another terminal event arrives.

**Suggested fix:** Claim before rekey on both surface paths; pass the claim into lifecycle or make claim idempotent so a skipped resolution cannot mutate liveness. Add a closed/rebound unclaimed-tab test that asserts the liveness map.

### 4. Moderate — P4 message is not the specified text

**Evidence:** `message-sender.service.ts:262-265` returns `"Couldn't check this conversation. Try /compact again."`; `message-dispatch.service.ts:418-429` prepends `Message delivery failed. ` to every send failure.

**Impact:** The user sees a misleading delivery failure even though no message was dispatched. The resulting text is not the specified fail-closed copy.

**Suggested fix:** Let this check-failure outcome render the fixed text directly, without the generic send-failure prefix; retain the current no-send behavior.

## Required focus items

1. **A3 — Finding 1.** The warm proxy is a retained resource, not a call to the old provider. `chat-carry-over.service.ts:311-318` calls `prepare(..., undefined, true)` for the active provider and does not call an adapter; the pool has no idle TTL (`provider-proxy-pool.ts:38-42`).
2. **Unclaimed-tab rekey — Finding 3.** Claimed-surface skip runs before rekey; unclaimed-tab skip runs after it (`chat-message-handler.service.ts:834-885`).
3. **P4 text — Finding 4.** The generic prefix changes the visible copy (`message-dispatch.service.ts:427`).
4. **Dismiss / Open Settings — OK for late carry-over results.** These actions clear the current banner synchronously (`chat-view.component.ts:373-385`). A late offer checks generation (`provider-carry-over.service.ts:168-178`); late failure checks `ownsUi` (`:371-415`, `:425-434`); binding clears by generation (`:307-319`). A dismissed banner cannot be reopened by these paths, and a newer banner cannot be cleared by the old completion. Passing the captured generation to the click handlers would also protect against a stale UI event, but that is not a demonstrated late-result failure.
5. **F1 — OK.** `launchSdkSession` calls `assertCarryOverProvider` after `prepare` on every runtime branch and before `pendingLineage.set` and adapter calls (`chat-session.service.ts:1554-1609`); it re-reads the active resolver and checks the served provider, including an absent resolver (`:1048-1070`).
6. **F3 — OK for claimed surface.** `skip` suppresses surface and tab binding, `bind` calls surface registration then lifecycle attachment, and `none` keeps the existing surface path (`chat-message-handler.service.ts:840-880`). The separate unclaimed path has Finding 3.
7. **Refusals — OK with the documented P4 exception.** `git diff main...HEAD -- libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts` shows changes to start/launch only, not `continueSession`; the `chat:continue` AUTH_REQUIRED result contract remains byte-identical. The `/compact` fallback still calls the original `chat:continue` request (`message-sender.service.ts:919-975`) when check says ineligible or provider mismatch is unknown. A known mismatch plus failed check intentionally uses P4 fail-closed text, so it does not take that refusal path.
8. **Transcript safety — OK within the stated pattern guarantee.** The reader uses a 2 MiB JSONL tail and abort signal (`session-history-reader.service.ts:965-1006`). Projection discards system, sidechain, hidden records and non-text blocks (`:1022-1056`; `history-event-factory.ts:596-620`); tool I/O and attachments become labels. Redaction precedes the 48,000-character transcript budget (`chat-carry-over-transcript.ts:44-69`, `:83-140`). Logs and result paths contain IDs, counts and error classes, not transcript content (`chat-carry-over.service.ts:198-236`, `session-history-reader.service.ts:999-1005`). The guarantee covers known secret patterns; arbitrary secrets in plain conversation text remain outside it.

## Style: new public RPC methods

`chat:carry-over-check` and `chat:carry-over` follow neighboring `chat:*` naming and are registered in the handlers' method list (`chat-rpc.handlers.ts:125-138`, `:418-439`). Both use strict Zod request schemas with UUID, path, name and boolean bounds (`chat-rpc.schema.ts:159-187`). Their request/result contracts and method map live in `libs/shared/src/lib/types/rpc/rpc-chat.types.ts:471-508` and `rpc.types.ts`; no host-specific type is exposed. Expected failures use a discriminated result with fixed text; malformed parameters raise `RpcUserError(..., 'INVALID_PARAMS')`, consistent with a public RPC boundary. The two result shapes differ intentionally: the check reports eligibility, while the action reports start failure reasons.

## Verification and limits

Reviewed `git diff main...HEAD -- libs`, task description Revision 2, implementation plan Rev 3/3.1, batches and reports, decisions, root `CLAUDE.md`, and the implementation paths cited above. No tests or Nx commands were run, as instructed. Scoped `ptah_get_diagnostics` was attempted for three changed files; the TypeScript compiler had not finished within 45 seconds and reported them unchecked, so this review makes no typecheck claim. Phase 2 native Codex transcript support was excluded from the verdict.

## Decisions

- Treat an offer-only proxy acquisition as a resource lifetime issue. Options were accept a warm process until workspace disposal or manage the probe lease. Evidence: `provider-proxy-pool.ts:38-42` has no idle TTL; the check does not need a session. This is reversible.
- Treat a lost RPC envelope as indeterminate rather than definitive failure. The host may have started a session, so simply clearing pending immediately risks duplicates; a bounded reconciliation is the recommended reversible approach.

## Clarifications Needed

None for the review verdict.
