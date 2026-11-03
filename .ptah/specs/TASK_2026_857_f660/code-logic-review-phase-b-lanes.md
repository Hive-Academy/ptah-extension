# Code Logic Review - Phase B lane batches (B13, B14, B15, B16, B17, B21)

## Verdict

REVISE, 7/10. The cache, queue, hook and setting logic is sound and fails closed or open in the right places. One Electron composition defect can break the quit sequence and needs a three-line fix (finding 1). Nothing else blocks.

Verification: not run (optional). The review is by reading HEAD code and the six diffs. B18/B19 were read only as context (`host-routing.coordinator.ts` admit, apply and dispose paths).

## Review family

Reviewer: claude (Sonnet 5.5). The batch reports (`batch-13..17-report.md`, `batch-21-report.md`) do not name the implementing lane. The commit trailers all say "Claude Opus 5.5" because the team-leader commits. I treat B13-B17 and B21 as non-Claude lane work, as the brief says. I could not confirm per batch, so the evidence is labelled "cross-family, unverified". If any batch was done by a Claude subagent, that batch's evidence is same-family, weaker.

## Findings

1. **Moderate (risk of data loss on quit), fix before merge.** `apps/ptah-electron/src/di/phase-4-handlers.ts` (the `app.once('will-quit', ...)` block, around :99-105) resolves `CHAT_TOKENS.HOST_ROUTING_COORDINATOR` with no try/catch.
   - Scenario: the coordinator is a lazy singleton (`register-host-routing.ts:68-71`). It is normally built when `ChatSessionService` is first resolved. If the user quits before that (quit during boot, where `main.ts` has `abortBoot`), this `resolve` constructs it at quit time. That drags in `PTAH_API_BUILDER`, `SCOPE_CHECK_SERVICE` and `ROUTE_DECIDE_SERVICE`, any of which can throw in a half-booted container.
   - Effect: this listener is registered before main's `will-quit` handler (`main.ts:416`). An exception thrown from an `emit` listener stops the remaining listeners, so `handleWillQuit` is skipped. That handler holds `flushSessionMetadataStores`, `flushWorkspacePersistence` and the LIFO disposal.
   - Creating the coordinator at quit is itself pointless: it subscribes to events and is disposed immediately. It is also a problem, because it can run model-adjacent construction on the exit path.
   - Smallest fix: wrap the body in `try { ... } catch { /* degradation-audit: reported */ }`. Better, build the coordinator only when it already exists. For example, have `registerHostRouting` register an `instanceCachingFactory`-style holder, or keep the instance in a module variable set by an `afterResolution` hook, and dispose only that.

2. **Moderate.** `libs/backend/lane-routing/src/lib/route-decide.service.ts` (reuse block added in B14, around :122-143) returns the cached host result for any pre-flight call from that session key. It ignores the caller's `request`.
   - Scenario: scope S is agreed and cached at revision R. The user then asks for a smaller, different item inside the same revision, and the model calls `ptah_route_decide` pre-flight with that request. The scope check may answer "same work, no material change", or it may fail and call `markUnknown` (which is safe). In the same-work case the model gets S's task type and depth with `usage.requests: 0`, and the reason string "reused host pre-flight result" is the only hint.
   - This matches Req 6 as written. The result is advisory.
   - Smallest fix, optional: when the reuse hit happens, also check that the request text is the host summary or a prefix of it. Otherwise record a defer candidate. No change is needed for approval.

3. **Moderate (hardening).** `libs/backend/lane-routing/src/lib/scope/host-routing-setting.ts:18` uses `stored !== false`.
   - Scenario: `settings:set` writes any value for this key as given. There is no ADVANCED_SETTINGS descriptor, see `settings-rpc.handlers.ts:196-205`. `settings:import` also accepts the key through `KNOWN_CONFIG_KEYS` (`settings-export.types.ts:92`). Stored `"false"`, `0` or `null` leaves routing ON.
   - The spec pins `'invalid'` as enabled (`host-routing-setting.spec.ts`), so this is deliberate. It is inconsistent with the "unreadable value disables" intent stated in the `catch` comment (:19-21).
   - The UI only writes booleans and reads back, so it is safe in practice.
   - Smallest fix: `typeof stored === 'boolean' ? stored : true` is the same behaviour, stated explicitly. If the intent is fail-closed, use `stored === true || stored === undefined`. Add an advanced-setting boolean descriptor so `settings:set` rejects non-booleans.

4. **Minor.** `libs/backend/agent-sdk/src/lib/helpers/next-turn-reminder.queue.ts:84-90` caps the alias map at 200 by insertion order.
   - After more than 200 distinct rekeys, an active tab's alias can be evicted. A later `put(tabId, ...)` is then stored under the tab id while the hook calls `take(realSessionId)`, so the reminder is never drained and lingers until the 200-entry cap.
   - The coordinator stores under `latestSessionKey`, which is the real session id once known (`host-routing.coordinator.ts:170`), so the practical window is small.
   - Fix: none needed now. Optionally refresh alias recency in `put`.

5. **Minor.** `libs/backend/lane-routing/src/lib/scope/preflight-reuse-cache.ts:46-57`: `put` is dropped when `continuity` is `pending`. A turn N+1 admitted while the turn N pre-flight is in flight leaves the reminder queued by the coordinator but no cache entry. The model's own `ptah_route_decide` then makes a paid call.
   - This is fail-closed and safe. It is an efficiency loss only.

