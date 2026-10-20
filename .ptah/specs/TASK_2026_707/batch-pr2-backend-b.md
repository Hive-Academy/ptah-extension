# PR 2 backend batch B report

## Files changed
- libs/backend/rpc-handlers/src/lib/handlers/analytics-rpc.handlers.ts (new): `AnalyticsRpcHandlers`, method `analytics:usageSummary`
- libs/backend/rpc-handlers/src/lib/handlers/analytics-rpc.handlers.spec.ts (new, 6 tests)
- libs/backend/rpc-handlers/src/lib/handlers/index.ts, libs/backend/rpc-handlers/src/index.ts: export
- libs/backend/rpc-handlers/src/lib/register-shared-rpc-handlers.ts: `registerSingleton(AnalyticsRpcHandlers)`
- libs/backend/rpc-handlers/src/lib/host-profile/manifest.ts: entry `analytics`, `requires: []` (every host serves it; this is what drives the host surface)
- apps/ptah-electron/src/di/phase-2-libraries.ts, apps/ptah-extension-vscode/src/di/phase-2-libraries.ts, libs/backend/cli-engine/src/lib/container.ts: `registerUsageAnalytics(container)` straight after `registerAuthProvidersServices`, in the libraries phase

## Handler behaviour
- Params are parsed with `UsageSummaryParamsSchema`. Failure gives `RpcUserError` `INVALID_PARAMS`.
- Workspace: `params.workspace`, otherwise the active workspace root. Missing gives `WORKSPACE_NOT_OPEN`. It is then confined with `isAuthorizedWorkspace`, the same helper `session:stats-batch` uses. Refusal gives `UNAUTHORIZED_WORKSPACE`.
- The service is injected by `USAGE_ANALYTICS_TOKENS.USAGE_ANALYTICS_SERVICE` from the `@ptah-extension/usage-analytics` public index only. It runs under a 30s abort budget.
- The result is validated with `UsageSummarySchema`. Any failure is logged as a real Error and answered with a fixed `PERSISTENCE_UNAVAILABLE` error, so no detail leaks.

## Guard specs
No edits were needed: none of them enumerates methods by name. They derive from the manifest and `EXPECTED_RESOLVABLE`, which lists only host-specific handlers.
| Spec | Result |
| --- | --- |
| analytics-rpc.handlers.spec.ts | 6 passed |
| electron container.smoke, rpc-surface, surface-composition | 36 passed |
| vscode container.smoke, rpc-surface, surface-composition | 53 passed |
| cli container.smoke (jest.config.cjs) | 19 passed |
| cli-engine rpc-surface, surface-composition (jest.config.cjs) | 19 passed |

Typecheck tail: `NX Successfully ran target typecheck for project @ptah-extension/rpc-handlers` (1m 5s).

Module boundaries: both libs are tagged `scope:extension` / `type:feature`, so rpc-handlers to usage-analytics is allowed with no tag change. The tsconfig path already exists. No project.json change was needed because the dependency is an import. I did not run an nx lint.

## Decisions
- Reused existing error codes (`INVALID_PARAMS`, `WORKSPACE_NOT_OPEN`, `UNAUTHORIZED_WORKSPACE`, `PERSISTENCE_UNAVAILABLE`) rather than adding a new one. Reversible.
- Manifest entry has `requires: []`, because unreadable sources are reported as `unavailable` inside the summary. Reversible.
- The handler injects the service through the constructor (token) instead of resolving it per call, because every host registers it in the libraries phase before the handlers phase.
- Authorization throws `RpcUserError` with a code instead of the plain `Error('workspace-not-authorized')` that session:stats-batch throws, so the webview gets a stable code.

## Clarifications Needed
- None. Note for batch A: the service reads `UsageAnalyticsService.summarize(params, workspacePath, signal)`; the handler depends on that signature.
- The Electron, VS Code and CLI smoke specs do not resolve `AnalyticsRpcHandlers` or the usage-analytics token, so the DI wiring of the new handler is not directly exercised by those specs. Adding such a test is a follow-up.
