# Code Logic Review - Batch 7 (one usage reader + live push)

Scope: diff read in full for codex-account-usage.service.ts, codex-runtime.ts (RateLimitsObserver), codex-runtime-composition.ts; specs skimmed by name only. No checks were run (user forbade them), so compile and test status is unverified.

| Metric | Value |
| --- | --- |
| Score | 5/10 |
| Verdict | REQUEST CHANGES |
| Blocking | 1 |
| Serious | 1 |
| Moderate | 4 |

## Blocking

### B1. A released contextId is rejected forever, so live push dies after the first context cycle
- `codex-account-usage.service.ts` `releaseRateLimitsContext` adds the id to `releasedLiveContexts`; `applyRateLimitsUpdated` returns null for any id in that set. Nothing removes an id except `attachCoreClient` / `close` / `detachCoreClient`.
- `codex-runtime.ts` (`open`): the same `profile.contextId` is reopened with `generations.get(contextId) + 1` (resume path). The new observer's `dispose` and the old one's `onClosed` both call `onContextClosed`, and the first call poisons the id.
- Scenario: a session's process closes or fails and the session is resumed with the same contextId. Every later `account/rateLimits/updated` is silently dropped (returns null, no log). The user sees stale limits until a manual pull.
- Fix: clear the id from `releasedLiveContexts` when a context is (re)opened (add an "opened" hook or have `applyRateLimitsUpdated` accept a generation), or drop the released-set and rely on the observer's own `disposed` flag. Add a spec: release, reopen same id, update accepted.
- Caveat: I did not confirm in the chat adapter that contextId is stable across reopen, but the `generations` map keyed by contextId implies it is.

## Serious

### S1. First notification on a cold cache is discarded
- `performLiveRead` does `client.read(home)` (non-refresh) first. If the cache is cold or expired this fetches fresh data, so `cached.fetchedAt > update.observedAt` and the function returns null. The fresh data never reaches `recordWindowEvidence`, so no `planLimits:changed` push occurs for that notification.
- Same effect when a pull read lands between the notification and the live read.
- Fix: treat `fetchedAt >= observedAt` as fresh evidence and map it directly, instead of rejecting it as stale; reject only `fetchedAt < observedAt` after the refresh.

## Moderate
- Every accepted notification forces `refresh: true` (a usage RPC). Only per-context coalescing exists; a burst of notifications during a turn triggers repeated refreshes. Add a minimum interval or trailing debounce.
- `RateLimitsObserver.buffer` is not cleared on respawn (`spawner.spawnProcess` wrapper): a partial line from the old process is concatenated with the new one. Harmless (JSON parse fails, line skipped) but can drop the first valid frame.
- `releasedLiveContexts` grows by one id per closed context for the process lifetime (small, but unbounded).
- Electron: the shared client is the first scope's client and is held after that scope's container is disposed (`codex-runtime-composition.ts` close path skips `usage.close()` but still calls `container.dispose()`). If the client holds scope-resolved ports (spawner, store), they are disposed under it. Not verified; confirm the client only uses host-owned ports.
- `attachCoreClient` resolve can throw after `sharedUsage.client` is assigned (assignment precedes attach), leaving the client set but unattached; the next scope will not retry.

## Five questions (short)
1. Silent failure: B1, S1 (both return null without a log).
2. User action: resume a session after close, then watch limits not update (B1).
3. Wrong answer: none found; owner key and fetchedAt checks guard cross-account mixing.
4. Dependency failure: callback errors are caught and logged by class only; usage read rejection propagates inside `performLiveRead` and is caught by the observer's `.catch` (OK).
5. Missing: no rate limiting of refreshes; no test for context reopen.

## Verdict
REQUEST CHANGES. The design (single reader, owner and stale checks, sanitized logging, disposal on binding dispose) is sound; B1 makes the live push unreliable in the main resume scenario.
