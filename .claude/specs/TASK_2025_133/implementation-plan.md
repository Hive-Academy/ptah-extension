# Implementation Plan - TASK_2025_133: Settings/Auth Provider Architecture Refactoring

## Codebase Investigation Summary

### Libraries Discovered

- **@ptah-extension/core** (`libs/frontend/core/`) -- Frontend service layer, signal-based state management
  - Key exports: `ClaudeRpcService`, `ModelStateService`, `AppStateManager` (services/index.ts)
  - Documentation: `libs/frontend/core/CLAUDE.md`
  - Pattern: `Injectable({ providedIn: 'root' })`, private `_signal` + public `.asReadonly()`
- **@ptah-extension/chat** (`libs/frontend/chat/`) -- Chat UI components including settings
  - Settings components: `auth-config.component.ts`, `settings.component.ts`, `provider-model-selector.component.ts`
  - Documentation: `libs/frontend/chat/CLAUDE.md`
- **@ptah-extension/shared** (`libs/shared/`) -- Type contracts
  - Auth types: `AuthGetAuthStatusParams`, `AuthGetAuthStatusResponse`, `AuthSaveSettingsParams`, `AnthropicProviderInfo`
  - Source: `libs/shared/src/lib/types/rpc.types.ts:395-484`
- **@ptah-extension/agent-sdk** (`libs/backend/agent-sdk/`) -- Provider registry
  - `ANTHROPIC_PROVIDERS` constant: 3 providers (OpenRouter, Moonshot, Z.AI)
  - Source: `libs/backend/agent-sdk/src/lib/helpers/anthropic-provider-registry.ts:71-148`

### Patterns Identified

**Service Pattern** (from `ModelStateService` at `libs/frontend/core/src/lib/services/model-state.service.ts`):

- Private mutable signals (`_currentModel = signal<string>('')`)
- Public readonly signals (`currentModel = this._currentModel.asReadonly()`)
- `@Injectable({ providedIn: 'root' })` decorator
- Injects `ClaudeRpcService` for backend communication
- Constructor calls initial load (`this.loadModels()`)
- Exposes `refreshModels()` for manual reload
- Source: `model-state.service.ts:47-239`

**Component-to-Service Pattern** (from `ChatStore` in `libs/frontend/chat/CLAUDE.md`):

- Components inject services and read readonly signals
- State updates flow through service methods
- Computed signals derive complex state

**RPC Pattern** (from `ClaudeRpcService` at `libs/frontend/core/src/lib/services/claude-rpc.service.ts`):

- `this.rpcService.call('auth:getAuthStatus', { providerId })` -- type-safe method, returns `RpcResult<T>`
- Result checked with `result.isSuccess()` and `result.data`
- Source: `claude-rpc.service.ts:167-230`

**Backend RPC Handler Pattern** (from `auth-rpc.handlers.ts`):

- `auth:getAuthStatus` already accepts `params.providerId` for per-provider key checking (line 117)
- `auth:saveSettings` already routes `openrouterApiKey` to `targetProviderId` slot (lines 244-259)
- Source: `apps/ptah-extension-vscode/src/services/rpc/handlers/auth-rpc.handlers.ts:92-158`

### Integration Points

- **RPC methods**: `auth:getAuthStatus`, `auth:saveSettings`, `auth:testConnection`
- **Backend already supports**: per-provider key queries via `AuthGetAuthStatusParams.providerId`
- **Service barrel export**: `libs/frontend/core/src/lib/services/index.ts` -- new service must be added here
- **Library barrel export**: `libs/frontend/core/src/index.ts` -- re-exports from services/index.ts

---

## Architecture Design (Codebase-Aligned)

### Design Philosophy

**Chosen Approach**: Extract a shared `AuthStateService` as single source of truth, following the exact same pattern as `ModelStateService`.

**Rationale**: The root cause of all 13 issues is **duplicated state ownership** -- `SettingsComponent` and `AuthConfigComponent` both independently call `auth:getAuthStatus`, store results in separate signals, and communicate only through a single `authStatusChanged` event. This causes drift, stale badges, and wrong-provider operations.

