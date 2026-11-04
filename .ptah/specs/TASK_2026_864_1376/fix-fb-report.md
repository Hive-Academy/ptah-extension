# Fix FB report

## Findings

1. **Phase B F1** — `libs/frontend/core/src/lib/services/providers-connection-setup.service.ts:262-316` previously reread auth and route immediately after Codex launch, leaving external auth in flight. The Codex path now installs one attempt effect after launch (`:289-316`), settles the store on final success, failure, timeout or cancellation, releases the effect on final/cancel/destroy, and rereads connections and route only after the final state. Cancel writes idle. A reread failure publishes fixed retry copy. `providers-connection-setup.service.spec.ts:416-452` covers success, failure, cancellation, timeout, and a late final after cancel.
2. **Phase B F2** — `libs/frontend/core/src/lib/services/codex-sign-in.service.ts:113-115` previously dropped the post-success read result. It now exposes `refreshFailed`, prevents duplicate reads, and offers `checkAuthStatus()` for retry (`:124-142`). `libs/frontend/chat/src/lib/settings/providers/connection-drawer/codex-sign-in-block.component.ts:82-86,133-140` replaces endless checking on a false read with “Signed in, but Ptah could not confirm it.” and “Check again”. Service and block specs cover false then retry, copy, action, and chosen alert.
3. **Phase B F3** — `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts:290-294,1361-1367` previously cleared the banner on a successful read alone. It now holds reauth started through the read, checks `codexAuthenticated` and `codexTokenStale`, and retains the banner with fixed failure copy otherwise. `chat-view.component.html:158` renders the failure line and retry. `chat-view.component.spec.ts:793-841` covers authenticated, false read, and stale token.

## Decisions

- Used a single per-attempt Angular effect to observe the sticky final Codex state. The final state can arrive during the launch RPC; installing the effect after launch still sees that state. Reversible: the observer can be replaced by a service-level final-state promise if later architecture calls for it. Evidence: `CodexSignInService.state`, plan lines 681-682, review finding 1.
- A successful auth read alone does not prove Codex is ready; the chat banner requires authenticated and non-stale signals. Reversible. Evidence: `AuthStateService` signals and review finding 3.
- A failed confirmation read uses fixed UI copy and an explicit retry. Reversible. Evidence: design spec 5.5 state 7b and review finding 2.

## Risks and verification

- Scoped `ptah_get_diagnostics` was attempted twice for the eight changed TypeScript files. Both calls reported the TypeScript compiler still running after 45 seconds, so no diagnostic pass is claimed.
- Tests, typecheck, `npm run verify`, builds, browser rendering, and git were not run, as the task forbids those commands and limits visual review to Electron. CI remains the verification gate.
- The existing credentials-tab spec supplies a partial Codex service stub; the block tolerates its absent new signal. No real `codex login` was run.

## Bounded correction

- **N1** — `chat-view.component.ts:1377-1381` before: the failure line gated the effect, so the block's Check again could not clear the banner. After: `:1379-1384` observes the service confirmation state even when a failure line is present; `:292-308` clears that line and the banner when a retry confirms. `chat-view.component.spec.ts:860-875` covers false confirmation followed by successful Check again.
- **N2** — `chat-view.component.ts:292-296` before: chat issued a second `refreshAuthStatus()` call. After: `:292-308` reads only `CodexSignInService.confirmation` and the shared authenticated/stale signals. `codex-sign-in.service.ts:27-28,132-147` exposes the single read's `idle/checking/confirmed/failed` state. `chat-view.component.spec.ts:809-831,860-875` checks one auth read per attempt and one more on explicit retry; `codex-sign-in.service.spec.ts:89-101` checks failed then confirmed transitions.
- **N3** — `chat-view.component.ts:292-307` before: an in-flight completion could clear a later banner. After: `:283,293,374,388,1383` captures the original banner object and requires that exact banner to remain current before updating or clearing it. `chat-view.component.spec.ts:877-889` covers a later unrelated provider banner.

The correction changed only the permitted chat view, Codex sign-in service, their specs, and this report. Scoped `ptah_get_diagnostics` was attempted once for four changed TypeScript files but timed out while the compiler was still running. No prohibited test, build, or git command was run.
