# Implementation Plan - TASK_2025_164: Encapsulate AuthEnv

## Codebase Investigation Summary

### Mutation Sites (8 total)

**AuthManager** (`libs/backend/agent-sdk/src/lib/helpers/auth-manager.ts`):

1. Line 209: `process.env['CLAUDE_CODE_OAUTH_TOKEN'] = oauthToken.trim()` (configureOAuthToken - SecretStorage path)
2. Line 230: `process.env['CLAUDE_CODE_OAUTH_TOKEN'] = envOAuthToken` (configureOAuthToken - env snapshot path)
3. Line 306: `process.env['ANTHROPIC_BASE_URL'] = baseUrl` (configureAnthropicProvider)
4. Line 307: `process.env[authEnvVar] = providerKey.trim()` (configureAnthropicProvider - ANTHROPIC_AUTH_TOKEN or ANTHROPIC_API_KEY)
5. Line 363: `process.env['ANTHROPIC_API_KEY'] = apiKey.trim()` (configureAPIKey - SecretStorage path)
6. Line 385: `process.env['ANTHROPIC_API_KEY'] = envApiKey` (configureAPIKey - env snapshot path)

**ProviderModelsService** (`libs/backend/agent-sdk/src/lib/provider-models.service.ts`): 7. Line 337: `process.env[envVar] = modelId` (setModelTier) 8. Lines 399-406: `process.env[TIER_ENV_VARS.*] = tiers.*` (applyPersistedTiers via switchActiveProvider)

### Read Sites (3 total)

**SdkQueryOptionsBuilder** (`libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts`):

1. Line 358: `env: process.env as Record<string, string | undefined>` (build method - passed to SDK)
2. Lines 73-76: `process.env['ANTHROPIC_DEFAULT_OPUS_MODEL']` etc. (buildModelIdentityPrompt - module-private)
3. Lines 101-102: `process.env['ANTHROPIC_BASE_URL']` (getActiveProviderId - module-private)

**resolveActualModelForPricing** (`libs/backend/agent-sdk/src/lib/helpers/anthropic-provider-registry.ts`): 4. Lines 374-393: Reads `ANTHROPIC_BASE_URL` and `ANTHROPIC_DEFAULT_*_MODEL` env vars

### Delete Sites (Clean Slate)

**AuthManager**:

- Line 432-434: `clearAllAuthEnvVars()` deletes 4 auth env vars
- Line 100: calls `providerModels.clearAllTierEnvVars()`

**ProviderModelsService**:

- Lines 419-427: `clearAllTierEnvVars()` deletes 3 tier env vars
- Line 381: `clearModelTier()` deletes 1 tier env var

### Consumer Map (Who calls what)

| Function                                       | Called By                                    | File                                                                                                                                    |
| ---------------------------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `AuthManager.configureAuthentication()`        | `SdkAgentAdapter.initialize()`               | sdk-agent-adapter.ts:211                                                                                                                |
| `AuthManager.clearAuthentication()`            | `SdkAgentAdapter.dispose()`                  | sdk-agent-adapter.ts:275                                                                                                                |
| `ProviderModelsService.setModelTier()`         | `ProviderRpcHandlers`                        | provider-rpc.handlers.ts:198                                                                                                            |
| `ProviderModelsService.clearModelTier()`       | `ProviderRpcHandlers`                        | provider-rpc.handlers.ts:282                                                                                                            |
| `ProviderModelsService.switchActiveProvider()` | `AuthManager.configureAnthropicProvider()`   | auth-manager.ts:310                                                                                                                     |
| `ProviderModelsService.clearAllTierEnvVars()`  | `AuthManager` (clean slate + clearAuth)      | auth-manager.ts:100,407                                                                                                                 |
| `SdkQueryOptionsBuilder.build()`               | `SessionLifecycleManager.executeQuery()`     | session-lifecycle-manager.ts:516                                                                                                        |
| `resolveActualModelForPricing()`               | 4 internal callers                           | stream-transformer.ts:281,335; sdk-message-transformer.ts:802; session-history-reader.service.ts:340; session-replay.service.ts:248,553 |
| `getActiveProviderId()`                        | `SdkQueryOptionsBuilder.buildSystemPrompt()` | sdk-query-options-builder.ts:413                                                                                                        |
| `buildModelIdentityPrompt()`                   | `SdkQueryOptionsBuilder.buildSystemPrompt()` | sdk-query-options-builder.ts:414                                                                                                        |

---

## Architecture Design

### Design Philosophy

**Chosen Approach**: Value object accumulation pattern - AuthEnv is built up through the auth flow, stored on SdkAgentAdapter, and passed down to consumers.

