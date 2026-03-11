# TASK_2025_133 - Settings/Auth Provider Architecture Refactoring Tasks

**Total Tasks**: 10 | **Batches**: 5 | **Status**: 5/5 complete

---

## Plan Validation Summary

**Validation Status**: PASSED

### Assumptions Verified

- `AuthGetAuthStatusParams.providerId` exists (rpc.types.ts:432-434) and backend uses it (auth-rpc.handlers.ts:117): VERIFIED
- `AuthGetAuthStatusResponse` returns `hasOAuthToken`, `hasApiKey`, `hasOpenRouterKey`, `authMethod`, `anthropicProviderId`, `availableProviders`: VERIFIED
- `AuthSaveSettingsParams` accepts `anthropicProviderId` for per-provider routing: VERIFIED
- `ModelStateService` pattern (private `_signal` + public `.asReadonly()`) confirmed at model-state.service.ts:47-239: VERIFIED
- `ClaudeRpcService.call()` returns `RpcResult<T>` with `.isSuccess()` guard: VERIFIED
- `AnthropicProviderInfo` type exists in shared (rpc.types.ts:446): VERIFIED
- `deleteOpenRouterKey()` does NOT send `anthropicProviderId`, confirming Critical Issue #1: VERIFIED
- Single `searchQuery` signal shared across all tiers in `ProviderModelSelectorComponent`: VERIFIED
- Backend `auth:testConnection` has hardcoded 1-second `setTimeout` (auth-rpc.handlers.ts:294): VERIFIED

### Risks Identified

| Risk                                                                      | Severity | Mitigation                                                                  |
| ------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------- |
| Rapid provider switching may cause stale `checkProviderKeyStatus` results | MEDIUM   | Batch 4 adds AbortController pattern to cancel in-flight requests           |
| `_providerKeyMap` starts empty, badges may flash on initial load          | LOW      | `loadAuthStatus()` populates the map for the default provider on first call |
| Removing `authStatusChanged` output may break parent-child contract       | LOW      | Keep output temporarily, emit after service refresh; clean up in Batch 3    |

### Edge Cases to Handle

- [x] User switches provider before `checkProviderKeyStatus` completes -> handled by AbortController in Batch 4
- [x] Double-click on Save & Test -> handled by `isSaving` guard in Batch 3
- [x] Delete targets wrong provider -> fixed by explicit `providerId` param in Batch 3
- [x] `showProviderModels` visible for OAuth users -> fixed by authMethod check in Batch 2

---

## Batch 1: Create AuthStateService (Foundation) -- COMPLETE

**Developer**: frontend-developer
**Status**: COMPLETE
**Tasks**: 3 | **Dependencies**: None

### T1: Create AuthStateService with all signals, computed properties, and methods

**Status**: COMPLETE
**File**: `D:\projects\ptah-extension\libs\frontend\core\src\lib\services\auth-state.service.ts`
**Action**: CREATE
**Spec Reference**: implementation-plan.md: AuthStateService Design section (lines 129-237)
**Pattern to Follow**: `D:\projects\ptah-extension\libs\frontend\core\src\lib\services\model-state.service.ts` (lines 47-239)

**Quality Requirements**:

- Follow the exact same pattern as `ModelStateService`: `@Injectable({ providedIn: 'root' })`, private mutable signals with `_` prefix, public `.asReadonly()` signals
- Use `inject()` function (not constructor injection) for Angular DI
- Import `ClaudeRpcService` and `ModelStateService` from relative paths (same directory)
- Import shared types from `@ptah-extension/shared`: `AuthGetAuthStatusResponse`, `AuthSaveSettingsParams`, `AnthropicProviderInfo`

**Implementation Details**:

**Private mutable signals**:

- `_hasOAuthToken = signal(false)`
- `_hasApiKey = signal(false)`
- `_providerKeyMap = signal<Map<string, boolean>>(new Map())` -- tracks per-provider key existence
- `_authMethod = signal<'oauth' | 'apiKey' | 'openrouter' | 'auto'>('auto')`
- `_selectedProviderId = signal('openrouter')`
- `_availableProviders = signal<AnthropicProviderInfo[]>([])`
- `_isLoading = signal(true)`
- `_isSaving = signal(false)`
- `_connectionStatus = signal<'idle' | 'saving' | 'testing' | 'success' | 'error'>('idle')`
- `_errorMessage = signal('')`
- `_successMessage = signal('')`

