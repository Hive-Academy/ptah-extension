/**
 * Auth State Service - Signal-Based Authentication State Management
 * TASK_2025_133: Settings/Auth Provider Architecture Refactoring
 *
 * Centralizes all authentication state that was previously scattered across
 * SettingsComponent and AuthConfigComponent. Provides a single source of truth
 * for auth credentials, provider selection, and connection status.
 *
 * Follows ModelStateService signal-based pattern (private _signal, public asReadonly).
 * RPC integration: claude-rpc.service.ts (RpcResult pattern)
 */

import { Injectable, signal, computed, inject } from '@angular/core';
import { ClaudeRpcService } from './claude-rpc.service';
import { ModelStateService } from './model-state.service';
import type {
  AuthGetAuthStatusResponse,
  AuthSaveSettingsParams,
  AuthMethod,
  AnthropicProviderInfo,
  VsCodeLmModelInfo,
} from '@ptah-extension/shared';

/**
 * Auth State Service - Signal-based authentication state
 *
 * Responsibilities:
 * - Maintain authentication credential presence flags (OAuth, API key, provider keys)
 * - Track per-provider key existence via _providerKeyMap
 * - Provide readonly signals for reactive UI updates
 * - Sync auth state with backend via RPC
 * - Manage save-and-test flow with concurrent guard
 *
 * Usage:
 * ```typescript
 * readonly authState = inject(AuthStateService);
 *
 * // Read auth state
 * console.log(authState.hasOAuthToken());       // true/false
 * console.log(authState.hasProviderKey());       // true/false (for selected provider)
 * console.log(authState.showProviderModels());   // true/false
 *
 * // Load initial status
 * await authState.loadAuthStatus();
 *
 * // Save and test connection
 * await authState.saveAndTest({ authMethod: 'openrouter', openrouterApiKey: 'sk-...' });
 * ```
 */
@Injectable({ providedIn: 'root' })
export class AuthStateService {
  private readonly rpc = inject(ClaudeRpcService);
  private readonly modelState = inject(ModelStateService);

  // --- Private mutable signals ---

  /** Whether an OAuth token is configured in SecretStorage */
  private readonly _hasOAuthToken = signal(false);

  /** Whether an Anthropic API key is configured in SecretStorage */
  private readonly _hasApiKey = signal(false);

  /** Per-provider key existence map, populated lazily via checkProviderKeyStatus and full refresh */
  private readonly _providerKeyMap = signal<Map<string, boolean>>(new Map());

  /** Current auth method preference (UI-local until saved) */
  private readonly _authMethod = signal<AuthMethod>('auto');

  /** Available VS Code LM models (populated when authMethod is 'vscode-lm') */
  private readonly _vscodeLmModels = signal<VsCodeLmModelInfo[]>([]);

  /** Currently selected Anthropic-compatible provider ID */
  private readonly _selectedProviderId = signal('openrouter');

  /** Available Anthropic-compatible providers from backend */
  private readonly _availableProviders = signal<AnthropicProviderInfo[]>([]);

  /** Whether initial auth status is still loading */
  private readonly _isLoading = signal(true);

  /** Whether a save-and-test operation is in progress (concurrent guard) */
  private readonly _isSaving = signal(false);

  /** Current connection test status */
  private readonly _connectionStatus = signal<
    'idle' | 'saving' | 'testing' | 'success' | 'error'
  >('idle');

  /** Error message from last operation */
  private readonly _errorMessage = signal('');

  /** Success message from last operation */
  private readonly _successMessage = signal('');

  /** Guard to ensure loadAuthStatus only fetches once unless refreshed */
  private _isLoaded = false;

  /** Cached in-flight promise for loadAuthStatus deduplication */
  private _loadPromise: Promise<void> | null = null;

  // --- Public readonly signals ---

  /** Whether OAuth token is configured */
  readonly hasOAuthToken = this._hasOAuthToken.asReadonly();

  /** Whether API key is configured */
  readonly hasApiKey = this._hasApiKey.asReadonly();

  /** Current auth method preference */
  readonly authMethod = this._authMethod.asReadonly();

  /** Currently selected provider ID */
  readonly selectedProviderId = this._selectedProviderId.asReadonly();

  /** Available Anthropic-compatible providers */
  readonly availableProviders = this._availableProviders.asReadonly();

  /** Whether initial auth status is loading */
  readonly isLoading = this._isLoading.asReadonly();