**Rationale**: The current code mutates `process.env` in AuthManager, then readers (SdkQueryOptionsBuilder, resolveActualModelForPricing) pick up the values implicitly via global state. We replace this with:

1. AuthManager **returns** env vars instead of mutating process.env
2. ProviderModelsService **returns** tier vars instead of mutating process.env
3. SdkAgentAdapter **stores** the accumulated AuthEnv
4. SdkQueryOptionsBuilder **receives** AuthEnv and merges with process.env
5. Helper functions **accept** env as a parameter instead of reading process.env

### Component Specifications

---

#### Component 1: AuthEnv Type Definition

**File**: `libs/shared/src/lib/types/auth-env.types.ts` (CREATE)

**Purpose**: Define the AuthEnv value object type in the foundation layer so it's available everywhere.

```typescript
/**
 * Authentication environment variables as a value object.
 * Instead of mutating process.env, auth configuration produces this object.
 * Consumers merge it with process.env when needed: { ...process.env, ...authEnv }
 */
export interface AuthEnv {
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_BASE_URL?: string;
  ANTHROPIC_AUTH_TOKEN?: string;
  CLAUDE_CODE_OAUTH_TOKEN?: string;
  ANTHROPIC_DEFAULT_SONNET_MODEL?: string;
  ANTHROPIC_DEFAULT_OPUS_MODEL?: string;
  ANTHROPIC_DEFAULT_HAIKU_MODEL?: string;
}

/** Create an empty AuthEnv (all keys undefined) */
export function createEmptyAuthEnv(): AuthEnv {
  return {};
}
```

**Export from**: `libs/shared/src/index.ts` -- add `export * from './lib/types/auth-env.types';`

**Evidence**: Pattern matches existing type files in shared (e.g., `ai-provider.types.ts`, `branded.types.ts`). The 7 keys are exactly the env vars currently mutated by AuthManager (4 auth) + ProviderModelsService (3 tier).

---

#### Component 2: AuthManager - Return AuthEnv Instead of Mutating process.env

**File**: `libs/backend/agent-sdk/src/lib/helpers/auth-manager.ts` (MODIFY)

**Purpose**: `configureAuthentication()` builds an AuthEnv object and returns it alongside the existing AuthResult. Private methods populate the AuthEnv instead of calling `process.env[key] = value`. The "Clean Slate" pattern becomes: start with `createEmptyAuthEnv()` instead of deleting env vars.

**Changes**:

1. **Import AuthEnv** from `@ptah-extension/shared`

2. **Change return type** of `configureAuthentication`:

   ```typescript
   async configureAuthentication(rawAuthMethod: string): Promise<AuthResult & { env: AuthEnv }> {
   ```

3. **Build AuthEnv locally** instead of mutating process.env:

   ```typescript
   // Step 2: Clean slate - start with empty AuthEnv
   const authEnv: AuthEnv = createEmptyAuthEnv();
   // (clearAllAuthEnvVars and clearAllTierEnvVars calls are KEPT for backward compat
   //  during this transitional step -- they're harmless since process.env mutations
   //  will be overridden by the AuthEnv merge at the SDK call site anyway)
   ```

4. **Change private method signatures** to populate AuthEnv:

   ```typescript
   private async configureOAuthToken(envSnapshot: EnvSnapshot, authEnv: AuthEnv): Promise<AuthResult>
   private async configureAnthropicProvider(authEnv: AuthEnv): Promise<AuthResult>
   private async configureAPIKey(envSnapshot: EnvSnapshot, authEnv: AuthEnv): Promise<AuthResult>
   ```

5. **Replace `process.env[key] = value` with `authEnv[key] = value`** in each private method:

   - `configureOAuthToken`: `authEnv.CLAUDE_CODE_OAUTH_TOKEN = oauthToken.trim()` (line 209) and `authEnv.CLAUDE_CODE_OAUTH_TOKEN = envOAuthToken` (line 230)
   - `configureAnthropicProvider`: `authEnv.ANTHROPIC_BASE_URL = baseUrl` (line 306), `authEnv[authEnvVar as keyof AuthEnv] = providerKey.trim()` (line 307)
   - `configureAPIKey`: `authEnv.ANTHROPIC_API_KEY = apiKey.trim()` (line 363), `authEnv.ANTHROPIC_API_KEY = envApiKey` (line 385)

6. **ProviderModelsService interaction**: `switchActiveProvider` currently calls `clearAllTierEnvVars()` + `applyPersistedTiers()` which mutate process.env. Change `switchActiveProvider` and `applyPersistedTiers` to accept and populate an AuthEnv parameter. The AuthManager method `configureAnthropicProvider` passes `authEnv` to `switchActiveProvider`:

   ```typescript
   this.providerModels.switchActiveProvider(providerId, authEnv);
   ```

