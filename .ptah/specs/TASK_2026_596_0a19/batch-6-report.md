# Backend implementation — `TASK_2026_596_0a19`, batch 6

**Tasks completed**: 6.1 (owner resolver), 6.2 (Codex protocol re-pin + `currentOwnerKey`), 6.3 (auth-providers tokens).
R3 did **not** stop Task 6.2: the selected types only changed additively.

## Files

- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\auth-providers\src\lib\quota\provider-owner.resolver.ts`: the only place that computes fingerprints and parses credentials. It has module-level `ownerFingerprint`, `credentialFromHeaders`, `credentialOwnerKey`, `accountOwnerKey`, `cliStoreOwnerKey`, `unknownOwnerKey`, plus `normaliseOwnerProviderId` and `quotaOwnerRefFromKey`, and the DI class `ProviderOwnerResolver`.
- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\auth-providers\src\lib\quota\provider-owner.resolver.spec.ts`: 41 tests covering F78, F67b, all four identity kinds through `parseQuotaOwnerRef`, the `ownerForSession` route table and the no-material checks.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\auth-providers\src\lib\providers\codex\protocol\codex-account.generated.ts`: regenerated from 0.155.1.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\auth-providers\src\lib\providers\codex\codex-account.schemas.ts`: `CODEX_ACCOUNT_PROTOCOL_VERSION = '0.155.1'`, `planType` gains `edu_plus`/`edu_pro`, and the snapshot gains `rateLimitReachedType`.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\auth-providers\src\lib\providers\codex\codex-provider.types.ts`: adds `quota.rateLimitReachedType?` and a new `ICodexOwnerKeySource { currentOwnerKey(): string | null }`.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\auth-providers\src\lib\providers\codex\codex-account-usage.service.ts`: adds `currentOwnerKey()`, a `clearCache` generation guard and the `rateLimitReachedType` pass-through.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\auth-providers\src\lib\providers\codex\codex-account-usage.service.spec.ts`: the version mock moves from `'0.147.0'` to `'0.155.1'`, plus 9 new cases.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\auth-providers-tokens\src\lib\tokens.ts`: adds `PROVIDER_OWNER_RESOLVER`, `PLAN_LIMIT_LEDGER`, `PLAN_USAGE_SERVICE` and `PLAN_CREDENTIAL_SOURCE`, all `Symbol.for(...)`. No other library already uses these descriptions (checked with grep).

The temporary generate-ts output (`/tmp/tmp.ScPF47DNCD`) was created outside the repo and has been deleted. It is confirmed gone.

## R3: Codex protocol re-pin (Task 6.2, run first, offline)

- `node node_modules/@openai/codex/bin/codex.js --version` printed **`codex-cli 0.155.1`**.
- `node node_modules/@openai/codex/bin/codex.js app-server generate-ts --out <tmp>` ran locally and wrote 95 top-level files plus `v2/`. No account call was made and no network was used.
- I compared the selected types with the 0.147.0 pin:

| Type | Change | Kind |
| --- | --- | --- |
| `PlanType` | `+ 'edu_plus' \| 'edu_pro'` | additive |
| `Account`, `GetAccountResponse`, `RateLimitWindow` | none | unchanged |
| `RateLimitSnapshot` | `+ normalModelSlug: string \| null`; `rateLimitReachedType` narrowed from `string \| null` to a 5-member literal union; `credits`/`individualLimit` now have concrete types (`CreditsSnapshot`/`SpendControlLimitSnapshot`) where the pin had `unknown` | additive / narrowing (compatible for a reader) |
| `GetAccountRateLimitsResponse` | `+ ordinaryUsageAllowed`, `+ accountId`, `+ rateLimitUpsell`; `rateLimitResetCredits` now has a concrete type | additive |
| `AccountTokenUsageSummary`, `AccountTokenUsageDailyBucket` | none (still `bigint`, projected to decimal strings) | unchanged |
| `GetAccountTokenUsageResponse` | `+ threadUsage?: ThreadUsage \| null` | additive |

**Verdict: compatible.** The new types only add fields or narrow existing ones, so the version bump was allowed. Nested types Ptah does not read stay `unknown` in the regenerated file. `rateLimitReachedType` is validated as `z.string()` rather than the literal union, so a value added by a later CLI is passed through instead of failing the whole read.

## Stack observed

- tsyringe DI with `@injectable`/`@inject`, as in `codex-account-usage.service.ts:75-92`. Tokens are in `auth-providers-tokens` and re-exported through `src/lib/di/tokens.ts`.
- zod validates at the boundary (`codex-account.schemas.ts`).
- Logging goes through `Logger` via `TOKENS.LOGGER`.
- Import direction: auth-providers already depends on agent-sdk (`package.json` dependencies, `codex-account-usage.service.ts:5`), so importing `SDK_TOKENS`, `SessionQuotaProbe` and `parseQuotaOwnerRef` creates no cycle.
- `AccountInfo` is not exported from agent-sdk, so the resolver derives it as `Awaited<ReturnType<SessionQuotaProbe['readAccount']>>`. No new export was needed.

## Fixtures covered