  /** Whether save-and-test is in progress */
  readonly isSaving = this._isSaving.asReadonly();

  /** Connection test status */
  readonly connectionStatus = this._connectionStatus.asReadonly();

  /** Error message from last operation */
  readonly errorMessage = this._errorMessage.asReadonly();

  /** Success message from last operation */
  readonly successMessage = this._successMessage.asReadonly();

  /** Available VS Code LM models */
  readonly vscodeLmModels = this._vscodeLmModels.asReadonly();

  // --- Computed signals ---

  /**
   * Whether the currently selected provider has a key configured.
   * Reads from the per-provider key map using the selected provider ID.
   */
  readonly hasProviderKey = computed(() => {
    const map = this._providerKeyMap();
    const id = this._selectedProviderId();
    return map.get(id) ?? false;
  });

  /**
   * Whether any credential is configured (OAuth, API key, or provider key).
   * Used by SettingsComponent to determine if authentication section shows status.
   */
  readonly hasAnyCredential = computed(
    () =>
      this._authMethod() === 'vscode-lm' ||
      this._hasOAuthToken() ||
      this._hasApiKey() ||
      this.hasProviderKey()
  );

  /**
   * Whether provider model mapping section should be shown.
   * ONLY when authMethod is 'openrouter' or 'auto' AND the selected provider has a key.
   * Fixes Critical Issue #3: previously ignored authMethod check.
   */
  readonly showProviderModels = computed(() => {
    const method = this._authMethod();
    return (
      (method === 'openrouter' || method === 'auto') && this.hasProviderKey()
    );
  });

  /**
   * Currently selected provider info object from the available providers list.
   * Returns null if the selected provider ID doesn't match any available provider.
   */
  readonly selectedProvider = computed(() => {
    const id = this._selectedProviderId();
    return this._availableProviders().find((p) => p.id === id) ?? null;
  });

  // --- Public methods ---

  /**
   * Synchronous lookup: check if a specific provider has a key configured.
   * Used for badge display during provider switching without async calls.
   *
   * @param providerId - Provider ID to check
   * @returns Whether the provider has a key in the local cache
   */
  hasKeyForProvider(providerId: string): boolean {
    return this._providerKeyMap().get(providerId) ?? false;
  }

  /**
   * Initial load of auth status from backend.
   * Called once on first consumer mount. Uses _isLoaded guard
   * so subsequent calls are no-ops unless refreshAuthStatus() is called.
   */
  async loadAuthStatus(): Promise<void> {
    if (this._isLoaded) {
      return;
    }
    // Deduplicate concurrent calls: return the same in-flight promise
    if (!this._loadPromise) {
      this._loadPromise = this.fetchAndPopulateAuthStatus()
        .then((success) => {
          // Only mark as loaded on success (failure leaves _isLoaded false for retry)
          if (success) {
            this._isLoaded = true;
          }
        })
        .finally(() => {
          this._loadPromise = null;
        });
    }
    return this._loadPromise;
  }

  /**
   * Force refresh of auth status from backend.
   * Bypasses the _isLoaded guard to always re-fetch.
   */
  async refreshAuthStatus(): Promise<void> {
    await this.fetchAndPopulateAuthStatus();
  }

  /**
   * Check key status for a specific provider without doing a full refresh.
   * Calls auth:getAuthStatus with { providerId } and updates only
   * the _providerKeyMap entry for that provider.
   *
   * @param providerId - Provider ID to check key status for
   * @returns Whether the provider has a key configured
   */
  async checkProviderKeyStatus(providerId: string): Promise<boolean> {
    try {
      const result = await this.rpc.call('auth:getAuthStatus', { providerId });

      if (result.isSuccess() && result.data) {
        const hasKey = result.data.hasOpenRouterKey;
        this._providerKeyMap.update((prev) => {
          const next = new Map(prev);
          next.set(providerId, hasKey);
          return next;
        });
        return hasKey;
      }

      return false;
    } catch (error) {
      console.error(
        '[AuthStateService] Error checking provider key status:',
        error
      );
      return false;
    }
  }

  /**
   * Update local auth method preference.
   * This is UI-only and not persisted until saveAndTest() is called.
   * Resets status messages on change.
   *
   * @param method - Auth method to set
   */
  setAuthMethod(method: AuthMethod): void {
    this._authMethod.set(method);
    this._connectionStatus.set('idle');
    this._errorMessage.set('');
    this._successMessage.set('');
  }