7. **Return AuthEnv in result**:

   ```typescript
   return { configured: true, details: authDetails, env: authEnv };
   // For the unconfigured case:
   return { configured: false, details: [], errorMessage: infoMsg, env: authEnv };
   ```

8. **logEnvSummary**: Change to accept AuthEnv parameter and log from it instead of process.env.

9. **clearAuthentication**: Keep existing behavior (deleting process.env vars). This is called on dispose and is a cleanup path. It should also return/clear the stored AuthEnv. We'll handle this at the SdkAgentAdapter level.

10. **KEEP the `clearAllAuthEnvVars()` and `clearAllTierEnvVars()` calls** in `configureAuthentication()`. These ensure the Clean Slate pattern still works for process.env. The AuthEnv is built fresh from empty, but process.env cleanup is kept as defense-in-depth until a future task removes it entirely. This is the zero-behavior-change guarantee.

**Important**: During this refactoring, we keep BOTH the process.env mutations AND the AuthEnv accumulation. The AuthEnv is the new source of truth that gets passed to SDK. The process.env mutations become dead code but are kept for safety (zero behavior change). A follow-up task can remove them.

**Wait -- correction**: Actually, re-reading the task description: "Return an AuthEnv value object **instead of** mutating process.env globally." The intent is to STOP mutating process.env. But we need to be careful: `resolveActualModelForPricing` is called from history replay and message transform code that doesn't have easy access to AuthEnv. Let me reconsider.

**Revised approach**:

- AuthManager stops mutating process.env (the 6 mutations become AuthEnv assignments)
- ProviderModelsService stops mutating process.env for tier vars (the 2 mutations become AuthEnv assignments)
- The `env` field in SDK query options becomes `{ ...process.env, ...authEnv }` -- this is where AuthEnv gets merged
- `resolveActualModelForPricing` gets an optional `env` parameter (defaults to process.env for backward compat during history replay)
- `buildModelIdentityPrompt` and `getActiveProviderId` get an `env` parameter

This means the SDK child process gets the auth vars via the merged env (which is how it works today -- just via process.env). The difference is: the extension's own process.env is no longer polluted.

---

#### Component 3: ProviderModelsService - Populate AuthEnv Instead of Mutating process.env

**File**: `libs/backend/agent-sdk/src/lib/provider-models.service.ts` (MODIFY)

**Purpose**: `switchActiveProvider()` and `applyPersistedTiers()` write tier vars into an AuthEnv parameter instead of process.env. `setModelTier()` and `clearModelTier()` also update AuthEnv.

**Changes**:

1. **Import AuthEnv** from `@ptah-extension/shared`

2. **`switchActiveProvider(providerId: string, authEnv: AuthEnv): void`**:

   - Instead of `clearAllTierEnvVars()` (which deletes from process.env), clear the 3 tier keys from authEnv:
     ```typescript
     delete authEnv.ANTHROPIC_DEFAULT_SONNET_MODEL;
     delete authEnv.ANTHROPIC_DEFAULT_OPUS_MODEL;
     delete authEnv.ANTHROPIC_DEFAULT_HAIKU_MODEL;
     ```
   - Then `applyPersistedTiers(providerId, authEnv)` populates them.

3. **`applyPersistedTiers(providerId: string, authEnv: AuthEnv): void`**:

   - Replace `process.env[TIER_ENV_VARS.sonnet] = tiers.sonnet` with `authEnv.ANTHROPIC_DEFAULT_SONNET_MODEL = tiers.sonnet` (and similarly for opus, haiku).

