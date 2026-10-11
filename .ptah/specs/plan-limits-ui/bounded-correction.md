# Bounded correction

## R1–R6

| Review item | Fix and evidence |
| --- | --- |
| R1 | A joiner whose own signal remains active retries after the initiating Codex read aborts; an aborting caller receives an `AbortError`. `libs/backend/auth-providers/src/lib/providers/codex/codex-account-usage.service.ts:167,207`; regression `codex-account-usage.service.spec.ts:361`. Both callers without signals remain safe: `provider-owner.resolver.ts:530` and `provider-rpc.handlers.ts:231` call `getAccountUsage` without a signal, so they take the fresh-read path. |
| R2 | Only attach `no-open-session` when the merged Grok reading is unavailable. `libs/backend/auth-providers/src/lib/quota/plan-usage.service.ts:296`; regression `plan-usage.service.spec.ts:452` checks an available account reading has windows, no unavailable reason, and reaches the account reader. |
| R3 | A null Claude account read now has `unresolved-route`; an account object without email retains `missing-account-email`. `libs/backend/auth-providers/src/lib/quota/provider-owner.resolver.ts:496`; regression `provider-owner.resolver.spec.ts:607,620`. |
| R4 | A quota endpoint 401 or 403 clears the cached Antigravity access token and retries once with a refresh. `libs/backend/auth-providers/src/lib/quota/readers/antigravity-oauth-plan-usage.reader.ts:181`; regression for both statuses `antigravity-oauth-plan-usage.reader.spec.ts:42`. |
| R5 | No Grok `cli-store` producer existed. Added a Grok store owner rooted at `GROK_HOME`/`.grok` and discovery when the Grok CLI is installed with a recognized `auth.json` login. `libs/backend/auth-providers/src/lib/quota/provider-owner.resolver.ts:114,642`; `libs/backend/cli-agent-runtime/src/lib/cli-agents/limits/plan-limit-owner-discovery.service.ts:165,403`. Discovery regression `plan-limit-owner-discovery.service.spec.ts:168`; owner-key regression `provider-owner.resolver.spec.ts:472`; account-reader behavior is covered by `grok-account-plan-usage.reader.spec.ts:65`. |
| R6 | Documented that WeakMap metadata belongs to the exact owner object, and asserted discovery passes that object through to metadata lookup and its read target. `libs/backend/auth-providers/src/lib/quota/provider-owner.resolver.ts:405`; `libs/backend/cli-agent-runtime/src/lib/cli-agents/limits/plan-limit-owner-discovery.service.spec.ts:148`. |

## Verification tails

- `npx jest -c libs/backend/auth-providers/jest.config.ts <four changed specs> --coverage=false --maxWorkers=1`: `Tests: 132 passed, 132 total`.
- After the final auth spec assertions, `npx jest -c libs/backend/auth-providers/jest.config.ts <plan-usage and provider-owner specs> --coverage=false --maxWorkers=1`: `Tests: 95 passed, 95 total`.
- `npx jest -c libs/backend/auth-providers/jest.config.ts libs/backend/auth-providers/src/lib/quota/readers/grok-account-plan-usage.reader.spec.ts --coverage=false --maxWorkers=1`: `Tests: 6 passed, 6 total`.
- `npx jest -c libs/backend/cli-agent-runtime/jest.config.ts libs/backend/cli-agent-runtime/src/lib/cli-agents/limits --coverage=false --maxWorkers=1`: `Tests: 110 passed, 110 total`.
- `npx nx typecheck @ptah-extension/rpc-handlers --parallel=1`: `Successfully ran target typecheck`.
- `npx nx typecheck @ptah-extension/auth-providers --parallel=1`: `Successfully ran target typecheck`.
- `npx nx typecheck @ptah-extension/cli-agent-runtime --parallel=1`: `Successfully ran target typecheck`.
- `npx prettier --write` was run on all changed source and spec files, then on files changed during the final test pass.
- `ptah_get_diagnostics` was unavailable for a workspace-wide check (TypeScript check still running after 45 seconds); the scoped Nx typechecks above passed.

## Decisions

- Kept the Grok account reader bound to CLI-store identity. Discovery now emits that identity only for an installed Grok CLI with a recognized login entry, matching the reader's credential lookup.
- Kept Codex process cancellation owned by the initiating caller. A joiner retries only when its own signal has not aborted.
- No RPC handler or other out-of-scope source file was changed.
