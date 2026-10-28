# P4 code-logic review

Verdict: **REVISE**  
Score: **7/10**  
Review family: reviewer **codex**, implementer **Claude**

Reviewed `8124050d2..cf398919d` under `libs` and `apps`, with targeted reads of callers, registrations, action implementation, plan/batch acceptance criteria and reports, and D27–D30. Electron is the priority host. Source and git state were not changed.

## Findings

1. **Moderate — A refused sign-out destroys the active sign-in handle.**

   File: `libs/backend/rpc-handlers/src/lib/handlers/provider-account-rpc.handlers.ts:505` (also `:514–519`).

   Scenario: sign-in A is pending. Another window with a stale account snapshot submits sign-out for that profile. Before asking the actions port, the handler overwrites A in `operations` with the sign-out operation. The real actions service refuses the request with `conflict` or `busy`, but the `finally` block then deletes the replacement. A is still running, yet the handler has forgotten its operation ID. A subsequent successful `getAccountStatus` returns a pending account without an operation. The frontend's `refreshAccountStatus` removes its Cancel handle and fallback script when that field is absent, leaving the pending manual login without its script or a usable Cancel action after refresh/reload.

   Suggested fix: do not replace a live sign-in handle for an unaccepted sign-out. Sign-out already settles before returning, so its local response operation need not be installed in the shared map. Otherwise preserve the prior handle with concurrency-safe ownership checks. Add a test that starts sign-in, refuses a competing sign-out, and confirms status still returns the original sign-in handle.

2. **Moderate — Rejected stale snapshots can still restore obsolete fallback scripts and operations.**

   File: `libs/frontend/core/src/lib/services/provider-accounts-state.service.ts:569` (operation/fallback updates at `:571–590`).

   Scenario: a sign-in response contains a pending snapshot and fallback script. Before the response is processed, a newer push reports cancellation/completion/removal, or a workspace switch resets the slot. `apply(data.snapshot)` correctly rejects the old revision or wrong workspace, but `write()` ignores that result and checks pending state in the rejected response. It then writes the old operation and script back into the current slot. After a subsequent attempt becomes pending, the drawer can display the previous script and its Cancel action can carry the previous operation ID. Even without another attempt, scripts survive the terminal/removal/reset boundary that was meant to clear them.

   Suggested fix: accept response-only operation/fallback fields only when the request still belongs to the active workspace generation and the currently accepted account revision/state matches the response's pending operation. Preserve the valid case where the same snapshot arrived first by push; simply requiring `apply()` to return true would drop legitimate scripts. Add deferred-response tests for a newer terminal push, a newer sign-in attempt, and a workspace reset before the older reply.

3. **Minor — The new state subscription has no production teardown caller.**

   File: `libs/backend/rpc-handlers/src/lib/handlers/provider-account-rpc.handlers.ts:237` and `:307`.

   `register()` correctly avoids subscribing twice on the same instance, and the unit test proves that explicitly calling `dispose()` unsubscribes. However, production RPC composition only resolves and registers handlers (`libs/backend/rpc-handlers/src/lib/host-profile/register-rpc-surface.ts:180`); the Electron activation/shutdown paths inspected neither capture this disposer nor dispose the container. The B17 report explicitly records that no caller uses the new method. During shutdown with a pending account action, state callbacks therefore remain live while host resources are being torn down. This is a lifecycle gap, not evidence of an accumulating listener per normal window open: the handler is a singleton.

   Suggested fix: capture the subscription owner's disposer in Electron's shutdown lifecycle and release it before persistence/broadcast resources are torn down. Add a lifecycle test through that owner, rather than only calling the handler's method directly.

4. **Minor — Successful actions publish duplicate snapshots for one state transition.**

   File: `libs/backend/rpc-handlers/src/lib/handlers/provider-account-rpc.handlers.ts:452` and `:547` (also `:490`, `:521`, `:584`).

   Scenario: real `ProviderAccountActionsService.startSignIn` emits the pending transition before returning (`provider-account-actions.service.ts:296`). The handler subscription publishes a snapshot for each open workspace. When the action returns, `actionCommitted()` increments the revision again and broadcasts the same state for the initiating workspace. Cancel and successful sign-out likewise emit while settling and then trigger another committed push. The frontend accepts both because their revisions differ. This violates the requested no-duplicate-notification behavior and causes redundant state updates, though it does not switch accounts or expose the fallback. The handler fake returns results without emitting action state transitions, so the isolated tests do not catch this integration behavior.

   Suggested fix: coordinate request acknowledgement with the state-change broadcast so each transition has one snapshot notification per workspace, while still settling the initiating request. Test with an actions fake that emits during the action before resolving it.

## Decisions

- The Electron helper correctly gates on registered `SQLITE_CONNECTION`, registers one singleton adapter, and overrides the two SDK null defaults plus the lane token using last-registration semantics. The SDK eager resolutions inspected are state/configuration infrastructure, not the query runner/importer; the adapter alias and lane persistence lookup are lazy. No early null-capturing consumer was found in the inspected phase-2 registration paths. The new overrides occur only in Electron; other hosts retain their existing null/absent persistence behavior.
- Accept the extracted binding helper and additive type/barrel exports. The smoke test exercises real registrations and pins the production call position, but is not a complete Electron boot test.
- Fixed `account_refused` responses, Claude-only named RPC resume forwarding, and the additive optional shared result code match B16/D29. Session list projection adds only `accountProfileId` from the binding.
- Fresh named spawn selection remains boundary-validated and Claude-only. Accept B18's documented retention of the MCP/namespace named-resume refusal: that boundary is explicitly scoped to fresh spawns, separate from B16 resume RPC forwarding.
- Lane/session badges resolve labels reactively, avoid displaying lookup IDs, hide named badges until a snapshot exists, and use `Removed account` for missing profiles. The drawer uses text interpolation and Clipboard for the script; the accounts section now supplies its fallback input. No new raw error, credential, or script logging/persistence was found in the reviewed changes. The in-memory replay ledger retains the caller's result, but does not broadcast or durably persist its script.
- Angular changes use signals/OnPush and the shared state/RPC route. Applied the local `angular-frontend-patterns` skill for the UI review. No added `process.cwd()` or module-namespace `jest.spyOn` was found in the spec diff; added console spies are not namespace spies.
- Known lint/integration failures listed in the brief are excluded. Historical report blockers addressed by later commits are not repeated as findings.

## Not checked

- No Electron launch, visual review, actual Claude login/logout, OS console/clipboard exercise, builds, installs, lint, typecheck, full suites, or e2e runs.
- No full production-container boot execution or VS Code/CLI/TUI runtime smoke execution. DI timing conclusions are source-based, supplemented by inspection of the changed smoke test.
- Findings are code-path deductions; no source or regression tests were added. The two permitted single specs were run with `--maxWorkers=2`: `provider-account-rpc.handlers.spec.ts` **59/59 passed**, and `provider-accounts-state.service.spec.ts` **17/17 passed**. Both emitted a Jest config ES-module loading warning but completed successfully. These passes do not cover the interleavings above.
- Existing P1–P3 certification, credential storage, and admission internals were consulted only where needed to establish P4 behavior; they were not re-reviewed in full.
