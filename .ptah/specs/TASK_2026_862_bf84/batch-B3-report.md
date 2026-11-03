# Batch B3 report — plan batches 4, 14 and A3 open issues 1, 4, 6

Status: PARTIAL — assigned file edits are complete; the first `turn/start` fallback requires coordinated changes in an unowned file.

## Files changed/created

1. `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.ts` — kept the previous lane's direct `CODEX_RUNTIME_TOKENS.Runtime` resolution and its removed `platform` port. A host-supplied `resolveRuntime` still wins.
2. `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.spec.ts` — removed parity/dev-route imports, registrations, setup arguments and the `platform` fixture. Replaced the old gate test with direct-token and host-override tests.
3. `libs/backend/agent-sdk/src/lib/di/register.codex-runtime.spec.ts` — removed the `platform` fixture.
4. `libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-chat-host-ports.ts` — removed `platform` from the adapter-port `Pick` and the returned ports. Updated the obsolete gate comment.
5. `libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-chat-host-ports.spec.ts` — removed the `platform` fixture.
6. `libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-chat-host-ports.resume-permission.spec.ts` — removed the `platform` fixture.
7. `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.native.spec.ts` — removed the `platform` fixture.
8. `libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-chat-native-contract.spec.ts` — removed parity/dev-route imports and registrations and the `platform` fixture.
9. `libs/backend/rpc-handlers/src/lib/chat/session/chat-continue-codex-resume-once.spec.ts` — removed parity/dev-route imports and registrations and the `platform` fixture.
10. Created `.github/dependabot.yml` — one weekly npm entry covers exactly `/`, `/apps/ptah-electron`, `/libs/backend/agent-sdk`, and `/libs/backend/auth-providers`. Allow and group patterns are limited to `@openai/codex`, `@openai/codex-sdk`, and `@openai/codex-*`; the pull-request limit is 5.
11. `libs/frontend/chat-ui/src/lib/molecules/session/session-stats-summary.component.html` — added `[costUnavailableReason]="costUnavailableReason()"` to both `ptah-cost-badge` usages.
12. `libs/shared/src/lib/providers/entries/codex-provider-entry.spec.ts` — rewrote the spec for dynamic discovery. It asserts the absence of `staticModels`, retains tier/registry/pricing checks, and contains no static model IDs.
13. `libs/backend/auth-providers/src/lib/auth/workspace-provider-profile-resolver.ts` — removed the Codex `staticModels` lookup and substitution fallback. Tier aliases still map through `CODEX_DEFAULT_TIERS`; `default` and empty input retain the opus-tier default; every other trimmed model ID passes to Codex unchanged.
14. `libs/backend/auth-providers/src/lib/auth/workspace-provider-profile-resolver.spec.ts` — added future/unknown/case-preserving ID pass-through cases and retained default/tier behavior checks.

Checked but unchanged: `scripts/windows-hide-patch/patch-windows-hide-deps.spec.ts`. Its fixture reads `patch.version` dynamically and has no exact Codex pin assumption.

## Behavior

- Chat adapter runtime resolution no longer uses the parity gate or dev route. The host runtime port retains precedence over direct token resolution.
- Obsolete platform data no longer crosses the chat adapter/host-port boundary.
- Native Codex model selection no longer substitutes an unknown ID from a static list. Codex validates the requested ID at execution.
- Both session-stat cost badges receive the narrow unavailable reason and can show `Not priced` only for `rate-missing`.
- Dependabot can group Codex SDK/CLI updates across the four manifests that declare those dependencies.

## Tests

Updated specs cover direct runtime-token resolution, host resolver precedence, dynamic provider entry shape, future and unknown model ID pass-through, and retained default-tier behavior. Parity/dev-route fixtures and platform literals were removed from all six assigned chat specs.

No tests, Nx commands, builds, or `tsc` commands were run, as required by the lane brief.

`ptah_get_diagnostics` completed with clean coverage for the 12 requested TypeScript files and reported **no diagnostics in those files**. It reported 29 errors in sibling files outside this lane's ownership. Representative sibling errors are in `libs/backend/agent-sdk/src/lib/codex-app-server/codex-history-projector.ts:74-79,119,194-196` after the concurrent protocol schema changes.

AST parses succeeded for the edited adapter spec, workspace resolver spec, and resume-once spec. Static searches found no remaining parity/dev-route registrations or removed platform fixtures in the assigned chat files. The provider entry spec contains no static model IDs.

The requested one-retry/no-replay turn fallback tests were **not added**; see Open issue 1.

## Decisions

- **Accept any non-tier Codex model ID:** alternatives were validation against a dynamic catalog or retaining a static fallback. The plan makes Codex the authority for requested IDs, and a catalog can be unavailable. The default tier mappings remain only for explicit `opus`/`sonnet`/`haiku` aliases and the existing `default`/empty behavior. Reversible: yes, in one resolver method.
- **Keep `default` and empty input on the opus tier:** accepting the literal `default` as a model ID would send an invalid request to Codex. This preserves existing behavior without a static catalog. Reversible: yes.
- **Do not edit the Windows patch fixture:** its version-mismatch case uses `0.999.0` deliberately and derives the expected version from the patch definition. It does not assume the removed runtime pin. Reversible: not applicable.
- **Do not implement first-turn fallback in the adapter after the stream catches the error:** the stream emits failure UI, wraps the error, and closes the session before an outer adapter catch could recover. Retrying there would duplicate failure behavior and would not provide a clean pre-receipt boundary. Reversible: yes, through the coordinated change below.

## Open issues

1. **Required first-`turn/start` bundled retry is not implemented.** `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-turn-stream.ts:180-187` owns `context.startTurn`, receipt assignment and admission. Its catch at `:505-550` wraps failures, publishes failure state and closes the session. The adapter only supplies turn dependencies at `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.ts:583-622`. Implement the pre-receipt retry in the turn stream through a coordinated adapter/runtime reopen callback: resolve `CODEX_RUNTIME_TOKENS.SelectionSnapshot`, call `activateFallback(selected, error.method)` once for an installed selection, close the failed context/scope, reopen the same profile with the bundled selection, and rebuild the session context/sink before returning a receipt. Never retry after `receipt.turnId` is assigned. Add the before-receipt one-retry and after-receipt no-replay tests in `codex-chat-turn-lifecycle.spec.ts`. These files were outside B3 ownership, so this requirement remains unmet.
2. **Sibling TypeScript errors remain outside scope.** The scoped diagnostic run reported 29 sibling errors, including `libs/backend/agent-sdk/src/lib/codex-app-server/codex-history-projector.ts:74-79,119,194-196`. The protocol/projector owner must reconcile the new tolerant item union with projector narrowing. No requested B3 file had a diagnostic.
3. **Verification remains with the coordinator.** Run the scoped agent-sdk, rpc-handlers, auth-providers, shared and chat-ui checks after all batches integrate. B3 did not run tests or builds under its explicit prohibition.