**Public readonly signals**: Each private signal exposed via `.asReadonly()`

**Computed signals**:

- `hasProviderKey`: reads `_providerKeyMap` and `_selectedProviderId`, returns `map.get(id) ?? false`
- `hasAnyCredential`: `_hasOAuthToken() || _hasApiKey() || hasProviderKey()`
- `showProviderModels`: `(method === 'openrouter' || method === 'auto') && hasProviderKey()`
- `selectedProvider`: finds provider in `_availableProviders()` by `_selectedProviderId()`

**Methods**:

- `hasKeyForProvider(providerId: string): boolean` -- synchronous lookup in `_providerKeyMap`
- `async loadAuthStatus(): Promise<void>` -- calls `auth:getAuthStatus` with `{}`, populates all signals from response, updates `_providerKeyMap` for the current provider. Has `_isLoaded` guard so it only fetches once unless `refreshAuthStatus()` is called.
- `async refreshAuthStatus(): Promise<void>` -- always re-fetches, same as `loadAuthStatus` but bypasses guard
- `async checkProviderKeyStatus(providerId: string): Promise<boolean>` -- calls `auth:getAuthStatus` with `{ providerId }`, updates `_providerKeyMap` entry for that provider, returns boolean
- `setAuthMethod(method)` -- sets `_authMethod`, resets status messages
- `setSelectedProviderId(providerId)` -- sets `_selectedProviderId`, resets status messages
- `async saveAndTest(params: AuthSaveSettingsParams): Promise<void>` -- guarded by `_isSaving`, calls `auth:saveSettings` then `auth:testConnection`, updates `_connectionStatus`, `_errorMessage`, `_successMessage`, calls `refreshAuthStatus()` on success, calls `modelState.refreshModels()` on success
- `async deleteOAuthToken(): Promise<void>` -- calls `auth:saveSettings` with `claudeOAuthToken: ''`, refreshes status
- `async deleteApiKey(): Promise<void>` -- calls `auth:saveSettings` with `anthropicApiKey: ''`, refreshes status
- `async deleteProviderKey(providerId: string): Promise<void>` -- calls `auth:saveSettings` with `openrouterApiKey: ''` AND `anthropicProviderId: providerId`, refreshes status
- `clearStatus(): void` -- resets `_connectionStatus` to 'idle', clears messages

**Key import lines**:

```typescript
import { Injectable, signal, computed, inject } from '@angular/core';
import { ClaudeRpcService, RpcResult } from './claude-rpc.service';
import { ModelStateService } from './model-state.service';
import type { AuthGetAuthStatusResponse, AuthSaveSettingsParams, AnthropicProviderInfo } from '@ptah-extension/shared';
```

---

### T2: Export AuthStateService from services barrel

**Status**: COMPLETE
**File**: `D:\projects\ptah-extension\libs\frontend\core\src\lib\services\index.ts`
**Action**: MODIFY
**Dependencies**: T1

**Implementation Details**:

- Add export after the ModelStateService exports (around line 24):

```typescript
export { AuthStateService } from './auth-state.service';
```

---

### T3: Verify export reaches library barrel

**Status**: COMPLETE
**File**: `D:\projects\ptah-extension\libs\frontend\core\src\index.ts`
**Action**: VERIFY (no change needed)
**Dependencies**: T2

**Implementation Details**:

- The library barrel at `libs/frontend/core/src/index.ts` already has `export * from './lib/services';` (line 2)
- This wildcard re-export means `AuthStateService` will automatically be available from `@ptah-extension/core`
- Simply verify this file still contains `export * from './lib/services';` -- NO code changes required

---

**Batch 1 Verification**:

- [x] All files exist at specified paths
- [x] `npx nx typecheck core` passes
- [x] `AuthStateService` is importable from `@ptah-extension/core`
- [x] Service follows ModelStateService pattern exactly (private signals, readonly, computed)
- [x] All RPC calls use the correct method names: `auth:getAuthStatus`, `auth:saveSettings`, `auth:testConnection`

---

## Batch 2: Refactor SettingsComponent + UI Reorganization -- COMPLETE

