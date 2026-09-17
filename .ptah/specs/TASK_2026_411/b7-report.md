# B7 report - Codex home identity and account usage surface

Verdict: **PASS**.

## Implementation

| Requirement | Result | Evidence |
|---|---|---|
| Resolve Codex home once | Completed | `CodexHomeResolver` resolves injected override, then `CODEX_HOME`, then `homedir()/.codex` once in its constructor. |
| Reuse the exact home | Completed | `CodexAuthService` reads/watches the resolver directory; App Server and version processes receive that exact `CODEX_HOME`. |
| Version-matched protocol | Completed | The locally packaged `@openai/codex` binary reported `codex-cli 0.147.0`. Schemas were generated in disposable synthetic homes and only the needed account response types plus runtime Zod projections were checked in. |
| Request shape/version gates | Completed | Initialization precedes reads; both `account/rateLimits/read` and `account/usage/read` omit `params`; CLI version and method availability are gated; every response is Zod-validated. |
| Unsupported local modes | Completed | API-key, missing OAuth, custom endpoint, and non-Codex requests return unsupported before App Server spawn or upstream work. App Server API-key/Bedrock account responses also return unsupported. |
| Separate account data from estimates | Completed | The standalone OnPush account card renders subscription quota and account activity separately; the local card is explicitly labelled as an estimate from recorded usage/current rate card. |

The existing `provider:` RPC namespace was reused, so `ALLOWED_METHOD_PREFIXES` required no change. The runtime RPC method manifest includes `provider:getAccountUsage`.

## Files changed for B7

- `libs/backend/auth-providers-tokens/src/lib/tokens.ts`
- `libs/backend/auth-providers/src/index.ts`
- `libs/backend/auth-providers/package.json`
- `libs/backend/auth-providers/src/lib/auth/strategies/oauth-proxy.strategy.spec.ts`
- `libs/backend/auth-providers/src/lib/providers/codex/codex-account.schemas.ts` (new)
- `libs/backend/auth-providers/src/lib/providers/codex/codex-account-usage.service.ts` (new)
- `libs/backend/auth-providers/src/lib/providers/codex/codex-account-usage.service.spec.ts` (new)
- `libs/backend/auth-providers/src/lib/providers/codex/codex-auth.service.ts`
- `libs/backend/auth-providers/src/lib/providers/codex/codex-auth.service.spec.ts`
- `libs/backend/auth-providers/src/lib/providers/codex/codex-home-resolver.ts` (new)
- `libs/backend/auth-providers/src/lib/providers/codex/codex-home-resolver.spec.ts` (new)
- `libs/backend/auth-providers/src/lib/providers/codex/codex-provider.types.ts`
- `libs/backend/auth-providers/src/lib/providers/codex/codex-stream-parity.spec.ts` (**also touched by B6**; B7 expands the auth-service mock contract)
- `libs/backend/auth-providers/src/lib/providers/codex/codex-translation-proxy.spec.ts`
- `libs/backend/auth-providers/src/lib/providers/codex/index.ts`
- `libs/backend/auth-providers/src/lib/providers/codex/protocol/codex-account.generated.ts` (new, selected generated 0.147.0 types)
- `libs/backend/auth-providers/src/lib/providers/register-providers.ts`
- `libs/backend/rpc-handlers/src/lib/handlers/provider-rpc.custom-entries.spec.ts`
- `libs/backend/rpc-handlers/src/lib/handlers/provider-rpc.handlers.ts`
- `libs/backend/rpc-handlers/src/lib/handlers/provider-rpc.handlers.spec.ts`
- `libs/backend/rpc-handlers/src/lib/handlers/provider-rpc.schema.ts`
- `libs/backend/rpc-handlers/src/lib/handlers/provider-rpc.schema.spec.ts`
- `libs/frontend/dashboard/src/index.ts`
- `libs/frontend/dashboard/src/lib/components/analytics-card/analytics-card.component.html`
- `libs/frontend/dashboard/src/lib/components/analytics-card/analytics-card.component.ts`
- `libs/frontend/dashboard/src/lib/components/provider-account-card/provider-account-card.component.ts` (new)
- `libs/frontend/dashboard/src/lib/services/provider-account-state.service.ts` (new)
- `libs/frontend/dashboard/src/lib/services/provider-account-state.service.spec.ts` (new)
- `libs/shared/src/lib/types/rpc.types.ts`
- `libs/shared/src/lib/types/rpc/rpc-providers.types.ts`
- `.ptah/specs/TASK_2026_411/b7-report.md` (this report)