  /**
   * Update local selected provider ID.
   * This is UI-only and not persisted until saveAndTest() is called.
   * Resets status messages on change.
   *
   * @param providerId - Provider ID to select
   */
  setSelectedProviderId(providerId: string): void {
    this._selectedProviderId.set(providerId);
    this._connectionStatus.set('idle');
    this._errorMessage.set('');
    this._successMessage.set('');
  }

  /**
   * Save authentication settings and test the connection.
   * Guarded by _isSaving signal to prevent concurrent calls (double-click protection).
   *
   * Flow:
   * 1. Set saving state
   * 2. Call auth:saveSettings with provided params
   * 3. If save succeeds, call auth:testConnection
   * 4. Update status signals based on results
   * 5. On success: refresh auth status and model list
   *
   * @param params - Auth settings to save
   */
  async saveAndTest(params: AuthSaveSettingsParams): Promise<void> {
    // Concurrent guard: prevent double-click or rapid re-invocation
    if (this._isSaving()) {
      console.warn(
        '[AuthStateService] Save already in progress, ignoring duplicate call'
      );
      return;
    }

    this._isSaving.set(true);
    this._connectionStatus.set('saving');
    this._errorMessage.set('');
    this._successMessage.set('');

    try {
      // Step 1: Save settings
      const saveResult = await this.rpc.call('auth:saveSettings', params);

      if (!saveResult.isSuccess() || !saveResult.data?.success) {
        const errorMsg =
          saveResult.error ||
          saveResult.data?.error ||
          'Failed to save settings';
        this._connectionStatus.set('error');
        this._errorMessage.set(errorMsg);
        return;
      }

      // Step 2: Test connection
      this._connectionStatus.set('testing');

      const testResult = await this.rpc.call(
        'auth:testConnection',
        {} as Record<string, never>
      );

      if (testResult.isSuccess() && testResult.data?.success) {
        this._connectionStatus.set('success');
        this._successMessage.set('Connection successful! Settings saved.');

        // Refresh auth status and model list in isolated try-catch so
        // failures don't overwrite the successful save+test status
        try {
          await this.refreshAuthStatus();
          await this.modelState.refreshModels();
        } catch (refreshError) {
          console.warn(
            '[AuthStateService] Post-save refresh failed (credentials saved successfully):',
            refreshError
          );
        }
      } else {
        this._connectionStatus.set('error');
        const errorMsg =
          testResult.data?.errorMessage ||
          testResult.error ||
          'Connection test failed';
        this._errorMessage.set(errorMsg);
      }
    } catch (error) {
      console.error('[AuthStateService] saveAndTest error:', error);
      this._connectionStatus.set('error');
      this._errorMessage.set(
        error instanceof Error ? error.message : 'An unexpected error occurred'
      );
    } finally {
      this._isSaving.set(false);
    }
  }

  /**
   * Delete the OAuth token credential.
   * Calls auth:saveSettings with empty claudeOAuthToken to remove it,
   * then refreshes auth status.
   */
  async deleteOAuthToken(): Promise<void> {
    try {
      const result = await this.rpc.call('auth:saveSettings', {
        authMethod: this._authMethod(),
        claudeOAuthToken: '',
      });

      if (result.isSuccess()) {
        await this.refreshAuthStatus();
      } else {
        console.error(
          '[AuthStateService] Failed to delete OAuth token:',
          result.error
        );
        this._errorMessage.set(result.error || 'Failed to delete OAuth token');
      }
    } catch (error) {
      console.error('[AuthStateService] deleteOAuthToken error:', error);
      this._errorMessage.set(
        error instanceof Error ? error.message : 'Failed to delete OAuth token'
      );
    }
  }

  /**
   * Delete the Anthropic API key credential.
   * Calls auth:saveSettings with empty anthropicApiKey to remove it,
   * then refreshes auth status.
   */
  async deleteApiKey(): Promise<void> {
    try {
      const result = await this.rpc.call('auth:saveSettings', {
        authMethod: this._authMethod(),
        anthropicApiKey: '',
      });

      if (result.isSuccess()) {
        await this.refreshAuthStatus();
      } else {
        console.error(
          '[AuthStateService] Failed to delete API key:',
          result.error
        );
        this._errorMessage.set(result.error || 'Failed to delete API key');
      }
    } catch (error) {
      console.error('[AuthStateService] deleteApiKey error:', error);
      this._errorMessage.set(
        error instanceof Error ? error.message : 'Failed to delete API key'
      );
    }
  }

