/**
 * Auth State Service - Signal-Based Authentication State Management
 *
 * Centralizes all authentication state for credentials (API key, provider keys),
 * provider selection, and connection status. Provides a single source of truth
 * shared across SettingsComponent and AuthConfigComponent.
 *
 * Follows ModelStateService signal-based pattern (private _signal, public asReadonly).
 */

import { Injectable, signal, computed, inject } from '@angular/core';
import { ClaudeRpcService } from './claude-rpc.service';
import { ModelStateService } from './model-state.service';
import { EffortStateService } from './effort-state.service';
import type {
  AuthGetAuthStatusResponse,
  AuthSaveSettingsParams,
  AuthMethod,
  AnthropicProviderInfo,
} from '@ptah-extension/shared';

/**
 * Auth State Service - Signal-based authentication state
 *
 * Responsibilities:
 * - Maintain authentication credential presence flags (API key, provider keys)
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
 * console.log(authState.hasProviderKey());       // true/false (for selected provider)
 * console.log(authState.showProviderModels());   // true/false
 *
 * // Load initial status
 * await authState.loadAuthStatus();
 *
 * // Save and test connection
 * await authState.saveAndTest({ authMethod: 'thirdParty', providerApiKey: 'sk-...' });
 * ```
 */
@Injectable({ providedIn: 'root' })
export class AuthStateService {
  private readonly rpc = inject(ClaudeRpcService);
  private readonly modelState = inject(ModelStateService);
  private readonly effortState = inject(EffortStateService);

  // --- Private mutable signals ---

  /** Whether an Anthropic API key is configured in SecretStorage */
  private readonly _hasApiKey = signal(false);

  /** Per-provider key existence map, populated lazily via checkProviderKeyStatus and full refresh */
  private readonly _providerKeyMap = signal<Map<string, boolean>>(new Map());

  /** Current auth method preference (UI-local until saved) */
  private readonly _authMethod = signal<AuthMethod>('apiKey');

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

  /** Whether Copilot OAuth is authenticated */
  private readonly _copilotAuthenticated = signal(false);

  /** Connected GitHub username for Copilot OAuth */
  private readonly _copilotUsername = signal<string | null>(null);

  /** Whether a Copilot login is in progress */
  private readonly _copilotLoggingIn = signal(false);

  /** Whether Codex CLI auth is authenticated */
  private readonly _codexAuthenticated = signal(false);

  /** Whether Codex CLI auth token is stale/expired */
  private readonly _codexTokenStale = signal(false);

  /** Whether Claude CLI is installed and detected on the system */
  private readonly _claudeCliInstalled = signal(false);

  /**
   * Persisted auth method — the last value successfully saved to/loaded from the backend.
   * Unlike _authMethod (which changes on tile click), this only updates on load or successful save.
   */
  private readonly _persistedAuthMethod = signal<AuthMethod>('apiKey');

  /**
   * Persisted provider ID — the last value successfully saved to/loaded from the backend.
   * Unlike _selectedProviderId (which changes on tile click), this only updates on load or successful save.
   */
  private readonly _persistedProviderId = signal('openrouter');

  /** Guard to ensure loadAuthStatus only fetches once unless refreshed */
  private _isLoaded = false;

  /** Cached in-flight promise for loadAuthStatus deduplication */
  private _loadPromise: Promise<void> | null = null;

  // --- Public readonly signals ---

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

  /** Whether Copilot OAuth is authenticated */
  readonly copilotAuthenticated = this._copilotAuthenticated.asReadonly();

  /** Connected GitHub username */
  readonly copilotUsername = this._copilotUsername.asReadonly();

  /** Whether Copilot login is in progress */
  readonly copilotLoggingIn = this._copilotLoggingIn.asReadonly();

  /** Whether Codex CLI auth is authenticated */
  readonly codexAuthenticated = this._codexAuthenticated.asReadonly();

  /** Whether Codex CLI auth token is stale/expired */
  readonly codexTokenStale = this._codexTokenStale.asReadonly();

  /** Whether Claude CLI is installed on the system */
  readonly claudeCliInstalled = this._claudeCliInstalled.asReadonly();

  /** Persisted auth method (last loaded/saved from backend) */
  readonly persistedAuthMethod = this._persistedAuthMethod.asReadonly();

  /** Persisted provider ID (last loaded/saved from backend) */
  readonly persistedProviderId = this._persistedProviderId.asReadonly();

  /**
   * The tile ID of the currently active (persisted) provider.
   * Returns 'claude' when persisted method is apiKey, otherwise the persisted provider ID.
   * Used to show an "Active" indicator on the correct tile, separate from the viewed tile.
   */
  readonly persistedTileId = computed(() => {
    // Return null while loading to avoid flashing the wrong tile as active
    if (this._isLoading()) return null;
    const method = this._persistedAuthMethod();
    if (method === 'apiKey' || method === 'claudeCli') {
      return 'claude';
    }
    return this._persistedProviderId();
  });

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
   * Whether any credential is configured (API key, provider key, or Copilot OAuth).
   * Used by SettingsComponent to determine if authentication section shows status.
   */
  readonly hasAnyCredential = computed(
    () =>
      this._hasApiKey() ||
      this._claudeCliInstalled() ||
      this.hasProviderKey() ||
      this._copilotAuthenticated(),
  );

