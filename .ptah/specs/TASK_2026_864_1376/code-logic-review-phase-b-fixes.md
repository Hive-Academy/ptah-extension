# Code Logic Review (Phase B fixes, lane FB) — TASK_2026_864_1376

Scope: uncommitted diffs in providers-connection-setup.service.ts, codex-sign-in.service.ts, codex-sign-in-block.component.ts, chat-view.component.ts/.html. Static read only. No nx, verify or jest run. Specs were not re-read in depth.

## Verdict: REVISE

0 blocking, 1 serious, 3 moderate. F1 and F2 are closed. F3 is closed for the main path, but the new retry and failure state has a gap (N1).

## Per-finding

### F1 (Serious): CLOSED

- `providers-connection-setup.service.ts:239-249` (cancel). It bumps `externalAuthGeneration` (line ~230), awaits the cancel, destroys the attempt effect and writes `idle`. A pending `start()` continuation then fails the generation check at ~291 and never installs an effect.
- `:285-313` (sign-in). The store is not re-read at launch. The code awaits `start()`, then installs one effect. The effect maps `succeeded` to `signed-in`, `failed` to `failed` (timeout is `failed` with `errorCode: 'timeout'`) and `cancelled` to `idle`. It destroys itself and rereads connections and route only after the final state.
- One effect per attempt. A new attempt destroys the old one before its await (`:287-288`). `DestroyRef` destroys it on service teardown (`:152`). No leak.
- Stale final from an earlier attempt: `launch()` clears a final state before the RPC (`codex-sign-in.service.ts:58-63`). The effect is created after `start()` resolves, so it cannot read the previous attempt's sticky final.
- An immediate RPC failure goes through `localFailure`, which sets `failed` before the effect exists. The effect still sees it.
- Overlap: attempt A's continuation exits on the generation check and its effect was destroyed by B, so A cannot write over B.
- The reread-failure message is guarded by a generation check (`:308`).

### F2 (Serious): CLOSED

- `codex-sign-in.service.ts:124-142`. `checkAuthStatus` sets `refreshFailed` when the read returns false or throws. It has a re-entry guard and a generation guard.
- `codex-sign-in-block.component.ts:82-86,133`. The `confirmation-failed` phase shows fixed copy and a "Check again" button. The phase leaves `checking`. The spinner is bounded by the RPC timeout.
- `AuthStateService.readAuthStatus` returns the newer read's result for a superseded read, so overlapping refreshes do not produce a spurious false.

### F3 (Moderate): CLOSED on the main path

- `chat-view.component.ts:292-307`. The banner clears only when the read succeeds, `codexAuthenticated()` is true and `codexTokenStale()` is false. Otherwise it shows a failure line. `codexReauthStarted` stays true until the success branch. The effect is gated while `checking` or `failure` is set, so the effect does not loop.
- "Try again" clears the failure and calls `start()`. `launch()` resets the final state synchronously, before the effect flush, so the stale `succeeded` does not re-trigger a check.
- The remaining gap is N1.

## New findings

### N1 (Serious): the block's "Check again" cannot clear a banner that already holds a failure line

- Location: `chat-view.component.ts:1377-1381` (effect gate) with `codex-sign-in-block.component.ts:159` (`checkAuthStatus`).
- Scenario: the read after sign-in returns false. Both the chat banner and the block each show the failure copy. The user clicks "Check again" in the block, which calls `service.checkAuthStatus()`, and the read succeeds. Nothing in chat-view reacts. `codexReauthFailure` is still set, so the effect stays gated off. The banner and its red line stay.
- Impact: the user is stuck. The only exit is "Try again", which restarts the whole OAuth login, or dismissing the banner.
- Fix: have the banner's failure branch re-run `completeCodexReauth()` as its own "Check again". Alternatively, have the effect also watch `service.refreshFailed()`/`refreshing()` and clear the failure and re-evaluate when the service read recovers.

### N2 (Moderate): double refresh and two sources of truth

- Location: `codex-sign-in.service.ts:122-124` (the service refreshes on `succeeded`) and `chat-view.component.ts:292-296` (the chat effect also calls `refreshAuthStatus`).
- Effect: two auth reads fire per re-auth.
- Concern: the block's `refreshFailed` and chat's `codexReauthFailure` are decided by separate reads and can disagree. Chat could say "check failed" while the block says "Checking...", or the reverse. Superseded reads share a result, so this is redundant work rather than corruption. Chat should reuse the service result, which would also fix N1.

### N3 (Moderate): `completeCodexReauth` can clear an unrelated banner and raises the failure after a dismiss

- Location: `chat-view.component.ts:292-307`, with `onAuthBannerDismiss` at ~383.
- Scenario: the user dismisses the banner during the in-flight read. On success, `clearAuthRequiredBanner()` runs anyway. It does not re-check that the current banner is still the Codex one. A different provider's banner that appeared meanwhile would be wiped.
- Also, on failure it sets `codexReauthFailure` while the banner is gone. That is harmless, because `onAuthReauth` resets it.
- Fix: capture the banner before the await and compare it afterward.

### N4 (Minor): store shows `signed-in` even if confirmation failed

- Location: `providers-connection-setup.service.ts:300`.
- It is spec-mandated (succeeded maps to signed-in). Settings can say "signed in" while the block says "could not confirm". Consider mapping on `refreshFailed`.

### N5 (Minor): cancel writes `idle` unconditionally after the RPC

- Location: `providers-connection-setup.service.ts:241-248`.
- If the attempt succeeded just before the cancel landed, the store reads `idle` and the effect is already destroyed. The service state stays `succeeded`. Rare.

## Scores for the new-defect checks

| Check | Result |
| --- | --- |
| Leaks | none found (effect destroyed on final, cancel, new attempt and service destroy) |
| Overlapping attempts | safe (generation check plus destroy-before-await) |
| Stale final from an earlier attempt | closed |
| Double refresh | present (N2) |
