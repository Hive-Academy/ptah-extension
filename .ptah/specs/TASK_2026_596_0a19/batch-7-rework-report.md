# Batch 7 rework — Task 7.2 (ProviderProxyPool Codex owner-key wiring)

## Finding addressed

`ProviderProxyPool.createProxy('openai-codex')` built `CodexTranslationProxy` without the
owner-key source, so a 429 from a per-workspace (pool-built) Codex proxy was recorded with
`ownerKey: null`.

## Changes

MODIFIED `libs/backend/auth-providers/src/lib/auth/provider-proxy-pool.ts`
- Added `import type { ICodexOwnerKeySource } from '../providers/codex/codex-provider.types';`.
  The type is not exported from the `../providers/codex` barrel, so it is imported from its
  defining file, the same way `quota/provider-owner.resolver.ts:36-39` does. It is a type-only
  import, so it adds no runtime import cycle.
- Added a 7th constructor parameter:
  `@inject(AUTH_PROVIDERS_TOKENS.SDK_CODEX_ACCOUNT_USAGE) private readonly codexOwnerKeys: ICodexOwnerKeySource`.
- `openai-codex` case: `new CodexTranslationProxy(this.logger, this.codexAuth, this.codexOwnerKeys)`.

MODIFIED `libs/backend/auth-providers/src/lib/auth/provider-proxy-pool.spec.ts`
- `makePool()` now passes a stub `{ currentOwnerKey: () => CODEX_ACCOUNT_OWNER }` as the 7th
  argument. It also takes an optional `codexAuth` override; existing callers are unchanged.
- New test: `ProviderProxyPool Codex quota owner (TASK_2026_596 Task 7.2) › a pool-built Codex
  proxy records a 429 against the injected account owner`. It starts a local upstream that
  returns 429 and calls `pool.acquire('/ws/codex', 'openai-codex', …)` with the real
  `CodexTranslationProxy`. It posts `/v1/messages` to the acquired baseUrl, then asserts that
  `providerQuotaStore.onRateLimit` (the Task 7.1 observer) fired once with
  `{ providerId: 'openai-codex', ownerKey: CODEX_ACCOUNT_OWNER }`. The stub auth sends a
  rotating bearer, so the test also proves the bearer is not used as the owner.

## DI registration

No change was needed. `SDK_CODEX_ACCOUNT_USAGE` is registered in
`providers/register-providers.ts:94`. `registerProviders` is called by
`registerAuthProvidersServices` (`di/register.ts:56`) before the pool is registered
(`di/register.ts:93-94`), and tsyringe resolves lazily. The only other code that constructs
`ProviderProxyPool` is the pool spec. The resolver spec and the workspace-rpc spec use cast
stubs, not the constructor.

## Verification

- `npx jest -c libs/backend/auth-providers/jest.config.ts …/provider-proxy-pool.spec.ts`: 20/20 passed.
- `npx nx run-many -t typecheck,test,lint -p @ptah-extension/auth-providers --skip-nx-cache`:
  - typecheck: passed
  - lint: passed
  - test: Suites 53 passed / 1 failed (54). Tests 1390 passed / 5 failed (1395).
    All 5 failures are in `translation-proxy.sdk.integration.spec.ts` (S1, S2, S3, S4, S6b).
    Every one is a temp-dir teardown `EPERM, Permission denied` / `ENOTEMPTY, Directory not
    empty` under `%TEMP%\ptah-sdk-int-*`. This is the allowed environmental failure.

## Scope

No other Batch 7 file was touched. `batches.md` was not edited. Nothing was staged or committed.