**Developer**: frontend-developer
**Status**: COMPLETE
**Tasks**: 2 | **Dependencies**: Batch 1

### T4: Remove local auth signals from SettingsComponent, inject AuthStateService

**Status**: COMPLETE
**File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\settings\settings.component.ts`
**Action**: MODIFY
**Spec Reference**: implementation-plan.md: SettingsComponent Changes (lines 242-258)
**Pattern to Follow**: Read signals from injected service instead of local signals

**Implementation Details**:

**DELETE these signals** (lines 75-81):

- `hasOAuthToken = signal(false)`
- `hasApiKey = signal(false)`
- `hasOpenRouterKey = signal(false)`
- `isLoadingAuthStatus = signal(true)`
- `selectedProviderId = signal('openrouter')`

**DELETE these methods**:

- `fetchAuthStatus()` (lines 254-273)
- `refreshAuthStatus()` (lines 220-222)

**ADD**:

- `readonly authState = inject(AuthStateService);` -- import from `@ptah-extension/core`
- Add `AuthStateService` to the imports in the existing import statement from `@ptah-extension/core` (line 23)

**CHANGE computed signals**:

- `hasAnyCredential` -> `readonly hasAnyCredential = this.authState.hasAnyCredential;`
- `showProviderModels` -> `readonly showProviderModels = this.authState.showProviderModels;`
- `isAuthenticated` -> change to `computed(() => !this.authState.isLoading() && this.authState.hasAnyCredential())`

**CHANGE ngOnInit**:

- Replace `this.fetchAuthStatus()` with `this.authState.loadAuthStatus()` in the `Promise.all` call
- Keep `this.fetchLicenseStatus()` as-is

**ADD handler for authStatusChanged**:

- `onAuthStatusChanged(): void { /* no-op -- service auto-refreshes */ }` -- OR simply remove the event binding in the template (Batch 2 T5)

**KEEP**: All license-related signals and methods unchanged (isPremium, licenseTier, fetchLicenseStatus, etc.)

---

### T5: Reorganize settings template -- merge Authentication + Provider Model Mapping

**Status**: COMPLETE
**File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\settings\settings.component.html`
**Action**: MODIFY
**Spec Reference**: implementation-plan.md: UI Layout diagram (lines 106-124)
**Dependencies**: T4

**Implementation Details**:

1. **Update Authentication section** (around line 189-203):

   - Remove `(authStatusChanged)="refreshAuthStatus()"` from `<ptah-auth-config>` tag (line 201). Either remove the event binding entirely or change to no-op handler from T4.
   - After `<ptah-auth-config />`, add a conditional divider and `<ptah-provider-model-selector>` INSIDE the same card:

   ```html
   <ptah-auth-config />

   <!-- Provider Model Mapping - shown when provider auth + key configured -->
   @if (showProviderModels()) {
   <div class="divider my-2 text-[10px] opacity-50">Provider Model Mapping</div>
   <p class="text-xs text-base-content/70 mb-3">Override default Anthropic model aliases with models from your provider.</p>
   <ptah-provider-model-selector [providerId]="authState.selectedProviderId()" />
   }
   ```

2. **REMOVE the standalone Provider Model Mapping section** (lines 226-243):

   - Delete the entire `@if (showProviderModels()) { ... }` block that wraps the info-styled card with `border-info/30`
   - This section is now inside the Authentication card above

3. **Update `isLoadingAuthStatus()` reference** (line 263):
   - Change `} @else if (!isLoadingAuthStatus()) {` to `} @else if (!authState.isLoading()) {`

**KEEP**: All other sections (License Status, Model Selection, Autopilot, Premium) unchanged.

---

**Batch 2 Verification**:

- [x] All files exist at specified paths
- [x] `npx nx typecheck chat` passes
- [x] Template compiles without errors
- [x] `showProviderModels` now correctly hides model mapping for OAuth/API Key auth methods
- [x] Provider model selector appears inside the Authentication card (not standalone)
- [x] `selectedProviderId` reads from `authState.selectedProviderId()` in template

---

## Batch 3: Refactor AuthConfigComponent to Use AuthStateService -- COMPLETE

**Developer**: frontend-developer
**Status**: COMPLETE
**Tasks**: 2 | **Dependencies**: Batch 2

### T6: Remove local auth state signals from AuthConfigComponent, delegate to AuthStateService

