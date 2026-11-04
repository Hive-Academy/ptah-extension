# Batch 21 report

## Files changed

- `apps/ptah-extension-webview/src/app/app.config.ts`
- `libs/frontend/webview-e2e-harness/src/lib/scenarios/onboarding/onboarding-ready.fixtures.ts`
- `libs/frontend/webview-e2e-harness/src/lib/scenarios/onboarding/onboarding-ready-visual.e2e.spec.ts`
- `apps/ptah-electron-e2e/src/specs/onboarding/onboarding.spec.ts`

`review-shell-message-handlers.spec.ts` was inspected but left unchanged: its `it.each` covers only the two review-shell push relays, not all application handlers.

## Handler registration

`app.config.ts:34,481` imports `CodexSignInService` and registers it with `MESSAGE_HANDLERS` using `useExisting` and `multi: true` beside the other sign-in handler.

## Fixtures and scenarios

- The readiness fixture answers `auth:getCodexReadiness` with installed/ready, installed/signed-out, bundled/signed-out, and timeout snapshots. The timeout snapshot drives the store's slow follow-up state. The fixture also sets persisted Claude or Codex selection through `auth:getAuthStatus` and provides synthetic login/cancel RPC replies.
- Six synthetic `auth:codexLoginStatus` pushes cover waiting with URL and code, waiting with URL only, failed, timeout, cancelled, and succeeded. No real `codex login` is invoked.
- The visual spec adds Codex chosen/ready, bundled, signed-out, slow, and all six sign-in captures in each capture theme. Assertions check the selected radio, panel state, bundled path, sign-in text, URL/code controls, and chosen-connection failure alert role.
- Stage 2 uses the new connection-readiness banner IDs. Home selectors target the final Batch 22 `ptah-connection-readiness-banner` markup while retaining the specified legacy Home `data-testid` values.

## Test ID replacements

- `libs/frontend/webview-e2e-harness/src/lib/scenarios/onboarding/onboarding-ready.fixtures.ts:298`: stage 1 boot guard uses `ready-connection-step`.
- `libs/frontend/webview-e2e-harness/src/lib/scenarios/onboarding/onboarding-ready-visual.e2e.spec.ts:58`: stage 1 selector uses `ready-connection-step`.
- `apps/ptah-electron-e2e/src/specs/onboarding/onboarding.spec.ts:25,35`: visible and count-zero assertions use `ready-connection-step`.

## Decisions

- Codex selection is encoded as `authMethod: 'thirdParty'` plus `anthropicProviderId: 'openai-codex'`, matching `deriveSelection`; reversible fixture data choice.
- A synthetic readiness timeout produces the slow follow-up because `ProviderReadinessStore` marks timeout retries as `slow`; reversible fixture data choice.
- The review-shell handler spec remains scoped to its two named relays; adding a new handler there would change the purpose of that test. Reversible.

## Risks and limits

- E2e, Playwright, Electron, Jest, Nx, `npm run verify`, TypeScript CLI, and git commands were not run, as instructed. The new visual captures have not been executed.
- `ptah_get_diagnostics` was requested after edits, but the TypeScript compiler stayed busy for 45 seconds and returned the three changed TypeScript files as unchecked. CI must verify typecheck and lint.
- The Home selector depends on Batch 22 retaining the existing Home banner test IDs under `ptah-connection-readiness-banner`. Batch 22 is pending.
- The separate Electron e2e spec still uses `ready-continue-anyway`; the requested scope extension allowed only its two stage-host test ID replacements.
