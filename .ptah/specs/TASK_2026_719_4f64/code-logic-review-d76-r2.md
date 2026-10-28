# D76 scoped re-review

**Score: 9/10. Verdict: APPROVED.** All three prior findings are closed. No new Blocking, Serious, Moderate, or Minor defects identified in the review fixes.

| Prior finding | Result and evidence |
| --- | --- |
| 1 — retry joins old initialization | **Closed.** `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts:570` drains in-flight initialization before deciding what to do. At line 582, an initialized adapter reconciles current auth; otherwise line 589 starts a fresh pass. The deferred-auth spec at `sdk-agent-adapter.spec.ts:1111` verifies no overlapping pass and a fresh successful retry after A fails. |
| 2 — stale zero-folders guard | **Closed.** `sdk-agent-adapter.ts:576` rechecks folders after draining and before either auth action. `sdk-agent-adapter.spec.ts:1152` covers opening B and closing the last folder before queued execution. |
| 3 — timer-only preparation deadline | **Closed.** `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts:487` rejects before starting expired preparation; line 504 rejects a result that wins the race after expiry. Specs at `chat-session.account-binding.spec.ts:1017` and `:1039` cover clock advancement without a timer turn and expiry before preparation starts. |

The drain loop only awaits externally started passes; it does not schedule retries. `initialize()` clears its own in-flight slot in `finally`, and the existing adapter queue continues to serialize reset/config passes. There is no await between the final folder/state checks and starting the chosen auth action. The ordinary initialized workspace-change branch is unchanged; successful initialization during the drain uses its existing auth reconciliation method. Its success-during-drain branch was checked statically but has no dedicated new spec.

Ambient preparation still returns before the clock checks. Timer cleanup, late-rejection observation, the public refusal shape, and deadline forwarding remain intact. The executor changes are unchanged from round one, preserving the earlier identity-proof and M1 conclusions. Previously disclosed preparation cancellation and pre-selection-await limitations remain outside these three fixes.

Compared `bugfix-d76-r2.diff` with the original saved diff and read the affected source, new specs, and fix notes. Static review only: no source edits, commits, builds, tests, or installs; separate verification was not run or independently confirmed.
