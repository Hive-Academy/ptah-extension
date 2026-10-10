# Gateway provider-snapshot logic review

## Re-review

Score: **9/10**  
Verdict: **APPROVED**

| Prior finding                                                         | Status    | Evidence                                                                                                                                                                                                                                                                                                                                                                                                              |
| --------------------------------------------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Preparation could bypass the watchdog and wedge a conversation     | **FIXED** | `gateway-chat-bridge.ts:453-515` races all preparation against the 60-second deadline, clears the timer in `finally`, then cancels, stops typing, removes the route, records the terminal failure, and returns. The late preparation promise has a rejection handler (`:456-458`) and its fulfilled value is never consumed after timeout. Session creation is only reachable after `prepared !== null` (`:516-531`). |
| 2. Missing inactive-resume and indefinitely-pending-resolver coverage | **FIXED** | `gateway-chat-bridge.spec.ts:2570-2594` takes the inactive persisted-session branch and asserts both `model` and `providerProfile`. `:2736-2830` uses fake timers and a never-settling resolver to assert no session starts, cleanup and failed terminal state, queue release, a succeeding next turn, and no effect from a late resolver result.                                                                     |

No new logic defects found in this static re-review.

The five early exits retain their prior reply, failed outcome reason, terminal state, and ordering: the helper at `gateway-chat-bridge.ts:1044-1054` performs the existing `sendErrorQuietly` then `recordTurnOutcome` then `markInboundTurnState` sequence, while callers retain their original inputs at `:393-401`, `:405-411`, `:474-480`, `:485-493`, and `:507-513`. The preparation timeout correctly has no seal or session-end work because it exits before either session is created or the ordinary turn `finally` is entered.

Score: **5/10**  
Verdict: **REVISE**

The profile is correctly threaded through the session-start and resume variants, and the expected authentication failure is cleaned up as an early exit. The score is above the 3–4 band because the direct paths, failure state, and DI registration have concrete coverage. It is below the 6 band because a normal proxy-start dependency stall can permanently block one conversation, precisely defeating the turn watchdog's queue-progress guarantee.

## Findings

1. **Major — provider resolution can wedge a conversation indefinitely before the watchdog exists.**
   - Evidence: `gateway-chat-bridge.ts:437-459` starts typing, adds `activeRoutes`, then awaits `resolveSdkContext` and `resolveProviderProfileForWorkspace`; the watchdog is not constructed or raced until `gateway-chat-bridge.ts:547-564`. Proxy-backed providers await `proxyPool.acquire(...)` at `workspace-provider-profile-resolver.ts:356-366`, with no deadline at that boundary.
   - Failure scenario: the local proxy spawn/acquire promise stalls (for example, a child process or its readiness check never settles). The inbound row remains `running` (`gateway-chat-bridge.ts:363-367`), the typing interval and route remain live (`gateway-chat-bridge.ts:426-437`), and the per-conversation enqueue promise never settles, so `turnTracker.end` at `gateway-chat-bridge.ts:351-354` never runs. Later messages for that conversation remain queued forever; the advertised ten-minute recovery cannot fire.
   - Suggested fix: establish the cancellation/watchdog scope before all awaited turn preparation, including SDK context and provider-profile resolution. On timeout, cancel the continuation, stop typing, remove the route, emit the normal timeout outcome/state, and ensure a late resolver completion cannot start a session or affect the next queued turn. A resolver/proxy acquisition timeout with the same cancellation guard is also acceptable.

2. **Minor — the new tests do not exercise the persisted-but-inactive resume branch or a resolver that never settles.**
   - Evidence: the sole profile resume test forces `isSessionActive()` to `true` at `gateway-chat-bridge.spec.ts:2546-2567`; it therefore covers only `openStream`'s first resume call at `gateway-chat-bridge.ts:759-769`, not the persisted-id/inactive call at `gateway-chat-bridge.ts:771-785`. The fallback test also starts from the active branch (`gateway-chat-bridge.spec.ts:2570-2576`). No test holds `resolveProviderProfileForWorkspace` pending while advancing the watchdog; the existing watchdog race begins only after preparation in production (`gateway-chat-bridge.ts:547-564`).
   - Failure scenario: a future edit drops `providerProfile` from the inactive persisted-session resume, or a proxy acquisition stalls. The current focused suite still passes while either regression ships; the latter leaves a chat thread permanently busy.
   - Suggested fix: add one test with a persisted session and `isSessionActive()` false that asserts both model and profile on `resumeSession`, and one fake-timer test with a pending resolver that proves watchdog cleanup, terminal failed state/outcome, queue release, and that a late resolver completion cannot invoke the adapter.

## Decisions