  /**
   * Delete a provider API key for the given provider ID.
   * Fixes Critical Issue #1: takes explicit providerId parameter instead of
   * relying on potentially stale persisted state.
   *
   * Calls auth:saveSettings with empty openrouterApiKey AND the explicit
   * anthropicProviderId to ensure the correct provider's key is deleted.
   *
   * @param providerId - The provider whose key should be deleted
   */
  async deleteProviderKey(providerId: string): Promise<void> {
    try {
      const result = await this.rpc.call('auth:saveSettings', {
        authMethod: this._authMethod(),
        openrouterApiKey: '',
        anthropicProviderId: providerId,
      });

      if (result.isSuccess()) {
        // Update local map immediately for responsive UI
        this._providerKeyMap.update((prev) => {
          const next = new Map(prev);
          next.set(providerId, false);
          return next;
        });

        await this.refreshAuthStatus();
      } else {
        console.error(
          '[AuthStateService] Failed to delete provider key:',
          result.error
        );
        this._errorMessage.set(result.error || 'Failed to delete provider key');
      }
    } catch (error) {
      console.error('[AuthStateService] deleteProviderKey error:', error);
      this._errorMessage.set(
        error instanceof Error ? error.message : 'Failed to delete provider key'
      );
    }
  }

  /**
   * Load VS Code LM models from backend.
   * Called when user selects 'vscode-lm' auth method to populate the model list.
   */
  async loadVsCodeModels(): Promise<void> {
    try {
      const result = await this.rpc.call(
        'llm:listVsCodeModels',
        {} as Record<string, never>
      );
      if (result.isSuccess() && Array.isArray(result.data)) {
        this._vscodeLmModels.set(
          (result.data as Record<string, unknown>[]).map((m) => ({
            id: (m['id'] as string) ?? '',
            vendor: (m['vendor'] as string) ?? '',
            family: (m['family'] as string) ?? '',
            version: (m['version'] as string) ?? '',
            maxInputTokens: (m['maxInputTokens'] as number) ?? 0,
          }))
        );
      }
    } catch (error) {
      console.error(
        '[AuthStateService] Failed to load VS Code LM models:',
        error
      );
    }
  }

  /**
   * Clear connection status messages and reset to idle.
   * Used when user navigates away or starts a new action.
   */
  clearStatus(): void {
    this._connectionStatus.set('idle');
    this._errorMessage.set('');
    this._successMessage.set('');
  }

  // --- Private methods ---

  /**
   * Fetch auth status from backend and populate all signals.
   * Called by both loadAuthStatus (once) and refreshAuthStatus (always).
   *
   * @returns true if the fetch succeeded, false otherwise
   */
  private async fetchAndPopulateAuthStatus(): Promise<boolean> {
    this._isLoading.set(true);

    try {
      const result = await this.rpc.call('auth:getAuthStatus', {});

      if (result.isSuccess() && result.data) {
        this.populateFromResponse(result.data);
        return true;
      } else {
        console.error(
          '[AuthStateService] Failed to fetch auth status:',
          result.error
        );
        this._errorMessage.set(
          result.error || 'Failed to load authentication status'
        );
        return false;
      }
    } catch (error) {
      console.error(
        '[AuthStateService] fetchAndPopulateAuthStatus error:',
        error
      );
      this._errorMessage.set(
        error instanceof Error
          ? error.message
          : 'Failed to load authentication status'
      );
      return false;
    } finally {
      this._isLoading.set(false);
    }
  }

  /**
   * Populate all signals from an AuthGetAuthStatusResponse.
   * Updates the provider key map entry for the current provider.
   *
   * @param response - Backend auth status response
   */
  private populateFromResponse(response: AuthGetAuthStatusResponse): void {
    this._hasOAuthToken.set(response.hasOAuthToken);
    this._hasApiKey.set(response.hasApiKey);
    this._authMethod.set(response.authMethod);
    this._selectedProviderId.set(response.anthropicProviderId);
    this._availableProviders.set(response.availableProviders);
    this._vscodeLmModels.set(response.vscodeLmModels ?? []);

    // Reset provider key map to only contain the current provider's status.
    // Clears stale entries from previously checked providers that may
    // have changed via backend or another client since last check.
    this._providerKeyMap.set(
      new Map([[response.anthropicProviderId, response.hasOpenRouterKey]])
    );
  }
}
