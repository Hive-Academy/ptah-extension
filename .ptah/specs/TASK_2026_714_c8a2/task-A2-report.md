# Removal A, batch A2 report

## Summary

Retired the Claude SDK fallback selection for Codex main chat. Unsupported Codex chat now fails with a user-readable error at every legacy profile entry, OAuth configuration, and adapter routing. Native Codex start and resume still select the App Server; other providers retain their Claude SDK paths. Only the six requested code/spec files changed.

## Files changed

- `libs/backend/auth-providers/src/lib/auth/workspace-provider-profile-resolver.ts`: `resolveExecutionProfile` rejects a Codex serving provider or stored legacy Codex identity, and `buildProfile` rejects Codex before every direct legacy profile request or shared-env fallback. The `AuthRequiredError` carries `providerId` and a Ptah desktop recovery hint. Native selection and resume logic is unchanged.
- `libs/backend/auth-providers/src/lib/auth/workspace-provider-profile-resolver.spec.ts`: covers missing capability, incompatible consumer, legacy Codex identity, and both direct legacy profile entry points; retains native and non-Codex coverage.
- `libs/backend/auth-providers/src/lib/auth/strategies/oauth-proxy.strategy.ts`: non-native Codex configuration stops a running Copilot proxy, then returns `{ configured: false, details: [], errorMessage }` without checking tokens, starting or reusing the Codex proxy, or writing Anthropic proxy environment variables. Native return remains as before. The Codex proxy injection remains used for stopping an already running proxy on provider switch/teardown. `stopWatchingAuthFile` and `clearCache` remain on those cleanup paths; native return never started this watcher, so removal of the legacy configure-time `startWatchingAuthFile` does not change that branch.
- `libs/backend/auth-providers/src/lib/auth/strategies/oauth-proxy.strategy.spec.ts`: covers native return, explicit non-native failure, Copilot proxy stop, and existing Copilot, Kimi, and cleanup behavior.
- `libs/backend/agent-sdk/src/lib/codex-app-server/routing-agent-adapter.ts`: rejects Codex starts when native capability, adapter, or admission is absent; keeps admission lookup errors propagating. Resume and chat-changing calls reject stored legacy Codex identities; cleanup/status calls still route to their legacy owner. A missing admission port yields a generic admission error for Claude.
- `libs/backend/agent-sdk/src/lib/codex-app-server/routing-agent-adapter.spec.ts`: covers capability, gateway, missing-adapter/admission, legacy Codex activity rejection and cleanup, native sessions, and non-Codex routes.
- `.ptah/specs/TASK_2026_714_c8a2/task-A2-report.md`: this deliverable.

## Callers outside scope

Pre-edit `git grep -n` found these production callers or affected contract users. None was edited:

- `libs/backend/gateway-chat-bridge/src/lib/gateway-turn-preparation.ts:159` and `libs/backend/rpc-handlers/src/lib/chat/session/chat-runtime-profile.service.ts:130` call `resolveExecutionProfile`.
- `libs/backend/rpc-handlers/src/lib/chat/session/chat-runtime-profile.service.ts:64` calls `resolveProviderProfileForWorkspace` through `resolveClaudeExecution`; callers of that helper are `chat-session.service.ts:1464,2410` and `chat-slash-command-router.service.ts:335` in the same session directory.
- `libs/backend/auth-providers/src/lib/auth/auth-manager.ts:167,254` calls `resolveCodexProxyPolicy`; `libs/backend/auth-providers/src/index.ts:53` exports it. `libs/backend/auth-providers/src/lib/auth/codex-proxy-policy.ts:11` contains the `legacy-session-start` rule; its reason is declared in `libs/backend/auth-providers/src/lib/auth/auth-strategy.types.ts:26` and `libs/backend/agent-sdk/src/lib/auth-env.port.ts:10`. The production search found no literal `legacy-session-start` producer.
- `libs/backend/agent-sdk/src/lib/di/register.ts:1074` constructs `RoutingAgentAdapter`.
- `libs/backend/auth-providers/src/lib/auth/strategies/local-native.strategy.ts:52`, `local-proxy.strategy.ts:40`, `libs/backend/auth-providers/src/lib/providers/register-providers.ts:115`, and `libs/backend/auth-providers-tokens/src/lib/tokens.ts:41` still use/register `SDK_CODEX_PROXY`; they belong to later cleanup batches.

## Decisions