4. **`setModelTier(providerId, tier, modelId)` -- RPC-driven, called at runtime**:
   This is called from `ProviderRpcHandlers` when the user changes a tier mapping in the UI. It needs to update the stored AuthEnv on SdkAgentAdapter.

   **Option A (simple)**: `setModelTier` continues to persist to config (that's fine), but the caller (ProviderRpcHandlers) also needs to update the stored AuthEnv. Since ProviderRpcHandlers doesn't have access to SdkAgentAdapter's AuthEnv, we add a method to ProviderModelsService:

   ```typescript
   /** Apply a tier change to an existing AuthEnv */
   applyTierToEnv(tier: ProviderModelTier, modelId: string, authEnv: AuthEnv): void {
     const envKey = TIER_ENV_VARS[tier] as keyof AuthEnv;
     authEnv[envKey] = modelId;
   }

   /** Clear a tier from an existing AuthEnv */
   clearTierFromEnv(tier: ProviderModelTier, authEnv: AuthEnv): void {
     const envKey = TIER_ENV_VARS[tier] as keyof AuthEnv;
     delete authEnv[envKey];
   }
   ```

   But actually, `setModelTier` and `clearModelTier` need to propagate the env change to the SdkAgentAdapter. The cleanest approach: SdkAgentAdapter exposes a method `updateAuthEnv(patch: Partial<AuthEnv>)` that updates its stored AuthEnv. The RPC handler calls `setModelTier` for persistence AND the adapter for the live env.

   **Simpler approach chosen**: `setModelTier` and `clearModelTier` keep their current signatures (they persist to config). The process.env mutation is removed from them. Instead, SdkAgentAdapter will need to re-read tier config into AuthEnv when building queries. Actually, no -- that's a behavior change.

   **Final approach**: The simplest zero-behavior-change approach is:

   - `setModelTier` stops mutating process.env. It persists to config only.
   - `clearModelTier` stops mutating process.env. It clears config only.
   - The AuthEnv stored on SdkAgentAdapter is the single mutable copy. We add a method `SdkAgentAdapter.updateAuthEnvTier(tier, modelId)` and `SdkAgentAdapter.clearAuthEnvTier(tier)`.
   - `ProviderRpcHandlers` calls both `providerModels.setModelTier(...)` (for persistence) and `sdkAdapter.updateAuthEnvTier(tier, modelId)` (for live env).

   But `ProviderRpcHandlers` doesn't currently inject `SdkAgentAdapter`. That's a new dependency.

   **Even simpler**: Keep `setModelTier` mutating process.env AND updating an authEnv if provided. Add an optional `authEnv?: AuthEnv` parameter. When called from AuthManager flow (switchActiveProvider), authEnv is provided. When called from RPC handler, we also need the authEnv.

   **Simplest viable approach**: SdkAgentAdapter holds a mutable `AuthEnv` field. Expose `getAuthEnv(): AuthEnv` and `patchAuthEnv(patch: Partial<AuthEnv>): void`. ProviderModelsService gets an optional authEnv parameter on `setModelTier`, `clearModelTier`, `switchActiveProvider`, `applyPersistedTiers`, `clearAllTierEnvVars`. When authEnv is provided, it writes there. When not provided, it falls back to being a no-op on env (the config persistence still works).

   Actually, let me re-read the task requirements: "Zero behavior change." The setModelTier RPC is called when users change tier in the settings UI. Currently it mutates process.env. If we remove that mutation, the next SDK query (which currently reads from process.env) would still work because SdkQueryOptionsBuilder passes `env: process.env` which includes the mutation. If we change to `env: { ...process.env, ...authEnv }`, then the tier change needs to be in authEnv for it to take effect.

   **Decision**: SdkAgentAdapter stores `authEnv: AuthEnv`. After `configureAuthentication` returns, adapter stores the result env. For `setModelTier`/`clearModelTier` RPC calls, ProviderModelsService updates the stored AuthEnv. The cleanest way: ProviderModelsService gets a reference to the AuthEnv on SdkAgentAdapter.

   Actually, the cleanest pattern that avoids circular deps: **ProviderModelsService stores its own reference to the "current AuthEnv"**. AuthManager sets it after building. SdkQueryOptionsBuilder reads it.

   Let me simplify even further:

   **ProviderModelsService gets a `currentAuthEnv: AuthEnv | null` field**.

   - `setCurrentAuthEnv(env: AuthEnv)` -- called by AuthManager after building the env.
   - `getCurrentAuthEnv(): AuthEnv | null` -- called by SdkQueryOptionsBuilder.
   - `setModelTier` updates both config AND `currentAuthEnv` if set.
   - `clearModelTier` updates both config AND `currentAuthEnv` if set.
   - `switchActiveProvider` updates `currentAuthEnv` if passed.

   This keeps ProviderModelsService as the single owner of tier state (it already is), and avoids introducing new cross-service dependencies.

   **Wait** -- the AuthEnv includes BOTH auth vars (from AuthManager) AND tier vars (from ProviderModelsService). Having ProviderModelsService own the full AuthEnv would be wrong. AuthManager sets the auth vars, ProviderModelsService sets the tier vars.

   **Final clean design**:

   **SdkAgentAdapter** is the storage point. It holds `private authEnv: AuthEnv = {}`.

   - After `configureAuthentication()` returns, store the env: `this.authEnv = authResult.env`
   - Expose `getAuthEnv(): AuthEnv` (read by SdkQueryOptionsBuilder)
   - Expose `patchAuthEnv(patch: Partial<AuthEnv>): void` (called by ProviderModelsService for tier updates)

   **ProviderModelsService** needs a way to call `patchAuthEnv`. Since ProviderModelsService is injected INTO AuthManager (which is injected into SdkAgentAdapter), we can't inject SdkAgentAdapter into ProviderModelsService (circular). Solution: **callback pattern**.

   When SdkAgentAdapter initializes, it sets a callback on ProviderModelsService:

   ```typescript
   this.providerModels.setAuthEnvPatcher((patch) => {
     Object.assign(this.authEnv, patch);
   });
   ```

   ProviderModelsService calls this patcher in `setModelTier` and `clearModelTier`.

   **Actually, even simpler**: Just inject the AuthEnv via DI token. Register an `AuthEnv` object as a singleton, and everyone reads/writes the same object reference.

   ```typescript
   // In DI registration:
   const authEnv: AuthEnv = {};
   container.registerInstance(SDK_TOKENS.SDK_AUTH_ENV, authEnv);
   ```

   Then AuthManager, ProviderModelsService, and SdkQueryOptionsBuilder all inject the same object. Mutations to it are visible everywhere. This is the simplest pattern and matches how DI containers work with shared state.

   **This is the chosen approach.** A shared mutable AuthEnv singleton registered in DI.

---

### Revised Architecture (Singleton AuthEnv via DI)

```
DI Container
  └── SDK_AUTH_ENV (AuthEnv singleton object)
        ├── Written by: AuthManager.configureAuthentication()
        ├── Written by: ProviderModelsService.setModelTier() / clearModelTier() / switchActiveProvider()
        ├── Read by:    SdkQueryOptionsBuilder.build()     → { ...process.env, ...authEnv }
        ├── Read by:    getActiveProviderId(authEnv)        → authEnv.ANTHROPIC_BASE_URL
        ├── Read by:    buildModelIdentityPrompt(authEnv)   → authEnv.ANTHROPIC_DEFAULT_*_MODEL
        └── Read by:    resolveActualModelForPricing(modelId, authEnv?) → authEnv.ANTHROPIC_BASE_URL + tiers
```

---

#### Component 2 (Revised): AuthManager Changes

**File**: `libs/backend/agent-sdk/src/lib/helpers/auth-manager.ts` (MODIFY)

**Changes**:

1. **Inject AuthEnv singleton**:

   ```typescript
   import { AuthEnv } from '@ptah-extension/shared';
   // In constructor:
   @inject(SDK_TOKENS.SDK_AUTH_ENV) private authEnv: AuthEnv,
   ```

2. **Replace all `process.env[key] = value` with `this.authEnv[key] = value`** (6 mutations).

3. **Keep `clearAllAuthEnvVars()`** but change it to clear from `this.authEnv` instead of `process.env`:

   ```typescript
   private clearAllAuthEnvVars(): void {
     for (const varName of AUTH_ENV_VARS) {
       delete this.authEnv[varName as keyof AuthEnv];
     }
   }
   ```

4. **Return type changes**: `configureAuthentication` still returns `Promise<AuthResult>`. No signature change needed since the AuthEnv is populated via the shared singleton. However, to match the user's stated design ("AuthManager should return `AuthResult & { env: AuthEnv }`"), we CAN return the env too for explicitness:

   ```typescript
   async configureAuthentication(rawAuthMethod: string): Promise<AuthResult & { env: AuthEnv }>
   ```

   The caller (SdkAgentAdapter) can use the returned env if needed, but the singleton is already populated.

5. **`logEnvSummary()`**: Read from `this.authEnv` instead of `process.env`.

6. **`clearAuthentication()`**: Clears the AuthEnv singleton (sets all keys to undefined). Also calls `this.providerModels.clearAllTierEnvVars()` which will clear tier keys from the same singleton.

7. **`captureEnvSnapshot()`**: Still reads from `process.env` -- this captures shell-provided values BEFORE the clean slate. This is correct behavior since shell env vars come from process.env, not from our AuthEnv.

---

#### Component 3 (Revised): ProviderModelsService Changes

**File**: `libs/backend/agent-sdk/src/lib/provider-models.service.ts` (MODIFY)

**Changes**:

1. **Inject AuthEnv singleton**:

   ```typescript
   import { AuthEnv } from '@ptah-extension/shared';
   // In constructor:
   @inject(SDK_TOKENS.SDK_AUTH_ENV) private authEnv: AuthEnv,
   ```

2. **`setModelTier`**: Replace `process.env[envVar] = modelId` with `this.authEnv[envVar as keyof AuthEnv] = modelId`. Config persistence stays.

3. **`clearModelTier`**: Replace `delete process.env[envVar]` with `delete this.authEnv[envVar as keyof AuthEnv]`. Config clear stays.

4. **`applyPersistedTiers`**: Replace `process.env[TIER_ENV_VARS.*] = tiers.*` with `this.authEnv[TIER_ENV_VARS.* as keyof AuthEnv] = tiers.*`.

5. **`clearAllTierEnvVars`**: Replace `delete process.env[TIER_ENV_VARS.*]` with `delete this.authEnv.ANTHROPIC_DEFAULT_SONNET_MODEL` etc.

6. **`switchActiveProvider`**: No signature change needed. It calls `clearAllTierEnvVars()` and `applyPersistedTiers()` which now operate on `this.authEnv`.

---

#### Component 4: SdkQueryOptionsBuilder - Merge AuthEnv with process.env

**File**: `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts` (MODIFY)

**Changes**:

1. **Inject AuthEnv singleton**:

   ```typescript
   import { AuthEnv } from '@ptah-extension/shared';
   // In constructor:
   @inject(SDK_TOKENS.SDK_AUTH_ENV) private readonly authEnv: AuthEnv,
   ```

2. **Replace `env: process.env as Record<string, string | undefined>`** (line 358) with:

   ```typescript
   env: { ...process.env, ...this.authEnv } as Record<string, string | undefined>,
   ```

   This is the key merge point. AuthEnv vars override process.env.

3. **`getActiveProviderId()`**: Change from module-private reading process.env to reading the injected AuthEnv:

   ```typescript
   function getActiveProviderId(authEnv: AuthEnv): string | null {
     const baseUrl = authEnv.ANTHROPIC_BASE_URL;
     // ... rest unchanged
   }
   ```

   At the call site (line 413): `const activeProviderId = getActiveProviderId(this.authEnv);`

   Since it's a module-private function, we can also make it a private method on the class, or pass authEnv as parameter. Passing as parameter is cleanest for a pure function.

4. **`buildModelIdentityPrompt()`**: Change to accept AuthEnv:

   ```typescript
   function buildModelIdentityPrompt(providerId: string | null, authEnv: AuthEnv): string | undefined {
     // ...
     const actualModel = authEnv.ANTHROPIC_DEFAULT_OPUS_MODEL || authEnv.ANTHROPIC_DEFAULT_SONNET_MODEL || authEnv.ANTHROPIC_DEFAULT_HAIKU_MODEL;
     // ...
   }
   ```

   At the call site (line 414): `const identityPrompt = buildModelIdentityPrompt(activeProviderId, this.authEnv);`

5. **Debug logging** (lines 288-293): Read tier/baseUrl from `this.authEnv` instead of `process.env`.

---

#### Component 5: resolveActualModelForPricing - Accept Optional env Parameter

**File**: `libs/backend/agent-sdk/src/lib/helpers/anthropic-provider-registry.ts` (MODIFY)

**Changes**:

1. **Import AuthEnv** from `@ptah-extension/shared`

2. **Add optional `authEnv` parameter**:

   ```typescript
   export function resolveActualModelForPricing(modelId: string, authEnv?: AuthEnv): string {
     if (!modelId) return modelId;

     const baseUrl = authEnv?.ANTHROPIC_BASE_URL ?? process.env['ANTHROPIC_BASE_URL'];

     if (!baseUrl || baseUrl.includes('api.anthropic.com')) {
       return modelId;
     }

     const lower = modelId.toLowerCase();
     if (lower.includes('opus')) {
       const override = authEnv?.ANTHROPIC_DEFAULT_OPUS_MODEL ?? process.env['ANTHROPIC_DEFAULT_OPUS_MODEL'];
       if (override) return override;
     } else if (lower.includes('sonnet')) {
       const override = authEnv?.ANTHROPIC_DEFAULT_SONNET_MODEL ?? process.env['ANTHROPIC_DEFAULT_SONNET_MODEL'];
       if (override) return override;
     } else if (lower.includes('haiku')) {
       const override = authEnv?.ANTHROPIC_DEFAULT_HAIKU_MODEL ?? process.env['ANTHROPIC_DEFAULT_HAIKU_MODEL'];
       if (override) return override;
     }

     return modelId;
   }
   ```

   The fallback to `process.env` preserves zero behavior change for callers that don't pass authEnv yet (history replay paths).

**Callers to update** (pass authEnv where available):

- `stream-transformer.ts` (lines 281, 335): StreamTransformer is injected with DI. Inject AuthEnv singleton, pass to `resolveActualModelForPricing(model, this.authEnv)`.
- `sdk-message-transformer.ts` (line 802): SdkMessageTransformer is injected. Inject AuthEnv singleton, pass to resolveActualModelForPricing.
- `session-history-reader.service.ts` (line 340): SessionHistoryReaderService is injected. Inject AuthEnv singleton, pass to resolveActualModelForPricing.
- `session-replay.service.ts` (lines 248, 553): SessionReplayService is injected. Inject AuthEnv singleton, pass to resolveActualModelForPricing.

---

#### Component 6: DI Token and Registration

**File**: `libs/backend/agent-sdk/src/lib/di/tokens.ts` (MODIFY)

**Changes**: Add token:

```typescript
/** Shared mutable AuthEnv singleton (TASK_2025_164) */
SDK_AUTH_ENV: 'SdkAuthEnv',
```

**File**: `libs/backend/agent-sdk/src/lib/di/register.ts` (MODIFY)

**Changes**: Register singleton instance:

```typescript
import { createEmptyAuthEnv } from '@ptah-extension/shared';

// Register shared AuthEnv singleton
container.registerInstance(SDK_TOKENS.SDK_AUTH_ENV, createEmptyAuthEnv());
```

---

#### Component 7: SdkAgentAdapter - Store AuthEnv from configureAuthentication

**File**: `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts` (MODIFY)

**Changes**:

1. In `initialize()`, capture the returned env (optional, since the singleton is already populated):

   ```typescript
   const authResult = await this.authManager.configureAuthentication(authMethod);
   // authResult.env is now available but the singleton is already populated
   ```

   No actual change needed here since the DI singleton is the shared state.

2. `dispose()`: `clearAuthentication()` already clears the singleton via AuthManager.

3. No new fields needed on SdkAgentAdapter. The AuthEnv singleton is managed by AuthManager and ProviderModelsService.

---

## Files Affected Summary

### CREATE (1 file)

| File                                          | Purpose                                          |
| --------------------------------------------- | ------------------------------------------------ |
| `libs/shared/src/lib/types/auth-env.types.ts` | AuthEnv interface and createEmptyAuthEnv factory |

### MODIFY (10 files)

| File                                                                       | Changes                                                                  |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `libs/shared/src/index.ts`                                                 | Add export for auth-env.types                                            |
| `libs/backend/agent-sdk/src/lib/di/tokens.ts`                              | Add SDK_AUTH_ENV token                                                   |
| `libs/backend/agent-sdk/src/lib/di/register.ts`                            | Register AuthEnv singleton                                               |
| `libs/backend/agent-sdk/src/lib/helpers/auth-manager.ts`                   | Inject AuthEnv, write to it instead of process.env, return env in result |
| `libs/backend/agent-sdk/src/lib/provider-models.service.ts`                | Inject AuthEnv, write tier vars to it instead of process.env             |
| `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts`      | Inject AuthEnv, merge with process.env for SDK, pass to helper functions |
| `libs/backend/agent-sdk/src/lib/helpers/anthropic-provider-registry.ts`    | Add optional authEnv param to resolveActualModelForPricing               |
| `libs/backend/agent-sdk/src/lib/helpers/stream-transformer.ts`             | Inject AuthEnv, pass to resolveActualModelForPricing                     |
| `libs/backend/agent-sdk/src/lib/sdk-message-transformer.ts`                | Inject AuthEnv, pass to resolveActualModelForPricing                     |
| `libs/backend/agent-sdk/src/lib/helpers/history/session-replay.service.ts` | Inject AuthEnv, pass to resolveActualModelForPricing                     |

### POSSIBLY MODIFY (1 file - only if session-history-reader calls resolveActualModelForPricing directly)

| File                                                               | Changes                                              |
| ------------------------------------------------------------------ | ---------------------------------------------------- |
| `libs/backend/agent-sdk/src/lib/session-history-reader.service.ts` | Inject AuthEnv, pass to resolveActualModelForPricing |

---

## Integration Architecture

### Data Flow

```
Extension Activation
  └── DI Container creates AuthEnv singleton {}
       │
SdkAgentAdapter.initialize()
  └── AuthManager.configureAuthentication()
       ├── captureEnvSnapshot()        ← reads process.env (shell vars)
       ├── clearAllAuthEnvVars()       ← clears authEnv singleton
       ├── providerModels.clearAllTierEnvVars() ← clears authEnv tier keys
       ├── configureAnthropicProvider()
       │    ├── authEnv.ANTHROPIC_BASE_URL = baseUrl
       │    ├── authEnv.ANTHROPIC_AUTH_TOKEN = key
       │    └── providerModels.switchActiveProvider()
       │         ├── clearAllTierEnvVars() ← clears authEnv tier keys
       │         └── applyPersistedTiers() ← authEnv.ANTHROPIC_DEFAULT_*_MODEL = ...
       ├── OR configureOAuthToken()
       │    └── authEnv.CLAUDE_CODE_OAUTH_TOKEN = token
       ├── OR configureAPIKey()
       │    └── authEnv.ANTHROPIC_API_KEY = key
       └── returns { configured, details, env: authEnv }

SDK Query Execution (per chat session)
  └── SdkQueryOptionsBuilder.build()
       ├── env: { ...process.env, ...authEnv }  ← merged env passed to SDK
       ├── getActiveProviderId(authEnv)           ← reads ANTHROPIC_BASE_URL from authEnv
       └── buildModelIdentityPrompt(id, authEnv)  ← reads tier vars from authEnv

Runtime Tier Changes (user changes model tier in settings)
  └── ProviderRpcHandlers → providerModels.setModelTier()
       ├── persists to config
       └── authEnv.ANTHROPIC_DEFAULT_*_MODEL = modelId  ← updates singleton

Cost Calculation (during streaming / history replay)
  └── resolveActualModelForPricing(model, authEnv)
       ├── reads ANTHROPIC_BASE_URL from authEnv (or process.env fallback)
       └── reads tier vars from authEnv (or process.env fallback)
```

### Key Design Properties

1. **Single source of truth**: The AuthEnv DI singleton holds all 7 auth/tier env vars
2. **Merge pattern**: `{ ...process.env, ...authEnv }` -- authEnv overrides process.env
3. **No process.env pollution**: Extension's process.env is never mutated (except for the shell-provided vars that were already there)
4. **Zero behavior change**: SDK receives the same env vars via the merge. Cost calculation works via authEnv parameter or process.env fallback
5. **Future Task B ready**: Custom Agent Adapter can create its own AuthEnv instance with different provider config

---

## Quality Requirements

### Functional Requirements

- All SDK queries receive the same env vars they do today (via the merge)
- Tier changes via RPC are reflected in subsequent SDK queries
- Auth configuration produces the same auth state as before
- Cost calculation returns the same values as before
- History replay works identically

### Non-Functional Requirements

- No new dependencies added (AuthEnv is a plain object, no class)
- No performance impact (object spread is negligible)
- Type safety: AuthEnv keys are typed string literals

### Verification

- `nx run agent-sdk:typecheck` passes
- `nx run shared:typecheck` passes
- `npm run typecheck:all` passes
- `npm run lint:all` passes

---

## Team-Leader Handoff

### Developer Type Recommendation

**Recommended Developer**: backend-developer

**Rationale**:

- All changes are in backend libraries (agent-sdk, shared)
- DI container changes require understanding of tsyringe
- No frontend/UI changes
- No Angular components affected

### Complexity Assessment

**Complexity**: MEDIUM
**Estimated Effort**: 3-4 hours

**Breakdown**:

- AuthEnv type + shared export: 15 min
- DI token + registration: 15 min
- AuthManager refactor (6 mutations): 45 min
- ProviderModelsService refactor (2 mutations + methods): 30 min
- SdkQueryOptionsBuilder refactor (merge + helper fns): 30 min
- resolveActualModelForPricing + callers: 30 min
- Typecheck + lint + verification: 30 min

### Critical Verification Points

**Before implementation, verify**:

1. **AuthEnv type keys match exactly**:

   - `AUTH_ENV_VARS` in auth-manager.ts (4 keys): ANTHROPIC_API_KEY, ANTHROPIC_BASE_URL, ANTHROPIC_AUTH_TOKEN, CLAUDE_CODE_OAUTH_TOKEN
   - `TIER_ENV_VARS` in provider-models.service.ts (3 keys): ANTHROPIC_DEFAULT_SONNET_MODEL, ANTHROPIC_DEFAULT_OPUS_MODEL, ANTHROPIC_DEFAULT_HAIKU_MODEL

2. **DI registration order**: AuthEnv instance must be registered BEFORE AuthManager and ProviderModelsService resolve

3. **No circular dependency**: AuthEnv is a plain object instance, not a class with dependencies. Safe to inject everywhere.

4. **resolveActualModelForPricing fallback**: The `?? process.env[...]` fallback ensures history replay (which doesn't easily pass authEnv) still works

### Architecture Delivery Checklist

- [x] All components specified with evidence
- [x] All patterns verified from codebase (DI singleton pattern, tsyringe registerInstance)
- [x] All imports/decorators verified as existing (@inject, injectable, registerInstance)
- [x] Quality requirements defined
- [x] Integration points documented (data flow diagram)
- [x] Files affected list complete (1 CREATE + 10 MODIFY)
- [x] Developer type recommended (backend-developer)
- [x] Complexity assessed (MEDIUM, 3-4 hours)
- [x] No step-by-step implementation (team-leader decomposes)