**Evidence**: `ModelStateService` (model-state.service.ts:47-239) successfully manages shared model state for multiple consumers using the private-signal/public-readonly pattern. The new `AuthStateService` follows this proven pattern exactly.

### Component Relationship Diagram

```
BEFORE (broken):
  SettingsComponent                AuthConfigComponent
     |-- fetches auth status          |-- fetches auth status (DUPLICATE)
     |-- stores hasOAuthToken         |-- stores hasExistingOAuthToken
     |-- stores hasApiKey             |-- stores hasExistingApiKey
     |-- stores hasOpenRouterKey      |-- stores hasExistingOpenRouterKey
     |-- stores selectedProviderId    |-- stores selectedProviderId
     |                                |
     +--- (authStatusChanged) --------+  (single event, no data)

AFTER (fixed):
  AuthStateService (providedIn: 'root')
     |-- Single RPC caller for auth:getAuthStatus
     |-- Single source of truth for all auth signals
     |-- Exposes readonly signals
     |-- Handles save, delete, test operations
     |-- Maintains per-provider key status map
     |
     +--- SettingsComponent (reads signals, no local auth state)
     |       |-- computed: showProviderModels checks authMethod + hasProviderKey
     |       |-- UI Layout: Unified "Provider Configuration" card groups both
     |       |   auth-config + model-selector together in one visual container
     |
     +--- AuthConfigComponent (reads signals, form state only)
     |       |-- Local form inputs (oauthToken, apiKey, providerKey)
     |       |-- Calls service methods for save/delete/test
     |       |-- Concurrent guard via service's isSaving signal
     |
     +--- ProviderModelSelectorComponent (reads providerId from service)
             |-- Per-tier searchQuery (no shared query)
             |-- Error feedback on selectModel/clearTier

UI LAYOUT (settings.component.html):
  ┌─────────────────────────────────────────┐
  │ Header + License Status Card            │
  ├─────────────────────────────────────────┤
  │ 🔐 Authentication                       │
  │   [Auth method tabs: Provider|OAuth|..]  │
  │   [Provider dropdown + key input]        │
  │   [OAuth/API key inputs]                 │
  │   [Save & Test button]                   │
  │   ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄ │
  │   🌐 Provider Model Mapping              │  ← MOVED INSIDE same card
  │   [Sonnet: ___] [Opus: ___] [Haiku: __] │  ← Only when provider auth + key
  └─────────────────────────────────────────┘
  ┌─────────────────────────────────────────┐
  │ 🤖 Model Selection                      │
  ├─────────────────────────────────────────┤
  │ 🚀 Autopilot Mode                       │
  ├─────────────────────────────────────────┤
  │ ✨ Pro Features (MCP, LLM Keys)         │
  └─────────────────────────────────────────┘
```

---

## AuthStateService Design

### Full Interface