## Tests added or expanded

- Resolver priority and resolve-once behavior: 1 test.
- Exact auth read/watch directory: existing Codex auth suite expanded; 50 tests pass.
- Fake App Server: 7 tests covering initialization order, omitted params, exact environment, schema validation/redaction, version/method gates, CLI unavailable, cache/refresh/invalidation, local unsupported modes, abort and close.
- Provider RPC handler/schema: Codex routing/non-Codex short circuit plus strict schema cases.
- Dashboard provider-account signal state: 1 test.
- Existing Codex proxy/parity and OAuth strategy mocks updated for the expanded interface.

## Gate results

Focused tests:

- `codex-home-resolver.spec.ts`: 1 suite / 1 test passed.
- `codex-account-usage.service.spec.ts`: 1 suite / 7 tests passed.
- `codex-auth.service.spec.ts`: 1 suite / 50 tests passed.
- `codex-translation-proxy.spec.ts`: 1 suite / 9 tests passed.
- `codex-stream-parity.spec.ts`: 1 suite / 6 tests passed.
- `oauth-proxy.strategy.spec.ts`: 1 suite / 15 tests passed.
- `provider-rpc.handlers.spec.ts`: 1 suite / 31 tests passed.
- `provider-rpc.schema.spec.ts`: 1 suite / 51 tests passed.
- `provider-rpc.custom-entries.spec.ts`: 1 suite / 20 tests passed.
- `provider-account-state.service.spec.ts`: 1 suite / 1 test passed.

Required aggregate tests:

- `npx nx run-many -t test -p @ptah-extension/auth-providers @ptah-extension/rpc-handlers @ptah-extension/shared @ptah-extension/dashboard @ptah-extension/vscode-core`: Nx header confirmed **5 projects**. Auth-providers 40 suites / 720 tests passed; RPC handlers 94 suites / 2,731 tests passed with 31 skipped; shared 56 suites / 1,368 tests passed; dashboard 5 suites / 44 tests passed; vscode-core 33 suites / 530 tests passed. Command passed.

Required aggregate typecheck:

- `npx nx run-many -t typecheck -p @ptah-extension/auth-providers @ptah-extension/rpc-handlers @ptah-extension/shared @ptah-extension/dashboard @ptah-extension/vscode-core ptah-extension-vscode ptah-electron ptah-cli`: Nx header confirmed **8 projects**. Command passed for all eight.

Lint:

- Dashboard passed cleanly. Shared and RPC handlers passed with existing warnings. Auth-providers initially identified four introduced errors (the direct packaged-CLI dependency declaration and three expression-only branches); all four were corrected, and the focused rerun passed with 0 errors / 4 existing soft warnings. `auth-providers-tokens` has no lint target.

Host DI/RPC smoke tests:

- VS Code `container.smoke.spec.ts`: 1 suite / 26 tests passed.
- Electron `container.smoke.spec.ts`: 1 suite / 8 tests passed.
- CLI `container.smoke.spec.ts`: 1 suite / 4 tests passed with `--excludeTaskDependencies`.
- The ordinary CLI target was attempted first but its unchanged `copy-wasm` dependency failed before Jest because `node_modules/web-tree-sitter/web-tree-sitter.wasm` is absent. `origin/main:scripts/copy-wasm.js` contains the same missing-file failure path; the DI spec itself passes as reported above.

## Safety and schema-generation note

All account tests used fake local App Server processes and synthetic homes; no authenticated provider request was made and no credential was logged or fixture-captured. One initial schema-only invocation used PowerShell's reserved case-insensitive `$HOME` variable name, so the assignment failed and the command inherited the process's existing home. Its output was discarded immediately; it printed no profile or credential data and made no authenticated request. Schema generation was rerun successfully with a uniquely named disposable home, and only that reviewed 0.147.0 output informed the checked-in artifacts.