**Status**: COMPLETE
**File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\settings\auth-config.component.ts`
**Action**: MODIFY
**Spec Reference**: implementation-plan.md: AuthConfigComponent Changes (lines 262-280)
**Pattern to Follow**: Components read from service, keep only form-local state

**Implementation Details**:

**ADD**:

- Import `AuthStateService` from `@ptah-extension/core` (add to the existing import line 22-23)
- `private readonly authState = inject(AuthStateService);`

**DELETE these signals** (they now come from AuthStateService):

- `authMethod` signal (line 77-79) -- read from `authState.authMethod()`
- `selectedProviderId` signal (line 86)
- `availableProviders` signal (line 87)
- `hasExistingOAuthToken` signal (line 90)
- `hasExistingApiKey` signal (line 91)
- `hasExistingOpenRouterKey` signal (line 93)
- `isLoadingStatus` signal (line 94)
- `connectionStatus` signal (lines 109-112)
- `errorMessage` signal (line 112)
- `successMessage` signal (line 113)

**KEEP these local form signals**:

- `oauthToken` (line 80)
- `apiKey` (line 81)
- `openrouterKey` (line 83) -- rename to `providerKey` for clarity
- `isReplacingOAuth` (line 97)
- `isReplacingApiKey` (line 98)
- `isReplacingProviderKey` (line 99)

**KEEP**: `authStatusChanged` output -- still emit after successful save for backward compatibility, but parent no longer does separate fetch

**CHANGE `selectedProvider` computed** (line 118-121):

- `readonly selectedProvider = this.authState.selectedProvider;`

**CHANGE `canSaveAndTest` computed** (lines 128-156):

- Replace local signal reads with service reads:
  - `this.authMethod()` -> `this.authState.authMethod()`
  - `this.openrouterKey()` -> `this.providerKey()` (renamed local signal)
  - `this.hasExistingOAuthToken()` -> `this.authState.hasOAuthToken()`
  - `this.hasExistingApiKey()` -> `this.authState.hasApiKey()`
  - `this.hasExistingOpenRouterKey()` -> `this.authState.hasProviderKey()`

**CHANGE `ngOnInit`** (lines 161-174):

- Replace `this.fetchAuthStatus()` with `this.authState.loadAuthStatus()`

**DELETE `fetchAuthStatus` method** (lines 180-204) -- no longer needed

**CHANGE `saveAndTest` method** (lines 222-368):

- Add concurrent guard at top: `if (this.authState.isSaving()) { return; }`
- Replace all local `connectionStatus.set(...)` with `this.authState` -- BUT since `saveAndTest` is complex, delegate to `authState.saveAndTest(params)` instead
- Build params from local form inputs:
  ```typescript
  const params: AuthSaveSettingsParams = {
    authMethod: this.authState.authMethod(),
    claudeOAuthToken: this.oauthToken().trim() || undefined,
    anthropicApiKey: this.apiKey().trim() || undefined,
    openrouterApiKey: this.providerKey().trim() || undefined,
    anthropicProviderId: this.authState.selectedProviderId(),
  };
  await this.authState.saveAndTest(params);
  ```
- After successful save (check `authState.connectionStatus() === 'success'`):
  - Reset replace toggles
  - Emit `authStatusChanged`

**CHANGE `onAuthMethodChange` method** (lines 380-394):

- Call `this.authState.setAuthMethod(method)` instead of `this.authMethod.set(method)`
- Keep local form resets (isReplacingOAuth, etc.)
- Remove `this.connectionStatus.set('idle')` and `this.errorMessage.set('')` -- service handles these

**CHANGE `onProviderChange` method** (lines 406-423):

- Call `this.authState.setSelectedProviderId(providerId)` instead of `this.selectedProviderId.set(providerId)`
- Call `this.authState.checkProviderKeyStatus(providerId)` to update badge for new provider (fixes Critical Issue #4)
- Reset `this.providerKey.set('')` (renamed from openrouterKey)
- Remove `this.hasExistingOpenRouterKey.set(false)` -- service handles via `checkProviderKeyStatus`

**CHANGE `deleteOAuthToken` method** (lines 446-477):

- Delegate to `this.authState.deleteOAuthToken()`
- Reset local `this.oauthToken.set('')`
- Emit `authStatusChanged`

**CHANGE `deleteApiKey` method** (lines 482-513):

- Delegate to `this.authState.deleteApiKey()`
- Reset local `this.apiKey.set('')`
- Emit `authStatusChanged`

**CHANGE `deleteOpenRouterKey` method** (lines 518-557):

- Rename to `deleteProviderKey()`
- Delegate to `this.authState.deleteProviderKey(this.authState.selectedProviderId())` -- fixes Critical Issue #1 by using UI-selected provider
- Reset local `this.providerKey.set('')`
- Emit `authStatusChanged`

**REMOVE**: The `CONNECTION_TEST_TIMEOUT_MS` constant (line 67) -- service handles timeout

---

### T7: Update AuthConfigComponent template to use service signals and renamed fields

**Status**: COMPLETE
**File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\settings\auth-config.component.html`
**Action**: MODIFY
**Dependencies**: T6