```typescript
// libs/frontend/core/src/lib/services/auth-state.service.ts

@Injectable({ providedIn: 'root' })
export class AuthStateService {
  private readonly rpc = inject(ClaudeRpcService);
  private readonly modelState = inject(ModelStateService);

  // --- Private mutable signals ---
  private readonly _hasOAuthToken = signal(false);
  private readonly _hasApiKey = signal(false);
  private readonly _providerKeyMap = signal<Map<string, boolean>>(new Map());
  private readonly _authMethod = signal<'oauth' | 'apiKey' | 'openrouter' | 'auto'>('auto');
  private readonly _selectedProviderId = signal('openrouter');
  private readonly _availableProviders = signal<AnthropicProviderInfo[]>([]);
  private readonly _isLoading = signal(true);
  private readonly _isSaving = signal(false);
  private readonly _connectionStatus = signal<'idle' | 'saving' | 'testing' | 'success' | 'error'>('idle');
  private readonly _errorMessage = signal('');
  private readonly _successMessage = signal('');

  // --- Public readonly signals ---
  readonly hasOAuthToken = this._hasOAuthToken.asReadonly();
  readonly hasApiKey = this._hasApiKey.asReadonly();
  readonly authMethod = this._authMethod.asReadonly();
  readonly selectedProviderId = this._selectedProviderId.asReadonly();
  readonly availableProviders = this._availableProviders.asReadonly();
  readonly isLoading = this._isLoading.asReadonly();
  readonly isSaving = this._isSaving.asReadonly();
  readonly connectionStatus = this._connectionStatus.asReadonly();
  readonly errorMessage = this._errorMessage.asReadonly();
  readonly successMessage = this._successMessage.asReadonly();

  // --- Computed signals ---

  /** Whether the currently selected provider has a key configured */
  readonly hasProviderKey = computed(() => {
    const map = this._providerKeyMap();
    const id = this._selectedProviderId();
    return map.get(id) ?? false;
  });

  /** Whether any credential is configured (for SettingsComponent visibility) */
  readonly hasAnyCredential = computed(() => this._hasOAuthToken() || this._hasApiKey() || this.hasProviderKey());

  /** Whether provider model mapping should be shown:
   *  ONLY when authMethod is 'openrouter' or 'auto' AND the selected provider has a key */
  readonly showProviderModels = computed(() => {
    const method = this._authMethod();
    return (method === 'openrouter' || method === 'auto') && this.hasProviderKey();
  });

  /** Currently selected provider info object */
  readonly selectedProvider = computed(() => {
    const id = this._selectedProviderId();
    return this._availableProviders().find((p) => p.id === id) ?? null;
  });

  // --- Methods ---

  /** Check if a specific provider has a key (for badge display during switching) */
  hasKeyForProvider(providerId: string): boolean {
    return this._providerKeyMap().get(providerId) ?? false;
  }

  /** Initial load -- called once on first consumer mount */
  async loadAuthStatus(): Promise<void>;

  /** Refresh auth status from backend (re-fetches everything) */
  async refreshAuthStatus(): Promise<void>;

  /** Check key status for a specific provider without full refresh */
  async checkProviderKeyStatus(providerId: string): Promise<boolean>;

  /** Update local auth method (UI-only, not persisted until save) */
  setAuthMethod(method: 'oauth' | 'apiKey' | 'openrouter' | 'auto'): void;

  /** Update local selected provider (UI-only, not persisted until save) */
  setSelectedProviderId(providerId: string): void;

  /** Save settings and test connection (with concurrent guard) */
  async saveAndTest(params: AuthSaveSettingsParams): Promise<void>;

  /** Delete OAuth token */
  async deleteOAuthToken(): Promise<void>;

  /** Delete API key */
  async deleteApiKey(): Promise<void>;

  /** Delete provider key for the given provider ID */
  async deleteProviderKey(providerId: string): Promise<void>;

  /** Clear connection status messages */
  clearStatus(): void;
}
```

**Key design decisions**:

1. `_providerKeyMap` is `Map<string, boolean>` -- tracks per-provider key existence, populated lazily via `checkProviderKeyStatus()` and on full refresh.
2. `showProviderModels` computed checks **both** authMethod and key existence (fixes Critical Issue #3).
3. `deleteProviderKey(providerId)` takes explicit ID (fixes Critical Issue #1).
4. `_isSaving` signal used as concurrent guard for `saveAndTest` (fixes Serious Issue #6).
5. `checkProviderKeyStatus` calls `auth:getAuthStatus` with `{ providerId }` -- backend already supports this (auth-rpc.handlers.ts:117).

---

## Component Refactoring

### SettingsComponent Changes

**What changes**: Remove ALL local auth state signals and the private `fetchAuthStatus()` method. Read everything from `AuthStateService`.

**Why**: Eliminates dual independent state (Critical Issue #2) and ensures `showProviderModels` respects authMethod (Critical Issue #3).

**Specific changes**:

- DELETE signals: `hasOAuthToken`, `hasApiKey`, `hasOpenRouterKey`, `selectedProviderId`, `isLoadingAuthStatus`
- DELETE method: `fetchAuthStatus()`
- DELETE method: `refreshAuthStatus()` (no longer needed -- service handles it)
- ADD: `inject(AuthStateService)` and read all auth state from service
- CHANGE: `showProviderModels` computed now reads from `authState.showProviderModels`
- CHANGE: `hasAnyCredential` computed now reads from `authState.hasAnyCredential`
- CHANGE: `isAuthenticated` computed now reads from service signals
- CHANGE: Template `(authStatusChanged)="refreshAuthStatus()"` becomes `(authStatusChanged)="onAuthStatusChanged()"` which is now a no-op or removes the binding entirely (service auto-refreshes)
- CHANGE: `selectedProviderId()` in template reads from `authState.selectedProviderId()`

### AuthConfigComponent Changes

**What changes**: Delegate all state management to `AuthStateService`. Keep only form-local inputs (text values for new credentials, replace toggles). All mutations go through the service.

**Why**: Eliminates dual state (Critical Issue #2), fixes wrong-provider delete (Critical Issue #1), adds concurrent guard (Serious Issue #6), fixes provider switch badge (Critical Issue #4).

**Specific changes**:

- DELETE signals: `hasExistingOAuthToken`, `hasExistingApiKey`, `hasExistingOpenRouterKey`, `selectedProviderId`, `availableProviders`, `isLoadingStatus`, `connectionStatus`, `errorMessage`, `successMessage`
- KEEP signals: `oauthToken`, `apiKey`, `providerKey` (renamed from `openrouterKey`, fixes Moderate Issue #10), `isReplacingOAuth`, `isReplacingApiKey`, `isReplacingProviderKey`
- ADD: `inject(AuthStateService)` -- read all auth state and connection status from service
- RENAME: `openrouterKey` -> `providerKey` (fixes Moderate Issue #10)
- CHANGE: `authMethod` signal -> read from `authState.authMethod()` (fixes Moderate Issue #11)
- CHANGE: `onAuthMethodChange()` -> calls `authState.setAuthMethod(method)` + resets local form inputs
- CHANGE: `onProviderChange()` -> calls `authState.setSelectedProviderId(id)` + calls `authState.checkProviderKeyStatus(id)` to correctly set badge (fixes Critical Issue #4)
- CHANGE: `saveAndTest()` -> delegates to `authState.saveAndTest(params)` with concurrent guard via `authState.isSaving()`
- CHANGE: `deleteOpenRouterKey()` -> calls `authState.deleteProviderKey(authState.selectedProviderId())` which sends the correct provider ID (fixes Critical Issue #1)
- CHANGE: `canSaveAndTest` computed -> reads from service signals instead of local signals
- ADD: `selectedProvider` computed -> reads from `authState.selectedProvider()`
- CHANGE: `ngOnInit` -> calls `authState.loadAuthStatus()` (idempotent -- won't refetch if already loaded)
- ADD: Input validation using `keyPrefix` from provider info (fixes Moderate Issue #12)

### ProviderModelSelectorComponent Changes

**What changes**: Fix shared searchQuery across tiers, add error feedback, fix memory leak in effect.

**Why**: Fixes Serious Issues #8, #9, and Moderate Issue #13.

**Specific changes**:

- CHANGE: Single `searchQuery` signal -> `searchQueries` signal of type `Map<ProviderModelTier, string>` or three separate signals (`sonnetSearch`, `opusSearch`, `haikuSearch`). The simpler approach: use a `Record<ProviderModelTier, string>` signal, keyed by tier (fixes Serious Issue #8)
- CHANGE: `selectModel()` -> show error feedback via a local `tierError` signal when RPC fails (fixes Serious Issue #9)
- CHANGE: `clearTier()` -> show error feedback when RPC fails (fixes Serious Issue #9)
- CHANGE: constructor `effect()` -> track previous value and use `untracked()` or `DestroyRef` to prevent leaks. The effect already has manual `initialized` guard; add `DestroyRef` + `takeUntilDestroyed` pattern if subscription-based, or since this is a plain effect, Angular handles cleanup. However, the real fix is to cancel in-flight `loadModels()`/`loadTierMappings()` if provider changes again before they complete. Add an `AbortController` pattern (fixes Moderate Issue #13).

### Backend Changes: auth-rpc.handlers.ts

**What changes**: Replace hardcoded 1-second delay in `auth:testConnection` with a retry-poll pattern.

**Why**: Fixes Serious Issue #5 (hardcoded delay is unreliable).

**Specific changes**:

- CHANGE: `registerTestConnection()` -- replace `setTimeout(1000)` with a polling loop that checks SDK health up to N times with exponential backoff (e.g., 200ms, 400ms, 800ms, 1600ms, 3200ms = ~6.2s total max, well within the 10s frontend timeout)
- The loop checks `sdkAdapter.getHealth()` on each iteration and returns as soon as `status === 'available'` or exhausts retries

### Shared Types: rpc.types.ts

**No changes required**. The existing `AuthGetAuthStatusParams` already supports `providerId` (line 432-434). The existing `AuthGetAuthStatusResponse` already returns `hasOpenRouterKey` (line 477). No new RPC methods are needed.

---

## Batched Tasks

### Batch 1: Create AuthStateService (Foundation)

**Goal**: Create the new shared service that will be the single source of truth.

| #   | Task                                                                        | File                                                        | Action                    |
| --- | --------------------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------- |
| 1.1 | Create AuthStateService with all signals, computed properties, and methods  | `libs/frontend/core/src/lib/services/auth-state.service.ts` | CREATE                    |
| 1.2 | Export AuthStateService from services barrel                                | `libs/frontend/core/src/lib/services/index.ts`              | MODIFY                    |
| 1.3 | Verify export reaches library barrel (already re-exports all from services) | `libs/frontend/core/src/index.ts`                           | VERIFY (no change needed) |

**Testing**: Import `AuthStateService` in a test file, verify it compiles. Run `nx typecheck core`.

### Batch 2: Refactor SettingsComponent + UI Reorganization

**Goal**: Remove all duplicated auth state from SettingsComponent. Reorganize UI so auth-config and provider-model-selector live in one unified card.

| #   | Task                                                                                                                                                                                                                                                                                                                                           | File                                                          | Action |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ------ |
| 2.1 | Remove local auth signals, inject AuthStateService, read from service                                                                                                                                                                                                                                                                          | `libs/frontend/chat/src/lib/settings/settings.component.ts`   | MODIFY |
| 2.2 | Reorganize template: merge Authentication + Provider Model Mapping into one unified card. Move `<ptah-provider-model-selector>` inside the same card as `<ptah-auth-config>`, below a divider. Remove the standalone Provider Model Mapping section. Flow: auth-config → divider → model-selector (shown when provider auth + key configured). | `libs/frontend/chat/src/lib/settings/settings.component.html` | MODIFY |

**Testing**: Run `nx typecheck chat`. Manually verify:

- Unified card shows auth-config + model mapping grouped together
- Model tier dropdowns appear below Save & Test when provider auth + key configured
- Model tier dropdowns hidden when using OAuth or API Key auth methods
- Switching provider reloads models within same card context

### Batch 3: Refactor AuthConfigComponent to Use AuthStateService

**Goal**: Remove duplicated auth state, fix all 4 critical issues, add concurrent guard.

| #   | Task                                                                                        | File                                                             | Action |
| --- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ------ |
| 3.1 | Remove local auth state signals, inject AuthStateService, delegate mutations to service     | `libs/frontend/chat/src/lib/settings/auth-config.component.ts`   | MODIFY |
| 3.2 | Update template bindings: rename `openrouterKey` to `providerKey`, read status from service | `libs/frontend/chat/src/lib/settings/auth-config.component.html` | MODIFY |

**Testing**: Run `nx typecheck chat`. Verify:

- Save & Test works with concurrent guard (double-click protection)
- Provider switch checks key status for new provider (badge correct)
- Delete targets the UI-selected provider (not persisted one)
- AuthMethod change resets form state correctly

### Batch 4: Fix ProviderModelSelector Issues

**Goal**: Fix shared searchQuery, add error feedback, fix memory leak potential.

| #   | Task                                                                                      | File                                                                       | Action |
| --- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ------ |
| 4.1 | Replace shared searchQuery with per-tier queries, add error feedback, add AbortController | `libs/frontend/chat/src/lib/settings/provider-model-selector.component.ts` | MODIFY |

**Testing**: Run `nx typecheck chat`. Verify:

- Each tier's search input is independent
- Error messages appear when selectModel/clearTier fail
- Switching providers cancels in-flight model loads

### Batch 5: Fix Backend Connection Test + Cleanup

**Goal**: Fix unreliable 1-second delay, clean up deprecated export.

| #   | Task                                                              | File                                                                        | Action |
| --- | ----------------------------------------------------------------- | --------------------------------------------------------------------------- | ------ |
| 5.1 | Replace hardcoded delay with retry-poll in auth:testConnection    | `apps/ptah-extension-vscode/src/services/rpc/handlers/auth-rpc.handlers.ts` | MODIFY |
| 5.2 | Remove deprecated `OpenRouterModelSelectorComponent` alias export | `libs/frontend/chat/src/lib/settings/index.ts`                              | MODIFY |

**Testing**: Run `nx typecheck ptah-extension-vscode` and `nx typecheck chat`. Verify connection test works reliably (no false negatives from timing).

---

## File List

### CREATE

| File                                                        | Purpose                                                           |
| ----------------------------------------------------------- | ----------------------------------------------------------------- |
| `libs/frontend/core/src/lib/services/auth-state.service.ts` | New AuthStateService -- single source of truth for all auth state |

### MODIFY

| File                                                                        | Changes                                                      |
| --------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `libs/frontend/core/src/lib/services/index.ts`                              | Add `AuthStateService` export                                |
| `libs/frontend/chat/src/lib/settings/settings.component.ts`                 | Remove local auth signals, inject AuthStateService           |
| `libs/frontend/chat/src/lib/settings/settings.component.html`               | Update template bindings to service signals                  |
| `libs/frontend/chat/src/lib/settings/auth-config.component.ts`              | Remove local auth state, delegate to service, rename signals |
| `libs/frontend/chat/src/lib/settings/auth-config.component.html`            | Rename `openrouterKey`->`providerKey`, read from service     |
| `libs/frontend/chat/src/lib/settings/provider-model-selector.component.ts`  | Per-tier searchQuery, error feedback, AbortController        |
| `libs/frontend/chat/src/lib/settings/index.ts`                              | Remove deprecated alias                                      |
| `apps/ptah-extension-vscode/src/services/rpc/handlers/auth-rpc.handlers.ts` | Retry-poll for testConnection                                |

---

## Migration Notes

### Avoiding Breaking Changes During Refactoring

1. **Batch 1 is additive only**: Creating `AuthStateService` does not change any existing code. Both old and new patterns can coexist temporarily during development.

2. **Batch 2 and 3 are the critical migration**: SettingsComponent and AuthConfigComponent are tightly coupled through the `(authStatusChanged)` output event. The refactoring removes this coupling entirely:

   - **Before**: `AuthConfigComponent` emits `authStatusChanged` -> `SettingsComponent` calls `refreshAuthStatus()`
   - **After**: Both components read from `AuthStateService`. When `AuthConfigComponent` calls `authState.refreshAuthStatus()` after a successful save, `SettingsComponent` automatically sees the updated signals.

3. **The `authStatusChanged` output can be kept temporarily**: If the team-leader wants incremental migration, `AuthConfigComponent` can still emit the event, and `SettingsComponent` can handle it as a no-op (since the service already updated). Then remove the event in a cleanup pass.

4. **ProviderModelSelectorComponent (Batch 4) is independent**: It only receives `providerId` as an input. The input source changes from `SettingsComponent.selectedProviderId()` to `authState.selectedProviderId()`, but the component's internal behavior is unchanged -- the fixes (per-tier search, error feedback) are purely internal.

5. **Backend change (Batch 5) is backward-compatible**: The retry-poll replaces the sleep but produces the same result type. The frontend timeout (10s) already handles slow responses.

### Signal Naming Convention Fix

The following renames happen in Batch 3:

- `openrouterKey` -> `providerKey` (AuthConfigComponent local form signal)
- `hasExistingOpenRouterKey` -> removed (read from `authState.hasProviderKey()`)
- `hasOpenRouterKey` -> removed from SettingsComponent (read from `authState.hasProviderKey()`)
- Template references updated accordingly

The backend response field `hasOpenRouterKey` in `AuthGetAuthStatusResponse` retains its name for now (shared type change would affect more consumers). The `AuthStateService` maps it internally to the `_providerKeyMap`.

---

## Testing Strategy

### Per-Batch Verification

**Batch 1 (AuthStateService)**:

- `nx typecheck core` -- type-checks the new service
- `nx lint core` -- lint compliance
- Verify `AuthStateService` is importable from `@ptah-extension/core`
- Unit test: mock `ClaudeRpcService`, call `loadAuthStatus()`, verify signals update

**Batch 2 (SettingsComponent)**:

- `nx typecheck chat` -- type-checks the refactored component
- Manual: Open Settings, verify auth status badges show correctly
- Manual: Verify "Provider Model Mapping" section only shows when authMethod is provider/auto AND key is configured

**Batch 3 (AuthConfigComponent)**:

- `nx typecheck chat` -- type-checks the refactored component
- Manual: Test save & test with double-click (should be blocked by concurrent guard)
- Manual: Switch provider dropdown, verify badge shows correct key status for new provider
- Manual: Delete a provider key, verify it targets the UI-selected provider
- Manual: Switch auth method, verify provider model mapping visibility updates

**Batch 4 (ProviderModelSelector)**:

- `nx typecheck chat` -- type-checks the fixes
- Manual: Open all three tier search inputs, verify independent search queries
- Manual: Force a selectModel failure (disconnect network), verify error appears
- Manual: Rapidly switch providers, verify no stale model lists

**Batch 5 (Backend + Cleanup)**:

- `nx typecheck ptah-extension-vscode` -- type-checks the handler fix
- Manual: Save & Test connection, verify connection test succeeds without false negatives
- `nx typecheck chat` -- verify deprecated export removal doesn't break consumers

### Full Regression

After all batches:

- `nx run-many --target=typecheck --all` -- full type-check
- `nx run-many --target=lint --all` -- full lint
- Manual E2E: Fresh extension load -> Settings -> Configure provider key -> Save & Test -> Switch provider -> Delete key -> Switch auth method -> Verify all sections show/hide correctly

---

## Issue-to-Task Mapping

| Issue # | Severity | Description                                   | Fixed In                                                  |
| ------- | -------- | --------------------------------------------- | --------------------------------------------------------- |
| 1       | CRITICAL | Delete targets wrong provider                 | Batch 3 (deleteProviderKey takes explicit ID)             |
| 2       | CRITICAL | Dual independent state                        | Batch 1+2+3 (AuthStateService is single source)           |
| 3       | CRITICAL | showProviderModels ignores auth method        | Batch 2 (computed checks authMethod + hasProviderKey)     |
| 4       | CRITICAL | Provider switch blindly resets key badge      | Batch 3 (checkProviderKeyStatus queries backend)          |
| 5       | SERIOUS  | Hardcoded 1-second delay                      | Batch 5 (retry-poll pattern)                              |
| 6       | SERIOUS  | No concurrent guard on saveAndTest            | Batch 3 (isSaving signal as guard)                        |
| 7       | SERIOUS  | Inner fetchAuthStatus catch silently degrades | Batch 1 (service surfaces errors via errorMessage signal) |
| 8       | SERIOUS  | Shared searchQuery across tiers               | Batch 4 (per-tier search queries)                         |
| 9       | SERIOUS  | No error feedback for selectModel/clearTier   | Batch 4 (tierError signal)                                |
| 10      | MODERATE | Misleading signal names                       | Batch 3 (rename to providerKey)                           |
| 11      | MODERATE | SettingsComponent doesn't track authMethod    | Batch 2 (reads from authState.authMethod)                 |
| 12      | MODERATE | No input validation for provider keys         | Batch 3 (validate against keyPrefix)                      |
| 13      | MODERATE | Memory leak in effect                         | Batch 4 (AbortController for in-flight requests)          |

---

## Team-Leader Handoff

### Developer Type Recommendation

**Recommended Developer**: frontend-developer (primary), with one backend task

**Rationale**:

- 7 of 8 modified files are Angular frontend code
- Core work is creating a new Angular service and refactoring two components
- Backend change (Batch 5) is a simple replacement of setTimeout with a polling loop
- All changes follow established codebase patterns (signal-based services, RPC integration)

### Complexity Assessment

**Complexity**: MEDIUM
**Estimated Effort**: 6-10 hours

**Breakdown**:

- Batch 1 (AuthStateService): 2-3 hours -- new service with full interface
- Batch 2 (SettingsComponent): 1-1.5 hours -- removing signals, updating template
- Batch 3 (AuthConfigComponent): 1.5-2.5 hours -- most complex refactoring, form state changes
- Batch 4 (ProviderModelSelector): 1-1.5 hours -- per-tier search, error feedback
- Batch 5 (Backend + Cleanup): 0.5-1 hour -- simple loop replacement, export removal

### Critical Verification Points

**Before Implementation, Team-Leader Must Ensure Developer Verifies**:

1. **All imports exist in codebase**:

   - `ClaudeRpcService` from `@ptah-extension/core` (claude-rpc.service.ts:116)
   - `ModelStateService` from `@ptah-extension/core` (model-state.service.ts:48)
   - `AuthGetAuthStatusResponse` from `@ptah-extension/shared` (rpc.types.ts:471)
   - `AuthSaveSettingsParams` from `@ptah-extension/shared` (rpc.types.ts:395)
   - `AnthropicProviderInfo` from `@ptah-extension/shared` (rpc.types.ts:446)

2. **All patterns verified from examples**:

   - Signal-based service: `ModelStateService` (model-state.service.ts:47-239)
   - Computed signals: `ModelStateService.currentModelDisplay` (model-state.service.ts:89-94)
   - RPC call pattern: `ModelStateService.loadModels()` (model-state.service.ts:196-223)
   - Concurrent guard: `ModelStateService.switchModel()` checks `_isPending` (model-state.service.ts:144-149)

3. **Backend already supports per-provider queries**:

   - `auth:getAuthStatus` accepts `params.providerId` (auth-rpc.handlers.ts:95, line 117)
   - `auth:saveSettings` routes to `targetProviderId` (auth-rpc.handlers.ts:244)

4. **No hallucinated APIs**:
   - All RPC methods verified: `auth:getAuthStatus` (rpc.types.ts:857-860), `auth:saveSettings` (rpc.types.ts:849-852), `auth:testConnection` (rpc.types.ts:853-856)
   - All type interfaces verified in `rpc.types.ts:395-484`
   - `RpcResult` class verified in `claude-rpc.service.ts:31-74`

### Architecture Delivery Checklist

- [x] All components specified with evidence
- [x] All patterns verified from codebase
- [x] All imports/decorators verified as existing
- [x] Quality requirements defined
- [x] Integration points documented
- [x] Files affected list complete
- [x] Developer type recommended
- [x] Complexity assessed
- [x] No step-by-step implementation (that's team-leader's job)
- [x] All 13 issues mapped to specific batches
- [x] Migration strategy defined to avoid breaking changes
