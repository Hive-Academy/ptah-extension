## Backend implementation — `TASK_2026_596_0a19`, batch 7

**Tasks completed**: 7.1 (`ProviderQuotaStore` observers + `translation-proxy-base.ts` owner hook), 7.2 (`CodexTranslationProxy` owner hook)

**Files**:

- MODIFIED D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\auth-providers\src\lib\auth\provider-quota.store.ts — new exported types `ProviderQuotaContext` `{ownerKey, model?, statusCode}`, `ProviderQuotaObservation` `{providerId, ownerKey, model, retryAfterRaw, observedAt, gateUntil}` and `ProviderQuotaListener`. `recordRateLimit(providerId, retryAfter?, now?, ctx?)` notifies the rate-limit listeners after the map update. `recordSuccess(providerId, ctx?, now?)` always clears the gate as before, but notifies the success listeners only when `ctx` exists and `200 <= statusCode < 300`. `onRateLimit` / `onSuccess` each return an unsubscribe function. Listeners are notified from a snapshot, and a throw from any listener is caught and swallowed (the reason is commented at the swallow site). The gate map, the clamp, `parseRetryAfterMs`, `cooldownFor`, `retryAfterMs` and `clear` are unchanged.
- MODIFIED D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\auth-providers\src\lib\translation\translation-proxy-base.ts — adds the protected `resolveQuotaOwnerKey(headers)` and a private safe wrapper `quotaOwnerKeyFor`. `noteUpstreamQuota` now takes `ctx` and passes it through, and both call sites pass `{ownerKey, model: originalRequest.model, statusCode}`.
- MODIFIED D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\auth-providers\src\lib\providers\codex\codex-translation-proxy.ts — injects `AUTH_PROVIDERS_TOKENS.SDK_CODEX_ACCOUNT_USAGE` typed as `ICodexOwnerKeySource`. Overrides `resolveQuotaOwnerKey` to return `currentOwnerKey() ?? null` and ignores the rotating bearer.
- MODIFIED D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\auth-providers\src\lib\auth\provider-quota.store.spec.ts — +13 observer cases.
- MODIFIED D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\auth-providers\src\lib\translation\translation-proxy-base.spec.ts — new describe block "quota owner key at the response boundary" (9 cases). The fake gets an `ownerKeyOverride` seam, and `getHeadersMock` is typed as `Record<string,string>`.
- MODIFIED D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\auth-providers\src\lib\providers\codex\codex-translation-proxy.spec.ts — new describe block "Codex quota owner hook" (3 cases).
- MODIFIED D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\auth-providers\src\lib\di\register.spec.ts — the fixture now registers stubs for `SDK_TOKENS.SDK_PROCESS_SPAWNER` and `SDK_TOKENS.SDK_ADAPTER_EVENTS`. This file is outside the batch; see Plan deviations.

### `translation-proxy-base.ts` edit ranges (from `git diff -U0`, original → new)

- Import block: original line 70 → new lines 70-77 (resolver functions and `ProviderQuotaContext` type).
- Inserted after original line 262 → new lines 270-305: `resolveQuotaOwnerKey` and `quotaOwnerKeyFor`.
- `noteUpstreamQuota`: original lines 273, 279 and 281 → new lines 317, 323-328 and 330 (`ctx` parameter and pass-through).
- Inserted after original line 991 (just after the `getHeaders()` try/catch closes) → new lines 1041-1042: `const quotaOwnerKey = await this.quotaOwnerKeyFor(headers);`
- 429 call site: original line 1124 → new lines 1175-1179.
- Below-400 call site: original line 1179 → new lines 1234-1238.
- **Original lines 966-976 (the 597 Task 12.3 region) are untouched.** No hunk falls between original lines 282 and 991.

**Stack observed**:

- TypeScript with tsyringe DI (`@injectable`/`@inject`; registration in `providers/register-providers.ts:87-97`) and Jest via Nx.
- The proxy base is not built by the container (`provider-quota.store.ts` header comment), so the resolver is consumed through its module-level functions (`quota/provider-owner.resolver.ts:131-150`).
- Logging uses the injected `Logger` only.

**Verification**:

- `npx nx run-many -t typecheck,lint -p @ptah-extension/auth-providers --skip-nx-cache --parallel=2` → `Successfully ran targets typecheck, lint`.
- `npx nx run-many -t typecheck,test,lint -p @ptah-extension/auth-providers --skip-nx-cache --parallel=2`:
  - test: **Test Suites 1 failed, 53 passed, 54 total; Tests 4 failed, 1390 passed, 1394 total**.
  - The only failing suite is `translation-proxy.sdk.integration.spec.ts`, and every one of its failures is `EPERM, Permission denied ... ptah-sdk-int-*\scenario-*`, which is the known item.
  - Batch 6 baseline was 1364/1368.
- Known-item check, run alone: `npx jest -c libs/backend/auth-providers/jest.config.ts .../translation-proxy.sdk.integration.spec.ts --verbose` → **4 failed (S1-S4, all EPERM teardown), 5 passed, 9 total**. This is the same split as the Batch 6 worktree baseline. There is no new failure.
- Intermediate finding, now fixed: the first full run also failed `di/register.spec.ts` (2 tests). The cause was `Attempted to resolve unregistered dependency token: Symbol(SdkProcessSpawner)` via `CodexTranslationProxy → CodexAccountUsageService`. After the fixture fix it shows 2/2 passed.
- Cross-project DI sanity: the `cli-agent-runtime` smoke specs `register.ptah-cli-registry.smoke.spec.ts` and `register.agent-process-manager.smoke.spec.ts` register auth and SDK together. Result: 2 suites, 8/8 passed.

