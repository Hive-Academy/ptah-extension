# Code Logic Review (Phase C) - TASK_2026_864_1376

Scope: Batches 17-22 plus the chat-view merge resolution. Read in full at HEAD: provider-readiness.derive.ts, provider-readiness.store.ts, connection-choice.store.ts, ready-connection-step.page.ts, the Batch 20/22 diffs (guard, flag service, routes, home, settings page), the chat-view re-auth block (html 148-178, ts 284-316, 396-432, 1415-1423). Read only in part: connection-readiness-banner, ready-strip, connection-choice.component, provider-panel (not examined for template-level defects), the e2e fixtures and the specs. No tests were run (by instruction).

## Summary

| Metric | Value |
|---|---|
| Overall score | 6/10 |
| Assessment | REVISE |
| Blocking | 0 |
| Serious | 3 |
| Moderate | 4 |
| Minor | 2 |

Verdict: REVISE, 6/10. The two Serious store findings are small fixes.

## Serious

### S1. `refresh('mount')` is memoised for the life of the root store, so Home and the settings step never re-read
- File: libs/frontend/onboarding/src/lib/ready/provider-readiness.store.ts:84-93 (`mountPromise` is assigned at :89 and never reset; grep shows no other write)
- Callers: onboarding-home.component.ts (`refresh('mount')` on entry, replacing the old `refresh(false)`), ready-settings-step.page.ts:303, ready-connection-step.page.ts:88.
- Scenario: the store is `providedIn: 'root'`. The first mount, from any page, sets `mountPromise`. Every later `refresh('mount')` returns that settled promise and reads nothing. Example: the user opens Get ready, leaves for Providers or a terminal to install or sign in, then returns to Home. The old Home code carried the comment "Re-read Claude Code on every visit so the banner is never stale". The new comment (home.ts) says the same, but the code no longer does it. The banner and the strip keep showing the old state until the user finds Re-check, which exists only on stage 1.
- Impact: Home shows a stale "not signed in" or "ready". The Home switch-over is not behaviour-preserving, and the AC that the banner clears without a flag write on revisit is unmet outside stage 1.
- Fix: clear `mountPromise` in the `finally` of the mount cycle, or drop the memoisation and rely on the per-provider `cycles` de-dupe that `start()` already has for `kind === 'mount'`.

### S2. `retrySelection()` treats a failed refresh as success (AC 3.18, decision 22)
- File: provider-readiness.store.ts:69-82; consumer connection-choice.store.ts:67-70
- Decision 22 made `refreshAuthStatus()` return a boolean. `retrySelection` discards it and tests `this.auth.isLoaded()` instead. `isLoaded` is set true by an earlier successful load and is never cleared on a later failure (auth-state.service.ts:1386; `refreshAuthStatus` at :685 just returns the fetch result). The "selection not confirmed" state exists only after a load that already happened, so `isLoaded()` is always true at retry time.
- Scenario: the save succeeded but the re-read failed, so notice 11 and `notConfirmed` are set. The user clicks Retry and the backend is still down. `refreshAuthStatus()` resolves false without throwing, `isLoaded()` is true, `notConfirmed` is cleared, and notice 12 is not shown. The UI then shows the old persisted selection as confirmed, the very thing AC 3.18 forbids.
- Fix: `const ok = await this.auth.refreshAuthStatus(); if (!ok) return false;`. Add a spec where the refresh resolves false while `isLoaded` is true.

### S3. Codex re-auth block can be orphaned and goes stale when the banner object is replaced or cleared by another path (merge resolution)
- File: libs/frontend/chat/src/lib/components/templates/chat-view.component.html:163, chat-view.component.ts:298, 403-408, 1417-1422
- The template shows the sign-in block when `codexReauthStarted()` is true and the provider is codex. Completion requires `authRequiredBanner() === codexReauthBanner` (object identity). Two paths break this:
  1. A second refused send replaces the banner with a new object while a re-auth is in flight or has just succeeded. The block stays visible, driven by `codexSignIn.state()`, but the effect at ts:1417-1422 returns early. A succeeded sign-in never clears the new banner and shows no failure text. The user sees a "signed in" block under a banner that stays.
  2. Another path clears the banner without `onAuthBannerDismiss` (carry-over completing, a provider switch, clear from auth-state). `codexReauthStarted` stays true. The next Codex banner then renders the block at once with the previous attempt's status, for example "succeeded" or an old failure, before the user clicks anything.