**Implementation Details**:

**Rename all `openrouterKey` references to `providerKey`**:

- `[(ngModel)]="openrouterKey"` -> `[(ngModel)]="providerKey"` (multiple occurrences, lines 142, 152)
- `name="openrouterKey"` -> `name="providerKey"` (multiple occurrences)
- `id="openrouterKey"` -> `id="providerKey"` (multiple occurrences, lines 82, 140, 150)

**Replace local signal reads with service signal reads**:

- `authMethod()` -> `authState.authMethod()` (all occurrences in template)
- `selectedProviderId()` -> `authState.selectedProviderId()` (line 66 ngModel)
- `availableProviders()` -> `authState.availableProviders()` (line 59, 71)
- `hasExistingOAuthToken()` -> `authState.hasOAuthToken()` (lines 93, 195, 208)
- `hasExistingApiKey()` -> `authState.hasApiKey()` (lines 289, 302)
- `hasExistingOpenRouterKey()` -> `authState.hasProviderKey()` (lines 93, 106)
- `isLoadingStatus()` -> `authState.isLoading()` (lines 86, 188, 282)
- `connectionStatus()` -> `authState.connectionStatus()` (multiple occurrences: lines 126, 228, 380-394, 399, 416, 457)
- `errorMessage()` -> `authState.errorMessage()` (lines 416, 424, 428-431)
- `successMessage()` -> `authState.successMessage()` (lines 399, 402, 457, 460)

**Rename method calls**:

- `deleteOpenRouterKey()` -> `deleteProviderKey()` (line 125)

**Important**: The `authState` property must be public on the component (not private) since it's accessed in the template.

---

**Batch 3 Verification**:

- [x] All files exist at specified paths
- [x] `npx nx typecheck chat` passes
- [x] Save & Test has concurrent guard (double-click protection via `isSaving`)
- [x] Provider switch calls `checkProviderKeyStatus` for correct badge
- [x] Delete targets UI-selected provider (not persisted)
- [x] `openrouterKey` renamed to `providerKey` everywhere
- [x] No local auth state signals remain in AuthConfigComponent (only form inputs)

---

## Batch 4: Fix ProviderModelSelector Issues -- COMPLETE

**Developer**: frontend-developer
**Status**: COMPLETE
**Tasks**: 1 | **Dependencies**: Batch 3

### T8: Replace shared searchQuery with per-tier queries, add error feedback, add AbortController