**Fixtures covered**:

- **F67**: two same-provider proxies with `Bearer key-A` and `Bearer key-B` record two distinct owner keys, each equal to `credentialOwnerKey('fake-provider', K)`. The provider gate stays keyed by provider id.
- **F67b (proxy side)**: `Authorization: Bearer K` and `X-Api-Key: K` (mixed-case name) both give an owner key equal to `ProviderOwnerResolver.ownerForProviderKey('fake-provider').key` when the stored key is `K`.
- **F68**: the Codex proxy with `currentOwnerKey()` returning null records a 429 with `ownerKey: null`, and the gate still arms. Further cases:
  - The account owner is used, not the bearer.
  - Container resolution injects from `SDK_CODEX_ACCOUNT_USAGE`.
- **F80**:
  - Store: 200, 204 and 299 emit a success. 199, 300, 302 and 304 clear the gate with no emission. A null owner 2xx is emitted with `ownerKey: null`; it is the ledger (Batch 8) that clears nothing for it.
  - Proxy end to end: a 2xx emits a success with the request owner; a 302 clears the gate with no emission.
  - The credit/fallback "never clears exhaustion" half belongs to the ledger (Batch 8). The store emits no exhaustion signal.
- Failure isolation:
  - A throwing owner hook leaves the 429 body and status byte-identical, gives a null owner, and the gate still arms.
  - A throwing success observer leaves the 2xx response intact.
  - A throwing rate-limit observer affects neither the gate nor the later observers.
  - Unsubscribe works, including unsubscribe during delivery.

**Risk handling**:

- Hook failure: `quotaOwnerKeyFor` is a separate try/catch placed directly after the `getHeaders()` try/catch, not inside it. Putting it inside would turn a hook failure into the existing 401 response. Any throw or rejection becomes `null` and is logged at debug with only the error *name*, so no message text or credential can reach the log.
- Listener failure: caught in `ProviderQuotaStore.notify`, after the gate update has already happened. `noteUpstreamQuota` keeps its own outer try/catch.
- No second parser or hash: the default hook calls `credentialFromHeaders` and `credentialOwnerKey` from `quota/provider-owner.resolver.ts`, and the proxy hashes nothing.
- Credential material is never logged or stored. Only the opaque key travels.
- The gate is unchanged: it still clears for every status below 400 as before. `cooldownFor`, the clamp and `ProviderAuthResolver` are untouched.
- The owner key is resolved once per attempt; a 401 retry re-enters `forwardToApi` and re-resolves it from the refreshed headers.

**Plan deviations**:

1. **`CodexTranslationProxy`'s third constructor parameter is optional** (`codexOwnerKeys?: ICodexOwnerKeySource`).
   - Why: `auth/provider-proxy-pool.ts:270` builds `new CodexTranslationProxy(this.logger, this.codexAuth)` by hand, as do three specs outside this batch (`codex-stream-parity.spec.ts`, `translation-proxy.sdk.integration.spec.ts` and the existing cases in `codex-translation-proxy.spec.ts`). A required parameter would break typecheck in files this batch does not own.
   - Effect: container-built instances always get the service. A hand-built instance has no Codex identity, and its evidence is unattributed (`null`, the same as F68).
2. **`di/register.spec.ts` fixture edited (outside the batch file list).** The plan-mandated injection pulls `CodexAccountUsageService` into the `ProviderAuthResolver → CuratorProxyManager → CodexTranslationProxy` graph. That service needs `SDK_PROCESS_SPAWNER` and `SDK_ADAPTER_EVENTS`, which this registration-contract fixture did not stub.
   - Production is unaffected. Every host registers agent-sdk right after auth (`apps/ptah-extension-vscode/src/di/phase-2-libraries.ts:151-152`, `apps/ptah-electron/src/di/phase-2-libraries.ts:196-201`, `libs/backend/cli-engine/src/lib/container.ts:651-655`), and `registerAuthProvidersServices` resolves only the pricing service eagerly.
   - The edit is 6 test-only lines. The team-leader may prefer to move it to another batch; without it, `register.spec.ts` fails 2 tests.
3. **The rate-limit observer fires even without `ctx`** (owner `null`), following the plan's `ctx?.ownerKey ?? null`. A success without `ctx` has no status, so it emits nothing and clears the gate only. In production both proxy call sites always pass `ctx`.

**Out-of-scope observations**:

- `provider-proxy-pool.ts:270` (per-workspace isolated Codex proxies) should pass the injected `SDK_CODEX_ACCOUNT_USAGE` service as the third constructor argument. Until it does, 429s from pool-built Codex proxies are recorded unattributed (safe, but never attributed). Suggested owner: Batch 13 (owner-lifecycle integration) or a follow-up.
- The working tree also has uncommitted changes in `session-stats-summary.component.ts` and `session-stats-summary.component.spec.ts` (frontend). They are not from this batch and were left untouched.
- `ProviderOwnerResolver` is still not DI-registered (Batches 8-9, as recorded in Batch 6).