- Fix: tie `codexReauthStarted` to the banner (derive it from `authRequiredBanner() === codexReauthBanner`, and reset when the banner becomes null), or reset in an effect on banner change. Carry-over and re-auth do coexist without conflict, because the offer is keyed by `generation` (ts:326); that part is fine.

## Moderate

- M1. The "Taking longer" state flickers back to "Checking" (AC 5.1). `slow` is returned only while the 5 s delay timer runs (store.ts:155-160 sets `retrying`, and `retrying.set(false)` at :160 runs before the follow-up read). The derive then returns `checking` while that read is in flight (derive.ts:57 for Claude, :84 for Codex), then `slow` again, then `error/timeout`. The sequence is slow, checking, slow, checking, error, not "Checking, Taking longer, terminal error". Keep `retrying` true until the last read settles. The final error and the 5 s x 2 follow-ups are otherwise correct.
- M2. Recheck has no slow phase. `run()` does not follow up when `kind === 'recheck'` (store.ts:150), so a timeout on Re-check goes straight to terminal `error/timeout` with no "Taking longer". This may be intended (decision 21 says follow-ups are per mount read), but AC 5.1 does not exempt Re-check. Record it as a decision if it is intended.
- M3. `catch(() => {})` on the cycle (store.ts:130-132) turns a rejected read into a cycle end. The state comes from the core services' own signals. If a core service rejects before it sets an error state, the provider stays `checking` forever and the mount spinner never ends. Add a fallback so that a rejected cycle sets a terminal local error.
- M4. `retrySelection` swallows the thrown error and `confirm()` swallows the `refreshAuthStatus` error in its `unconfirmed` branch (connection-choice.store.ts:49). Both are documented as degradation-audit choices and both surface notices, so this is acceptable. It does not change S2.

## Minor

- m1. `slowStarted` / `_slowStarted` (store.ts:31, 55, 154) has no consumer in libs/frontend. This is dead public API, and the new public API needs a style review. It also carries `mountId`, which the code increments for rechecks.
- m2. The `mountId` counter is shared by mount and recheck and is used only to label `slowStarted`.

## Five logic questions (short)

1. Silent failure: S2 (failed retry shown as confirmed), M3 (rejected read leaves `checking`).
2. Unexpected user action: leaving Get ready and returning to Home (S1); a second refused send during re-auth (S3).
3. Wrong answer from valid data: stale cached mount (S1); an old `isLoaded` standing in for a fresh read (S2).
4. Dependency fails: Claude and Codex timeouts reach a terminal error and are retried twice at 5 s on mount. A hung RPC yields `unknown/timeout` through `transportTimeout`, which is correct. The `refreshAuthStatus` false result is the gap (S2).
5. Missing and unmentioned: no re-read on Home revisit (S1); nothing resets the Codex re-auth state when the banner disappears (S3).

## Checked and OK

- VS Code host inert (AC 6.2): `refresh`, `recheckCodex` and `retrySelection` return early when `available` is false (store.ts:70, 85, 99). Home gates the strip and banner with `readyAvailable`. The route is behind `onboardingReadyHostGuard`. The connection-readiness banner is only used inside these gated places. I found no read on the VS Code path.
- Chosen-connection selection (derive.ts:122-155): `claudeCli` maps to Claude, `thirdParty` with `openai-codex` maps to Codex, everything else maps to `other` with a name, and `!isLoaded` maps to loading or unreadable. Not-confirmed is overlaid correctly. An unchosen provider gets role `information`.
- Home switch-over (Batch 22): the diff shows only the import, template-binding and `refresh` changes in home.ts, plus deletion of the Claude store, banner and specs. Grep finds no remaining reference to `ClaudeReadiness*` or `claude-readiness` outside the new files, and no stale `[claude]` binding remains. The `claudeAt` flag stays readable (guard.ts:34) and the new `connectionAt` is written by Continue. The exceptions are S1 and the e2e fixtures, which still write `claudeAt` (onboarding-ready.fixtures.ts:179, 194). That is intentional back-compat coverage.
- Cancellation: `epochs` plus the timer `cancel()` stop a superseded cycle, and `onDestroy` clears timers. Because the store is root-scoped, the DestroyRef fires only at app teardown, which matches its lifetime.
- The Codex re-auth block respects the AuthRequiredBanner identity check on the completion path (the failure path is S3).

## Verdict

REVISE. Confidence MEDIUM, because component templates (provider-panel, connection-choice) were not read line by line. Top risk: S1/S2, where readiness and selection look current but are not. A robust version would also add a spec for each of S1-S3 and a decision-log row covering M2.