**Status**: COMPLETE
**File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\settings\provider-model-selector.component.ts`
**Action**: MODIFY
**Spec Reference**: implementation-plan.md: ProviderModelSelectorComponent Changes (lines 286-293)

**Implementation Details**:

**Fix 1: Per-tier search queries** (fixes Serious Issue #8):

- REMOVE: `readonly searchQuery = signal('');` (line 265)
- ADD: `readonly searchQueries = signal<Record<ProviderModelTier, string>>({ sonnet: '', opus: '', haiku: '' });`
- ADD helper: `getSearchQuery(tier: ProviderModelTier): string { return this.searchQueries()[tier]; }`
- CHANGE `filteredModels` computed to accept active tier:
  ```typescript
  readonly filteredModels = computed(() => {
    const tier = this.activeTier();
    const query = tier ? this.searchQueries()[tier].toLowerCase().trim() : '';
    const models = this.availableModels();
    if (!query) return models.slice(0, 50);
    return models.filter(m =>
      m.name.toLowerCase().includes(query) || m.id.toLowerCase().includes(query)
    ).slice(0, 50);
  });
  ```
- CHANGE `onSearchInput`:
  ```typescript
  onSearchInput(query: string, tier: ProviderModelTier): void {
    this.searchQueries.update(prev => ({ ...prev, [tier]: query }));
    this.activeTier.set(tier);
    this.isDropdownOpen.set(true);
  }
  ```
- CHANGE `closeDropdown`: Only clear the active tier's query, not all:
  ```typescript
  closeDropdown(): void {
    const tier = this.activeTier();
    if (tier) {
      this.searchQueries.update(prev => ({ ...prev, [tier]: '' }));
    }
    this.isDropdownOpen.set(false);
    this.activeTier.set(null);
  }
  ```
- CHANGE template `[ngModel]="searchQuery()"` to `[ngModel]="getSearchQuery(tierConfig.tier)"`

**Fix 2: Error feedback for selectModel/clearTier** (fixes Serious Issue #9):

- ADD: `readonly tierError = signal<Record<ProviderModelTier, string | null>>({ sonnet: null, opus: null, haiku: null });`
- CHANGE `selectModel`: On failure, set error:
  ```typescript
  } else {
    this.tierError.update(prev => ({ ...prev, [tier]: result.error || 'Failed to set model' }));
  }
  ```
  On success, clear error: `this.tierError.update(prev => ({ ...prev, [tier]: null }));`
- CHANGE `clearTier`: Same pattern -- set error on failure, clear on success
- ADD to template: Below each tier's search input, show error if present:
  ```html
  @if (tierError()[tierConfig.tier]; as err) {
  <div class="text-xs text-error mt-1">{{ err }}</div>
  }
  ```

**Fix 3: AbortController for in-flight requests** (fixes Moderate Issue #13):

- ADD: `private loadAbortController: AbortController | null = null;`
- CHANGE `reloadForProvider`:

  ```typescript
  private async reloadForProvider(): Promise<void> {
    // Cancel any in-flight loads
    this.loadAbortController?.abort();
    this.loadAbortController = new AbortController();
    const signal = this.loadAbortController.signal;

    // Clear stale state
    this.availableModels.set([]);
    this.sonnetModel.set(null);
    this.opusModel.set(null);
    this.haikuModel.set(null);
    this.error.set(null);
    this.closeDropdown();

    await Promise.all([this.loadModels(signal), this.loadTierMappings(signal)]);
  }
  ```

- CHANGE `loadModels` to accept optional `AbortSignal`:
  ```typescript
  private async loadModels(abortSignal?: AbortSignal): Promise<void> {
    // ... existing logic ...
    // After RPC call, check if aborted:
    if (abortSignal?.aborted) return;
    // ... set state only if not aborted ...
  }
  ```
- CHANGE `loadTierMappings` similarly to accept and check `AbortSignal`

---

**Batch 4 Verification**:

- [x] `npx nx typecheck chat` passes
- [x] Each tier's search input is independent (typing in Sonnet does not filter Opus)
- [x] Error messages appear inline when `selectModel`/`clearTier` RPC fails
- [x] Rapid provider switching cancels in-flight model loads (no stale state)

---

## Batch 5: Backend Connection Test Fix + Cleanup -- COMPLETE

**Developer**: backend-developer
**Status**: COMPLETE
**Tasks**: 2 | **Dependencies**: Batch 4

### T9: Replace hardcoded delay with retry-poll in auth:testConnection

**Status**: COMPLETE
**File**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\auth-rpc.handlers.ts`
**Action**: MODIFY
**Spec Reference**: implementation-plan.md: Backend Changes (lines 295-303)

**Implementation Details**:

**CHANGE `registerTestConnection` method** (lines 285-315):

- Replace the hardcoded `setTimeout(resolve, 1000)` (line 294) with a retry-poll loop:

