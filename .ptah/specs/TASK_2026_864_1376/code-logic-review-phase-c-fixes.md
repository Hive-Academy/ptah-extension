# Code Logic Review — TASK_2026_864_1376, fix round FC (re-review)

Scope: uncommitted diff, 7 files. Read-only; nothing was run (CI verifies by user decision).

Verdict: APPROVED, 8/10. 0 blocking, 0 serious, 2 moderate, 2 minor.

## Findings verified

| Finding | Status | Evidence |
| --- | --- | --- |
| S1 | Fixed | `provider-readiness.store.ts:94-102`: `mountPromise` is cleared in `finally`. Concurrent mounts still join it, and `start()` also returns the active cycle for `kind === 'mount'` (:124). A later mount reads again. Spec `store.spec` "joins concurrent mounts and reads again" asserts 2 reads after the second mount. VS Code stays inert because the `!available` early returns in `refresh`, `recheckCodex` and `retrySelection` are unchanged. |
| S2 | Fixed | `store.ts:80-81` uses the boolean from `refreshAuthStatus()`. The spec sets the refresh to false with `isLoaded` true and expects `false` with `not-confirmed` kept. The consumer spec covers notice 12. |
| S3 | Fixed | `chat-view.component.ts:1419-1426` resets started, failure and banner when the banner differs from the one that started the re-auth. Two specs cover it: a replaced banner, and a banner cleared elsewhere followed by a new Codex banner. `onAuthReauth` (:403-410) sets `codexReauthBanner` before `codexReauthStarted`, so the effect sees a consistent pair and does not reset a re-auth the user just started. |
| M1 | Fixed | `retrying` is no longer cleared before the follow-up read (store.ts:171-173). The derive returns `slow` for `checking` inputs when `retrying` is true (derive.ts:56, :89). The last pass hits `attempt === MAX_FOLLOW_UPS`, returns, and `finally` clears `retrying`, so the terminal `error/timeout` appears after the final follow-up (about 10 s). That matches decision 21 and the e2e expectation of `slow`, then `runFor(11_000)`, then the error. The spec holds the follow-up pending in `checking` and asserts `slow`. |
| M3 | Fixed | A rejected cycle sets `readFailed`, which gives a terminal `error/local`. The flag is reset at the next `start()` and guarded by the epoch and `destroyed` checks. The spec covers it for Codex. |

## Regression checks

- Timeout detection (store.ts:160-168) reads the raw views and matches every timeout shape in the derive. Claude: `transportTimeout` or `result.unknown/timeout` (derive:66). Codex: `transportTimeout`, `binary.unknown/timeout` (derive:93) and `signIn.outcome === 'timeout'` (derive:96).
- The synthetic M3 view has all 7 `ProviderReadinessView` fields, with literal types that satisfy the interface. `failedFact: 'sign-in'` with cause `local` renders "Ptah could not read your {name} sign-in." (provider-panel.component.ts:295). That is acceptable copy, though not exact for a binary-read rejection.
- `codexReauthVisible` is a `computed`, but `codexReauthBanner` is a plain field. It stays reactive because the field is only written together with `codexReauthStarted` or null-reset paths. See m2.

## Moderate

- M-a. The store's raw timeout check ignores the derive's precedence (store.ts:160). If the derive resolves `missing` (Claude `cli-missing`, or Codex binary missing) or `error/local` (Claude detection error), but the raw view also shows a timeout, the cycle waits 10 s and re-reads for nothing. The derive never shows `slow` in those cases, so only the delay and an extra read are wasted. Gate the check on the derived state, or on the same precedence.
- M-b. The new specs cover the Claude `checking` follow-up only. The Codex `checking` to `slow` path (derive.ts:89) and the Codex timeout shapes (binary timeout, `signIn` timeout) have no spec of their own.

## Minor

- m-a. `chat-view.component.ts:297-298`: if `onAuthReauth` ran again with `codexReauthStarted` already true and a new banner before the S3 effect flushed, the field would change without a signal change. The computed would then be stale-false and the block hidden during a live re-auth. It needs a click between the banner change and change detection, which is practically unreachable. Making the banner a signal would remove the risk.
- m-b. A rejected Claude read shows `failedFact: 'sign-in'` even when the detection or binary read was the one that failed (store.ts:42-44). The copy is generic but not wrong.

M2, M4, m1 and m2 from the original review were left as-is per decisions.md row 98 and are not re-evaluated.