- This was a static-only review. No tests, builds, typechecks, lint, Nx, or Jest commands were run, per the review request. `git diff --check` reported no whitespace errors.
- `chat-session.service.ts` changes are formatting-only: the only diff is the trailing comma in the `deliverHandoverInputs` error return at `chat-session.service.ts:805-812`; its control flow and values are unchanged.
- User-visible `AuthRequiredError.message` is not sourced from credentials here. The resolver constructs it from a provider display name and recovery wording at `workspace-provider-profile-resolver.ts:127-142`; keys/tokens only populate the profile (`workspace-provider-profile-resolver.ts:249-264`, `377-392`) and are not included in that message. This conclusion is limited to the resolver's own `AuthRequiredError`, not arbitrary third-party errors impersonating that class.

## Verified OK

1. **All SDK session paths receive the one resolved profile.** `openStream` passes the same destructured `providerProfile` to both active and persisted-id `resumeSession` calls (`gateway-chat-bridge.ts:757-785`), `startNew` passes it to `startChatSession` (`gateway-chat-bridge.ts:799-817`), and `tryFallbackStart` forwards the same `TurnProvider` (`gateway-chat-bridge.ts:913-928`). The primary start, active-resume, fallback, and `undefined`-profile assertions are meaningful unit assertions at `gateway-chat-bridge.spec.ts:2522-2544`, `2546-2567`, `2570-2597`, and `2599-2620`.
2. **Auth-required early-exit cleanup has parity for owned resources.** Before returning it stops typing and removes the active route (`gateway-chat-bridge.ts:460-463`), drains-and-discards the error body through `sendErrorQuietly`/`sendError` (`gateway-chat-bridge.ts:466`, `974-983`), records a failed outcome and terminal inbound state (`gateway-chat-bridge.ts:467-472`). It intentionally does not seal because it returns before the seal is owned; the focused test asserts no adapter invocation, discard, failed outcome/state, and no completion (`gateway-chat-bridge.spec.ts:2623-2663`).
3. **Model consistency is preserved.** The selected model is resolved once (`gateway-chat-bridge.ts:451`), supplied to the profile resolver (`gateway-chat-bridge.ts:455-458`), retained in `TurnProvider` (`gateway-chat-bridge.ts:452-459`), and passed to both resume variants and new-session start (`gateway-chat-bridge.ts:757-817`). The start test asserts resolver model and adapter model are both `opus` (`gateway-chat-bridge.spec.ts:2522-2544`).
4. **Electron DI order and module boundary are valid by inspection.** Auth providers register before the SDK and gateway bridge (`phase-2-libraries.ts:197-209`, `479-483`); the required resolver token is registered by auth-providers (`auth-providers/src/lib/di/register.ts:103-107`). Both projects are `scope:extension`, `type:feature` (`gateway-chat-bridge/project.json:6`, `auth-providers/project.json:6`), allowed by the scope and feature constraints (`eslint.config.mjs:260-262`, `376-383`). Static import search found the dependency only in the gateway-to-auth-providers direction (`gateway-chat-bridge.ts:69-72`), not vice versa.
5. **Other resolver failures do not silently succeed.** They use the existing generic context-error reply, failed outcome, and failed inbound state before rethrowing to the queue's established catch (`gateway-chat-bridge.ts:474-490`); the added test asserts the no-session and terminal-error behavior (`gateway-chat-bridge.spec.ts:2665-2694`).

## Five logic questions

1. **Silent failure:** the pre-watchdog resolver stall produces an indefinitely “typing/running” conversation with no user reply or timeout, rather than an explicit failure (`gateway-chat-bridge.ts:437-459`, `547-564`).
2. **Unexpected user action:** sending another message to that same chat after a stalled proxy resolution queues it behind the stuck turn (`gateway-chat-bridge.ts:343-354`).
3. **Wrong-answer input:** no reviewed input produces a cross-workspace provider answer: the effective workspace root and the exact selected model are passed into the one profile resolution (`gateway-chat-bridge.ts:410`, `451-458`), then reused.
4. **Dependency failure/timeout/malformed shape:** ordinary rejection is fail-closed and reported; `AuthRequiredError` is user-actionable (`gateway-chat-bridge.ts:460-490`). A dependency that never settles is the Major finding. The typed resolver contract constrains its successful return to `ProviderProfile | undefined` (`workspace-provider-profile-resolver.ts:99-102`), but static review cannot prove a malformed runtime dependency cannot violate that contract.
5. **Requirement gap:** the stated watchdog guarantee covers hung streams but not newly added pre-stream preparation. The requirement needs an explicit deadline/cancellation policy for provider resolution and proxy startup.