| Decision | Options considered | Evidence | Reversible |
| --- | --- | --- | --- |
| Reject Codex before every legacy profile materialization. | Return the old Claude SDK Codex profile; throw `AuthRequiredError`. | D31(1) requires explicit failure on hosts without native Codex. `buildProfile` guards both direct entry points before proxy acquisition and before its catch; the fallback to shared auth is never reached. | Yes; remove the guard if a supported legacy runtime is deliberately restored. |
| Keep the strategy's Codex proxy injection for cleanup, while removing configure-time use. | Remove injection and stop paths now; retain stop paths until A3/A4 remove the registered proxy. | `configure` and `teardown` still stop an already running Codex proxy; native return does not start the auth-file watcher. | Yes; A3/A4 can remove cleanup and DI together. |
| Reject stored legacy Codex identities on resume and chat changes while preserving cleanup/status. | Reject every call; route every call to legacy; distinguish activity from cleanup. | A historic Codex session must be closable and inspectable without allowing a new turn through the old runtime. Native owned sessions and native identities still route native. | Yes; the identity guard can be changed with a future migration policy. |
| Leave `register.ts` untouched. | Add a wrapper there; use the resolver guard. | `register.ts:1061-1080` omits the router without native/admission and `:1135-1142` aliases the raw SDK adapter. The affected chat path calls `resolveClaudeExecution` → `resolveProviderProfileForWorkspace` → guarded `buildProfile` before calling that adapter. The direct `buildProfileForPath` route is also guarded. | Yes; later composition work can add another boundary. |

## Open risks

- Tests, typecheck, lint, build, Nx, Jest, and diagnostics were prohibited by this task and were not run. Six edited TypeScript files parsed successfully with `ptah_ast_analyze`; `git diff --check` passed. This is static evidence, not runtime proof.
- `resolveClaudeExecution` and its callers remain outside A2. They still request a legacy profile, but the resolver now throws for Codex before they can start the SDK adapter. The helper itself has no host-capability argument.
- Codex proxy pool/registration and Claude SDK proxy accommodations remain for A3-A5. No MCP configuration or other provider path was removed.
- This CLI exposed no invocable local matching skill. Skill discovery reported zero local skills; repository guidance was used directly.
- `.ptah/specs/TASK_2026_714_c8a2/code-logic-review-A2.md` was present before this revision and was not edited.

## Degradation audit

`npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts` exited 0: 4,343 files scanned, 280 unsuppressed sites in the repository, `libs/backend/auth-providers` 20 against baseline 24, and `libs/backend/agent-sdk` 4 against baseline 4. No baseline was changed. All six edited code files have LF line endings and no BOM.

## Revision 1

| Review defect | Fix | Source line | Spec line |
| --- | --- | --- | --- |
| 1. `resolveClaudeExecution` could build a Codex SDK profile. | Reject Codex at `buildProfile`, before its catch and before proxy/shared-env fallback; both public legacy profile methods reach it. | `workspace-provider-profile-resolver.ts:471,516` | `workspace-provider-profile-resolver.spec.ts:647` |
| 2. Hosts without native adapter bypass the router. | Confirmed `register.ts:1061-1080,1135-1142` selects raw SDK, then traced `resolveClaudeExecution` at `chat-runtime-profile.service.ts:49-68` through the guarded resolver. No `register.ts` edit is needed for this path. | `workspace-provider-profile-resolver.ts:471` | `workspace-provider-profile-resolver.spec.ts:647` |
| 3. Stored legacy Codex cleanup/status threw. | Restrict legacy identity rejection to resume, send, slash command, and `setSession*`; cleanup/status route to legacy. | `routing-agent-adapter.ts:137-193,237-246` | `routing-agent-adapter.spec.ts:176,196` |
| 4. Unconditional missing-admission check could give Claude a Codex error. | Put native checks in Codex branches and use a generic error if the admission port is absent for Claude. | `routing-agent-adapter.ts:96-132` | `routing-agent-adapter.spec.ts:481` |
| 5. Non-native Codex left a running Copilot proxy. | Stop it before returning the explicit Codex failure. | `oauth-proxy.strategy.ts:281` | `oauth-proxy.strategy.spec.ts:483` |
| 6. Recovery hint was vague. | Name the Ptah desktop app (Electron) with native Codex enabled. | `workspace-provider-profile-resolver.ts:516-524` | `workspace-provider-profile-resolver.spec.ts:647,1292` |

Revision checks: the six edited TypeScript files parse with zero Tree-sitter error nodes; `git diff --check` is clean; all six have no CR bytes or BOM. The permitted degradation audit exited 0 with the same 280 repository sites and no baseline changes. Tests, typecheck, lint, build, Nx, Jest, and diagnostics were not run as instructed.
