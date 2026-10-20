# Code Logic Review — TASK_2026_593_7c2e follow-ups (F1/F2)

Scope: uncommitted diff (12 files) in worktree attention-followups. Static review only; no nx/jest run.

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 7/10 |
| Assessment | NEEDS_REVISION (one item) |
| Blocking | 0 |
| Serious | 1 (M6 dismissed-notice suppression) |
| Moderate | 3 |

Per item: 1 R2 APPROVED with a Moderate caveat; 2 Holder unregister APPROVED; 3 M9 APPROVED (Minor notes); 4 M6 REVISE; 5 X2 APPROVED.

## Item 1 — R2 stale older-history alert (chat-view.component.ts:262-278, 1159-1166)

Verified:
- Live appends no longer clear it: identity check on `messages` is gone; the computed (:268-277) keys only on claudeSessionId + `cursor === null`. `prependHistoryMessages` / appends do not touch either.
- Ordering of the stale path is sound: `HistoryPagingService.runLoadOlder` sets cursor `null` (history-paging.service.ts:88) before returning `'stale'`; the component snapshots afterwards (chat-view:296-302), so the effect does not clear a fresh snapshot.
- Reopen: `applyResumingSession` (tab-manager.service.ts:2930, sets `olderHistoryCursor: undefined` at :2944) then `recordTail` sets `null`/string only after the resume RPC (history-paging.service.ts:37). The effect (chat-view:1159) runs on the CD pass triggered by the first write, long before the RPC returns, so the transient `undefined` is observed in practice. Effect reads `staleOlderHistory`, tab lookup signals; writing a signal in an effect is fine in Angular 22 (no `allowSignalWrites` needed).
- Closed tab / different session: cleared by the effect; the computed also hides it immediately.

Findings:
- Moderate: revival depends on the effect observing the transient `undefined`. The computed alone would show the alert again whenever a reopen of the same session ends with `cursor === null` (same sessionId, null again), which is exactly the case the old `messages` identity guard covered. If any reopen path writes `undefined` and `null` without a CD pass between them (a cached/no-await resume, or a hidden/not-yet-checked view), the stale "Earlier history changed" text reappears on a freshly loaded session. Sturdier option: stamp the snapshot with something that changes on reopen and not on appends (e.g. id of the first message, or a per-tab resume epoch), instead of relying on observing a transient.
- Minor: spec (chat-view.component.spec.ts:679-697, 718-726) covers append survival, `undefined` then fresh cursor, and tab closed then re-added with `null`. It does not cover `undefined` then `null` for the same session with a tick between, which is the main reopen path. Add it.

## Item 2 — AppsFocusTarget.unregister (apps-focus-target.ts:11-13, apps-session.service.ts:188)

- Identity-safe: `unregister` clears only if `this.source === source`; `sessionId` is a stable `computed` (apps-session.service.ts:167), so the same reference is passed to register and unregister.
- `DestroyRef` injected in the constructor (injection context) is valid. Service is `providedIn: 'root'`, so the hook fires at injector teardown (tests, HMR); production behaviour unchanged, no harm.
- Specs: stale-unregister no-op (apps-focus-router.service.spec.ts:50-61) and teardown clears (apps-session.service.spec.ts:261-262; `target` is a root instance retained across `resetTestingModule`, so the assertion is meaningful).
- No issues. Minor: `AppsFocusRouter` provider is not in the webview app.config (only setup-wizard and harness-builder at app.config.ts:322-323); that is outside this diff, so not assessed.

## Item 3 — M9 cross-workspace focus (setup-wizard / harness-builder focus routers)