- **F78**: `authorization: bearer K` and `Authorization: Bearer  K` give `K`; `Basic X` gives `X`; a raw `K` gives `K`; `x-api-key` takes precedence; missing or empty gives `null`; `Bearer Bearer K` gives `Bearer K`. Extra cases: a repeated header uses its first value, `BearerK` is kept raw, a scheme with nothing after it gives `null`, and an empty `x-api-key` falls back to `authorization`.
- **F67b (resolver side)**: stored `K` gives the same key as `Authorization: Bearer K` and as a mixed-case `X-Api-Key: K`.
- **F30 (partial, Codex)**:
  - same-account transient failure with a cache gives `stale` and keeps the owner;
  - transient failure with no cache gives `cli-unavailable` and no owner;
  - unsupported auth (`apiKey`) gives no owner;
  - an unsupported CLI version is covered by the existing case;
  - account A then B gives B's key, not stale A;
  - A then sign-out gives `service-unavailable` and a null key.
- **Batch 5 carry-forward**: every produced `QuotaOwnerRef` passes `parseQuotaOwnerRef` for all four `identityKind` values, through the `expectRestorable` helper used across the whole spec. Provider ids are normalised to `/^[a-z0-9][a-z0-9._-]{0,63}$/`, and labels are generic text such as "Claude account", "Codex account", "Ollama Cloud API key", "OpenCode CLI login" or "Codex (owner unknown)", with no `@`.

## Verification

- `npx nx run-many -t typecheck,test,lint -p @ptah-extension/auth-providers @ptah-extension/auth-providers-tokens --parallel=2`:
  - typecheck and lint passed for both projects.
  - The `test` target **failed**: 1 suite failed and 53 passed; 4 tests failed and 1364 passed.
  - All 4 failures are in `translation-proxy.sdk.integration.spec.ts` (S1-S4). Each one is `EPERM, Permission denied` from `rmSync` in that spec's own teardown (`:177`), when it deletes `%TEMP%\ptah-sdk-int-*\scenario-*` after spawning the real CLI. It fails the same way when run alone (4 failed, 5 passed). The spec imports nothing changed in this batch except the type-only `ICodexAuthService`. I treat it as a Windows file-handle problem in the environment, not a regression, but it needs a clean re-run by the team-leader.
- `npx jest -c libs/backend/auth-providers/jest.config.ts provider-owner.resolver codex-account-usage.service`: 64/64 passed.
- `npx nx run @ptah-extension/rpc-handlers:typecheck --skip-nx-cache`: passed. That library consumes `CodexAccountUsageResult`, which gained an optional field.
- `ptah_get_diagnostics` on the new and changed files: 0 errors.
- The root barrel `libs/backend/auth-providers/src/index.ts` is still 150 lines, unchanged (R1).

## Plan deviations

1. **`ownerKey` is not a field on `CodexAccountUsageResult`.** Component 7 calls for an internal, non-RPC field, but `provider-rpc.handlers.ts:183` returns that object over RPC unchanged. The key is held privately in the service and exposed only through `currentOwnerKey()`. A spec asserts the result has no `ownerKey` property.
2. **`currentOwnerKey()` is on a new `ICodexOwnerKeySource` interface, not on `ICodexAccountUsageService`.** Adding it to the existing interface would break the hand-written mocks in `rpc-handlers` specs (`provider-rpc.handlers.spec.ts:200`, `provider-rpc.custom-entries.spec.ts:119`), which are outside this batch. `CodexAccountUsageService` implements both interfaces, and the resolver depends only on the narrow one.
3. **`ownerForClaudeAccount(account, routeMaterial)` takes a second argument.** Decision 3 makes an unknown key need route material, and the account alone has none. `ownerForSession` passes `session:<id>`.
4. **A proxy route with `providerId === 'openai-codex'` goes to `ownerForCodexHome()`, not `ownerForProviderKey`.** This follows Decision 3's identity table (Codex main-via-proxy = `CODEX_HOME` + email). Other proxies use the stored provider key, as batches.md says.
5. **The `clearCache` generation guard is new.** A read that was already running when `authFileChanged` fired still answers its own caller. It is no longer cached and does not set the owner key, and later callers start a fresh read instead of joining it. This closes an A→B window where A's data and key could be re-installed after the change. A spec pins it.
6. **Placeholder keys give an `unknown` owner.** Every existing `*_PROXY_TOKEN_PLACEHOLDER` constant, plus `OLLAMA_AUTH_TOKEN_PLACEHOLDER`, is treated as identifying nobody (Decision 3 table, Ollama row).
7. **The Ptah CLI key-slot prefix is a local literal.** The resolver uses `'ptahCli'` because auth-providers cannot import `PTAH_CLI_KEY_PREFIX` from cli-agent-runtime. A comment marks it as a mirror of that constant.

DI registration of `ProviderOwnerResolver` under `PROVIDER_OWNER_RESOLVER` is not done here; batches.md assigns registrations to Batches 8-9.

## Risk handling

- **R3**: run first, offline. The comparison found only additive or narrowing changes, so the bump went ahead (see the table above).
- **R4**:
  - Material (email, API key, path) is hashed only inside `provider-owner.resolver.ts`, plus the Codex service's call to `accountOwnerKey`.
  - No material is returned, logged or stored. The only log is a `warn` on a failed secret read, carrying `{providerId}` only, and the store's error text is dropped.
  - Specs check that serialized refs and logger calls contain neither the email nor the key, in both the resolver and Codex specs.
- **R7**: unknown owners are keyed per route material (session, `CODEX_HOME`, provider-key slot, Ptah CLI id) and are always `identityKind: 'unknown'`.

## Out-of-scope observations

- `performRead` caches every successful result, including `unsupported-auth` and `service-unavailable` (sign-out). A later transient failure then serves that windowless result as `stale`. This is pre-existing and harmless (no windows), and Batch 9's reader stale rule should be aware of it.
- `translation-proxy.sdk.integration.spec.ts` teardown EPERM on Windows, described under Verification.