  /**
   * Whether provider model mapping section should be shown.
   * ONLY when authMethod is 'thirdParty' AND the selected provider has credentials.
   * For OAuth providers (e.g., GitHub Copilot): shown when OAuth is authenticated.
   * For API key providers: shown when a provider key is configured.
   */
  readonly showProviderModels = computed(() => {
    const method = this._authMethod();

    // Direct Anthropic auth: model mapping not needed — SDK handles tiers natively
    if (method === 'apiKey' || method === 'claudeCli') return false;

    // Third-party provider: check provider-level credentials
    if (method !== 'thirdParty') return false;

    // OAuth providers use their own auth, not API keys
    const provider = this.selectedProvider();
    if (provider?.authType === 'oauth') {
      if (provider.id === 'github-copilot') return this._copilotAuthenticated();
      if (provider.id === 'openai-codex') return this._codexAuthenticated();
      return false;
    }

    // Local providers (authType === 'none') don't need API keys — always show models
    if (provider?.authType === 'none') return true;

    return this.hasProviderKey();
  });

  /**
   * Effective provider ID for model mapping.
   * For direct auth (apiKey), the provider is always 'anthropic'.
   * For openrouter/auto, delegates to the user-selected provider.
   */
  readonly effectiveProviderId = computed(() => {
    const method = this._authMethod();
    if (method === 'apiKey' || method === 'claudeCli') return 'anthropic';
    return this._selectedProviderId();
  });

  /**
   * Whether the selected provider has valid credentials (API key or provider-specific auth).
   * Used by provider-model-selector to gate model loading.
   */
  readonly hasProviderCredential = computed(() => {
    const method = this._authMethod();
    if (method === 'claudeCli') return this._claudeCliInstalled();
    if (method === 'apiKey') return this._hasApiKey();

    // OpenRouter/auto: check provider-level credentials
    const provider = this.selectedProvider();
    if (provider?.authType === 'oauth') {
      if (provider.id === 'github-copilot') return this._copilotAuthenticated();
      if (provider.id === 'openai-codex') return this._codexAuthenticated();
      return false;
    }

    // Local providers (authType === 'none') don't need API keys — always credentialed
    if (provider?.authType === 'none') return true;

    return this.hasProviderKey();
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
        error,
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
        '[AuthStateService] Save already in progress, ignoring duplicate call',
      );
      return;
    }