- WORKSPACE_COORDINATOR is provided in the single webview app config (apps/ptah-extension-webview/src/app/app.config.ts:292) that is also where both routers are registered (:322-323), shared by Electron and VS Code webview. A required `inject` is therefore safe there. Compare `ElectronLayoutService`, which uses `{ optional: true }` (electron-layout.service.ts:69); a standalone consumer of these routers without that provider would throw at construction. Minor, since both are registered in the same config.
- `switchWorkspace` (workspace-coordinator.service.ts:140) does the fan-out synchronously; its only await is git-service resolution, whose errors are caught internally (:222-229). It never reports failure and returns `void`, so there is no "failed switch" result to handle. `NotificationFocusCoordinator` (notification-focus-coordinator.service.ts:39) does the same and also ignores it. Consistent. A thrown sync error would reject `focus`; the dispatcher catches (chat-attention-action-dispatcher.service.ts:69,89), so the user sees "Target unavailable".
- Tab ids stay valid: tabs are partitioned per workspace but keep their ids; `found` is captured before the switch and `switchTab(found.tab.id)` runs afterwards on the now-active partition. A tab removed during the await would make `switchTab` a no-op after a `focused` result: Minor, unlikely.
- Navigation race: `AppStateManager.switchWorkspace` starts a restore navigation; the later `navigateToSurface` supersedes it and `recordSettledSurface` is generation-guarded (app-state.service.ts:620-640). OK.
- Switch is skipped when already active (`!== activeWorkspacePath`), so same-workspace behaviour is unchanged. `canFocus` now true cross-workspace, consistent with chat tabs.
- Specs: switch before navigate ordering asserted in setup-wizard spec. Neither spec covers a rejected `switchWorkspace` or navigation `cap`/failure after a switch (the workspace has then changed and the surface did not open). Minor: the user is left in the target workspace without the surface; accept, same as chat flow.

## Item 4 — M6 voice notice (voice-provider-error.service.ts)

Verified OK:
- Same-key upsert at higher generation updates in place; `soundEligible: false`, so no sound replay. `resolve(key, gen)` with an older generation is ignored (notification.service.ts:135-141, `generation < value.generation` continue). Race stt-in-flight + new stt error: the old success resolve is a no-op and tracking is kept (guard at service :95), as the new spec asserts.
- stt switch + tts error: `currentKey` moves to tts, the stt success resolves the stt key (gen unchanged) and leaves tts tracking intact.

Findings:
- Serious: a repeated error on the same key after the user dismissed it stays hidden. `dismiss()`/`dismissPresentation` records `dismissed[key] = presentationKey ?? ''` (notification.service.ts:164-168). Because the key is now stable and the item sets no `presentationKey`, `upsert` computes `presentationChanged === false` (:82) and never clears the dismissal (:89-91), and no new expiry clock starts (:95-99). Previously each error had a fresh key and re-presented. Fix: set `presentationKey` to the generation (or message) in `handleMessage`.
- Moderate: an stt notice and a tts notice can coexist, but only the latest has a working action. `canHandle` and `run` compare against the single global `currentKey` / `generation` (:55-63, :72); after a tts error, clicking "Switch to local" on the stt notice returns `{ kind: 'stale' }`. `latestError` also holds just the tts payload. Intended "two notices" now yields one dead action. Per-direction state (key, generation, payload) would fix it; at minimum record this as a known limit.
- Moderate: the stable key is built from `activeWorkspacePath` at event time (:46). Errors arriving after a workspace switch produce a second notice for the same direction while `currentKey` points only to the newer one. Same dead-action effect as above.
- Minor: after an older in-flight switch succeeds, the newer same-direction error notice remains although config is already local (spec :162-179 asserts that is intended). Acceptable but the notice is then misleading until the user acts.

## Item 5 — X2 (no change)

Claim verified. `isReplayMessage` requires `msg.type === 'user'` (claude-sdk.types.ts:380-381), so a guard in the `isResultMessage` branch (sdk-message-transformer.ts:325-336) could never be true. Replayed user turns are already dropped at :296. Other paths: `presentSessionFailure` has one caller (sdk-message-transformer.ts:334), and the transformer is fed only live SDK streams (stream-transformer.ts:1033, harness-stream-broadcaster.service.ts:94); stored-history replay on the frontend does not run through this transformer. The SDK declares no replay marker on result messages. No evidence of a path that re-emits an old `result`. Residual uncertainty: this rests on SDK types and callers, not on a runtime resume capture; if the CLI ever emits a stale `result` on resume the transformer would raise a failure item. Optional hardening: guard the attention call on the turn actually being active.