```typescript
private registerTestConnection(): void {
  this.rpcHandler.registerMethod<
    void,
    { success: boolean; health: unknown; errorMessage?: string }
  >('auth:testConnection', async () => {
    try {
      this.logger.debug('RPC: auth:testConnection called');

      // Retry-poll: check SDK health with exponential backoff
      // Delays: 200ms, 400ms, 800ms, 1600ms, 3200ms = ~6.2s total max
      const MAX_RETRIES = 5;
      const BASE_DELAY_MS = 200;

      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt);
        await new Promise((resolve) => setTimeout(resolve, delay));

        const health = this.sdkAdapter.getHealth();
        if (health.status === 'available') {
          const result = { success: true, health, errorMessage: undefined };
          this.logger.info('RPC: auth:testConnection completed', { result, attempt });
          return result;
        }

        this.logger.debug(`RPC: auth:testConnection attempt ${attempt + 1}/${MAX_RETRIES}`, {
          status: health.status,
          delay,
        });
      }

      // Exhausted retries -- return last health check
      const finalHealth = this.sdkAdapter.getHealth();
      const result = {
        success: finalHealth.status === 'available',
        health: finalHealth,
        errorMessage: finalHealth.errorMessage || 'Connection test timed out',
      };

      this.logger.info('RPC: auth:testConnection completed (exhausted retries)', { result });
      return result;
    } catch (error) {
      this.logger.error(
        'RPC: auth:testConnection failed',
        error instanceof Error ? error : new Error(String(error))
      );
      throw error;
    }
  });
}
```

**Key behavior changes**:

- First check at 200ms (instead of always 1000ms) -- faster success for quick init
- Up to 5 retries with exponential backoff totaling ~6.2 seconds
- Returns as soon as `status === 'available'` -- no unnecessary waiting
- If all retries exhausted, returns the final health status (not an error throw)

---

### T10: Remove deprecated OpenRouterModelSelectorComponent alias export

**Status**: COMPLETE
**File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\settings\index.ts`
**Action**: MODIFY

**Implementation Details**:

**DELETE** the deprecated alias (line 13-14):

```typescript
// @deprecated Use ProviderModelSelectorComponent instead
export { ProviderModelSelectorComponent as OpenRouterModelSelectorComponent } from './provider-model-selector.component';
```

**Keep** the direct export on line 11:

```typescript
export { ProviderModelSelectorComponent } from './provider-model-selector.component';
```

**Verification**: Search the codebase for `OpenRouterModelSelectorComponent` to confirm no other consumers exist before removing. Expected: only the `index.ts` file references this alias.

---

**Batch 5 Verification**:

- [x] `npx nx typecheck ptah-extension-vscode` passes
- [x] `npx nx typecheck chat` passes
- [x] No references to `OpenRouterModelSelectorComponent` remain (only task-tracking docs)
- [x] Connection test uses retry-poll pattern (no hardcoded 1-second delay)

---

## Issue-to-Task Mapping

| Issue # | Severity | Description                                   | Fixed In                                             |
| ------- | -------- | --------------------------------------------- | ---------------------------------------------------- |
| 1       | CRITICAL | Delete targets wrong provider                 | T6 (deleteProviderKey takes explicit ID)             |
| 2       | CRITICAL | Dual independent state                        | T1+T4+T6 (AuthStateService is single source)         |
| 3       | CRITICAL | showProviderModels ignores auth method        | T1+T5 (computed checks authMethod + hasProviderKey)  |
| 4       | CRITICAL | Provider switch blindly resets key badge      | T6 (checkProviderKeyStatus queries backend)          |
| 5       | SERIOUS  | Hardcoded 1-second delay                      | T9 (retry-poll pattern)                              |
| 6       | SERIOUS  | No concurrent guard on saveAndTest            | T6 (isSaving signal as guard)                        |
| 7       | SERIOUS  | Inner fetchAuthStatus catch silently degrades | T1 (service surfaces errors via errorMessage signal) |
| 8       | SERIOUS  | Shared searchQuery across tiers               | T8 (per-tier search queries)                         |
| 9       | SERIOUS  | No error feedback for selectModel/clearTier   | T8 (tierError signal)                                |
| 10      | MODERATE | Misleading signal names                       | T6+T7 (rename to providerKey)                        |
| 11      | MODERATE | SettingsComponent doesn't track authMethod    | T4+T5 (reads from authState.authMethod)              |
| 12      | MODERATE | No input validation for provider keys         | T6 (validate against keyPrefix)                      |
| 13      | MODERATE | Memory leak in effect                         | T8 (AbortController for in-flight requests)          |