6. **Minor.** `scope-check.service.ts:118-121`: the catch swallows the error type (comment says "reported"). The coordinator logs only `code: 'unavailable'`, so a systematic decision-model failure has no error class in logs.
   - Optionally log `loggableErrorName(error)` as `DecisionCaller` does (`decision-caller.ts:66`). Never log message text.

## Checks requested

- **Cache key and scoping.** The key is `getSessionTabId(callerSessionId) ?? callerSessionId` (`protocol-dispatcher.ts` routeDecideResponse). The coordinator puts under the tab id (`host-routing.coordinator.ts` settlePreflight).
  - `get` requires `continuity === 'known'`, `entry.revision === currentRevision` and a matching `modelFingerprint` (`preflight-reuse-cache.ts:60-77`). The fingerprint is `JSON.stringify(config.getSelection())`, so changing the decision model invalidates the entry.
  - Cross-session reuse is not possible, because the map is keyed per tab. On VS Code and the CLI there is no tab mapping and no `put`, so there is no hit.
  - Stale revision: `beginTurn` sets `pending` at admit, so a hit during the in-flight scope check is blocked. `confirmRevision` drops entries of other revisions. `markUnknown` clears the entry on scope failure. A stale-revision `put` is rejected. All of this is correct.
  - No TTL exists. Revision plus LRU 100 is the only bound. That is acceptable because the entry is small, in-memory and revision-validated.
  - `get` and `put` re-check the live setting and clear everything when it is off. Good.
- **Reminder drain.** It is keyed per session (`take` deletes on read), drained in the hook only when `!input.agent_id && resolvedSessionId` (`user-prompt-submit-hook-handler.ts:~88-96`). A subagent prompt therefore never drains it, and sessions never cross.
  - A throw is caught and logged by error type only. The order is reminder first, then `pointer()`. `pointer()` never rejects (documented :162).
  - The rekey from tab id to SDK session id merges by an `order` counter, and `discard` is alias-aware. This is correct.
  - Entries are single-use and capped at 600 characters and 200 entries.
- **Setting write path.**
  - UI `settings:set { key: 'agentOrchestration.hostRouting', value: boolean }` -> `isFileBasedSettingKey` (B17 added it, `file-settings-keys.ts:134`) -> `workspaceProvider.setConfiguration('ptah', key, value)` -> file settings.
  - Reader: `getConfiguration('ptah', 'agentOrchestration.hostRouting')` -> `fileSettings.get` (`electron-workspace-provider.ts:95-96`). The key, scope and value format are the same on both sides. The default `true` comes from `FILE_BASED_SETTINGS_DEFAULTS` (`:357`), and the read is live (no caching in `HostRoutingSetting`). OK, see finding 3 for non-boolean values.
  - Effective enable also requires a configured decision model, so off or unset gives zero decision-model calls: `ScopeCheckService.assess` checks before and after `openCaller`.
- **Fail-open.** The scope-check catch returns `unavailable` with zero usage. The hook drain and the reuse path both fall through to the current behaviour. A schema failure of the reused result throws a schema error to the tool caller. That is a hard failure rather than a fallthrough, but it cannot happen: `reasons` has no max (`route-decide-result.schema.ts:224`).
- **Privacy.** No logger call in the reviewed files includes prompt, scope or reply text (`decision-caller.ts:38-67` logs the provider id and the error name only). The cache stores the result with no request text. The queue holds only the 600-character formatted reminder.
  - Caveat: the scope-check request sends user text and the assistant reply to the configured decision model. That is inherent to the feature and the user chose that provider.
- **Electron DI order.** `registerLaneRoutingServices` (phase 2, `phase-2-libraries.ts:293`) comes before the `TASK_KIND_CLASSIFIER` alias (~:301). `registerHostRouting` runs in phase 4 after `registerChatServices` and after phase 3 binds `PTAH_API_BUILDER`. It checks its required tokens at bootstrap, so a missing token fails loudly at boot rather than at the first chat resolve. `ChatSessionService` is resolved after registration, so the order is fine. `startAndRegisterLaneOutcomes(..., { observeSubagentEnded: true })` is passed correctly. Quit-time resolve: see finding 1.
- **VS Code and CLI hosts.** They get the new lane-routing factories (lazy, via `instanceCachingFactory`) and an optional `reuse` dependency that never receives a `put`. `CHAT_TOKENS.HOST_ROUTING_COORDINATOR` is unbound, so `ChatSessionService` admits nothing. The `route_decide` path passes `sessionKey` there too, but the cache returns null. No behaviour change.
- **Stubs and incomplete logic.** None found. `buildPreflightScopeSummary` caps total at about 5,100 characters, inside the 8,000-character `request` limit and the 64 KiB payload limit.

## Defer candidates

- Reuse should check that the caller's pre-flight `request` still matches the cached scope (finding 2).
- Add a boolean advanced-setting descriptor for `agentOrchestration.hostRouting` so `settings:set` and `settings:import` validate the type (finding 3).
- A reuse-miss counter, so the model's own pre-flight calls that bypass the cache are observable.
- Refresh queue alias recency on `put`, or clear aliases on session end (finding 4).
- Log the scope-check failure class (finding 6).