## Five logic questions (condensed)

1. Silent failure: R2 revival (moderate); M6 dismissed re-error hidden (serious).
2. Unexpected action: clicking Switch to local on an older-direction voice notice reports stale.
3. Wrong answer from data: same-session reopen ending in `null` cursor shows a stale alert.
4. Dependency failure: `switchWorkspace` cannot report failure; focus proceeds, consistent with chat flow.
5. Missing: tests for `undefined` to `null` reopen, rejected `switchWorkspace`, per-direction voice actions.

## Verdict

- APPROVE items 1 (with caveat), 2, 3, 5. REVISE item 4.
- Top risk: M6 stable key suppresses repeat notices after dismissal; add `presentationKey` per generation and keep per-direction action state.

## Re-review (M6 revision 1)

Read voice-provider-error.service.ts (full), the spec test list, notification.service.ts upsert/dismiss, and the dispatcher notice path.

Resolved:
- Serious (dismissed repeat hidden): `presentationKey: String(generation)` (service :56). `dismissPresentation` stores the current presentationKey; the next error carries a new one, so `presentationChanged` is true in `upsert` (notification.service.ts:82), the dismissal is deleted and a new clock starts. A same-generation re-upsert has an equal presentationKey and an identical item, so it takes the early return without replay; `soundEligible` is false anyway.
- Moderate (one dead action): `errors` Map keyed per workspace+direction; `canHandle`/`run` look up per key (:67-76), so stt and tts notices both act (spec "lets both direction notices switch their own provider").
- Moderate (workspace switch): entry stores its workspacePath, so an older workspace notice stays actionable; executing from another workspace returns unavailable with the stated reason rather than changing the wrong workspace (the RPC has no workspace parameter). Sound choice.
- M5 race holds: an older-generation success resolve is ignored by NotificationService (`generation < value.generation`), and the entry is deleted only if `errors.get(key).generation === generation` (:104-110), so the newer same-key error stays tracked. Cross-direction case unaffected (different keys).

Remaining (Minor, none blocking):
- Map entries are never removed by resolve-from-elsewhere, Clear all, expiry or eviction; they are only deleted on a successful switch. Size is bounded (workspaces x 2) and an entry only accepts an action carrying its exact (key, generation), which a visible notice would have, so the worst case is a late click on a hidden notice performing the switch the user previously offered. Optional: drop the entry when the notice is resolved or no longer live.
- `switchError` and `switching` are single global signals: a switch error shown for one notice is cleared/overwritten by another, and a click on the second notice while the first is in flight yields the generic reason "Could not switch to local provider" (service :72 via `switchError() ?? ...`) rather than "busy". Cosmetic.
- `latestError` / `dismiss()` still act only on the latest key, so dismissing from the inline surface leaves the other direction's notice up. Matches the "two notices" intent.
- Spec for dismissal revival uses the real NotificationService (good). Not covered: Clear all then action, and the switching-busy message.

Verdict: M6 APPROVED (score 8/10); the Serious and both Moderate findings are resolved.

## Orchestrator follow-up (local checks)

- The F1 R2 effect made the stale-alert specs need `TestBed.tick()`, which runs a full render
  that the chat-view harness cannot mock. The orchestrator replaced the effect with a pure
  check in the `olderHistoryAlert` computed: the snapshot keeps `tab.messages[0]`. A live event
  appends (same first message), so the alert stays; a reopen or reload replaces the loaded
  history (new first message), so the alert clears and cannot revive. This also removes the
  re-review caveat about an effect missing a transient `undefined` cursor.
- Local checks: mcp-apps-page, setup-wizard, harness-builder typecheck+lint+test pass; chat
  typecheck+lint pass; chat-view + voice-provider-error specs 106/106; audit 291.