    // Capture values at invocation time — if the user clicks a different tile
    // while the save is in-flight, these snapshots ensure we update persisted
    // state to what was actually saved, not the new UI-local selection.
    const savedAuthMethod = this._authMethod();
    const savedProviderId = this._selectedProviderId();

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
        {} as Record<string, never>,
      );

      if (testResult.isSuccess() && testResult.data?.success) {
        this._connectionStatus.set('success');
        this._successMessage.set('Connection successful! Settings saved.');

        // Update persisted state using the captured snapshots from invocation time
        this._persistedAuthMethod.set(savedAuthMethod);
        this._persistedProviderId.set(savedProviderId);

        // Refresh auth status and model list in isolated try-catch so
        // failures don't overwrite the successful save+test status
        try {
          await this.refreshAuthStatus();
          await Promise.all([
            this.modelState.refreshModels(),
            this.effortState.refreshEffort(),
          ]);
        } catch (refreshError) {
          console.warn(
            '[AuthStateService] Post-save refresh failed (credentials saved successfully):',
            refreshError,
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
        error instanceof Error ? error.message : 'An unexpected error occurred',
      );
    } finally {
      this._isSaving.set(false);
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
          result.error,
        );
        this._errorMessage.set(result.error || 'Failed to delete API key');
      }
    } catch (error) {
      console.error('[AuthStateService] deleteApiKey error:', error);
      this._errorMessage.set(
        error instanceof Error ? error.message : 'Failed to delete API key',
      );
    }
  }

  /**
   * Delete a provider API key for the given provider ID.
   * Fixes Critical Issue #1: takes explicit providerId parameter instead of
   * relying on potentially stale persisted state.
   *
   * Calls auth:saveSettings with empty providerApiKey AND the explicit
   * anthropicProviderId to ensure the correct provider's key is deleted.
   *
   * @param providerId - The provider whose key should be deleted
   */
  async deleteProviderKey(providerId: string): Promise<void> {
    try {
      const result = await this.rpc.call('auth:saveSettings', {
        authMethod: this._authMethod(),
        providerApiKey: '',
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
          result.error,
        );
        this._errorMessage.set(result.error || 'Failed to delete provider key');
      }
    } catch (error) {
      console.error('[AuthStateService] deleteProviderKey error:', error);
      this._errorMessage.set(
        error instanceof Error
          ? error.message
          : 'Failed to delete provider key',
      );
    }
  }

  /**
   * Trigger GitHub OAuth login for Copilot provider.
   * Calls auth:copilotLogin RPC which opens VS Code's GitHub sign-in.
   */
  async copilotLogin(): Promise<void> {
    if (this._copilotLoggingIn()) return;

    this._copilotLoggingIn.set(true);
    this._connectionStatus.set('testing');
    this._errorMessage.set('');
    this._successMessage.set('');

    try {
      // Extended timeout (120s) — user must complete GitHub OAuth in browser
      const result = await this.rpc.call(
        'auth:copilotLogin',
        {} as Record<string, never>,
        { timeout: 120000 },
      );

      if (result.isSuccess() && result.data?.success) {
        this._copilotAuthenticated.set(true);
        this._copilotUsername.set(result.data.username ?? null);
        this._connectionStatus.set('success');
        this._successMessage.set(
          `Connected to GitHub Copilot${
            result.data.username ? ` as ${result.data.username}` : ''
          }`,
        );

        // Save the provider selection so the backend knows to use Copilot
        const saveResult = await this.rpc.call('auth:saveSettings', {
          authMethod: this._authMethod(),
          anthropicProviderId: 'github-copilot',
        });

        if (saveResult.isSuccess()) {
          // Update persisted state — Copilot is now the active provider
          this._persistedAuthMethod.set(this._authMethod());
          this._persistedProviderId.set('github-copilot');
        } else {
          console.warn(
            '[AuthStateService] Post-login saveSettings failed:',
            saveResult.error,
          );
        }

        // Refresh models and effort for the new provider
        try {
          await Promise.all([
            this.modelState.refreshModels(),
            this.effortState.refreshEffort(),
          ]);
        } catch (refreshError) {
          console.warn(
            '[AuthStateService] Post-login model refresh failed:',
            refreshError,
          );
        }
      } else {
        this._connectionStatus.set('error');
        this._errorMessage.set(
          result.data?.error ?? result.error ?? 'GitHub Copilot login failed',
        );
      }
    } catch (error) {
      console.error('[AuthStateService] copilotLogin error:', error);
      this._connectionStatus.set('error');
      this._errorMessage.set(
        error instanceof Error ? error.message : 'GitHub Copilot login failed',
      );
    } finally {
      this._copilotLoggingIn.set(false);
    }
  }

  /**
   * Disconnect from GitHub Copilot.
   * Calls backend to clear Copilot auth state, then updates local signals.
   */
  async copilotLogout(): Promise<void> {
    try {
      await this.rpc.call('auth:copilotLogout', {} as Record<string, never>);
    } catch (error) {
      console.warn('[AuthStateService] copilotLogout RPC failed:', error);
    }

    // Always clear local state even if RPC fails
    this._copilotAuthenticated.set(false);
    this._copilotUsername.set(null);
    this._connectionStatus.set('idle');
    this._successMessage.set('');
  }

  /**
   * Trigger Codex CLI login via terminal.
   * Calls auth:codexLogin RPC which opens a terminal running `codex login`.
   */
  async codexLogin(): Promise<void> {
    await this.rpc.call('auth:codexLogin', {});
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
          result.error,
        );
        this._errorMessage.set(
          result.error || 'Failed to load authentication status',
        );
        return false;
      }
    } catch (error) {
      console.error(
        '[AuthStateService] fetchAndPopulateAuthStatus error:',
        error,
      );
      this._errorMessage.set(
        error instanceof Error
          ? error.message
          : 'Failed to load authentication status',
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
    this._hasApiKey.set(response.hasApiKey);
    this._authMethod.set(response.authMethod);
    this._selectedProviderId.set(response.anthropicProviderId);
    this._availableProviders.set(response.availableProviders);

    // Update persisted state to match backend truth
    this._persistedAuthMethod.set(response.authMethod);
    this._persistedProviderId.set(response.anthropicProviderId);

    // Reset provider key map to only contain the current provider's status.
    // Clears stale entries from previously checked providers that may
    // have changed via backend or another client since last check.
    this._providerKeyMap.set(
      new Map([[response.anthropicProviderId, response.hasOpenRouterKey]]),
    );

    // Populate Copilot auth status
    if (response.copilotAuthenticated !== undefined) {
      this._copilotAuthenticated.set(response.copilotAuthenticated);
    }
    if (response.copilotUsername !== undefined) {
      this._copilotUsername.set(response.copilotUsername ?? null);
    }

    // Populate Codex auth status
    this._codexAuthenticated.set(response.codexAuthenticated ?? false);
    this._codexTokenStale.set(response.codexTokenStale ?? false);

    // Populate Claude CLI availability
    this._claudeCliInstalled.set(response.claudeCliInstalled ?? false);
  }
}
