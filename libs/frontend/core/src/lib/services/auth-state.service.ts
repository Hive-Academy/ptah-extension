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
  CustomProviderEntry,
  CustomProviderEntryInput,
  CustomProviderEntryChanges,
} from '@ptah-extension/shared';

type ApplyTo = 'global' | 'app' | 'workspace';
type SettingScope = 'global' | 'app' | 'workspace';

/**
 * Outcome of an add/update/remove against `provider.custom.entries`.
 *
 * Deliberately NOT a thrown error: every one of these mutations is driven by a
 * form the user is still looking at, and the backend is the authority on
 * rejection (id collision, unparseable base URL, secret-storage failure). The
 * form must be able to render `error` verbatim rather than assume success.
 */
export interface CustomProviderMutationResult {
  readonly ok: boolean;
  /** The entry as the backend stored it — canonical id, defaults applied. */
  readonly entry?: CustomProviderEntry;
  /** Backend rejection text, surfaced verbatim. Present only when `ok` is false. */
  readonly error?: string;
}

/**
 * Outcome of one real round-trip against a user-defined endpoint.
 *
 * `message` is produced by the backend, which classifies the failure
 * (unreachable host, TLS problem, rejected key, wrong URL shape, tool calling
 * unsupported). That classification is the actionable part — surface it as-is
 * and do not paraphrase it in the UI.
 */
export interface CustomProviderTestResult {
  readonly ok: boolean;
  readonly message: string;
  readonly latencyMs?: number;
}

/** Live state of the "Test connection" probe for a single custom entry. */
export interface CustomProviderTestState extends CustomProviderTestResult {
  readonly id: string;
}

/**
 * Ceiling for `provider:testCustomEntry`. The backend probe performs one real
 * tool-call round-trip with a ~10s timeout, so the transport must outlive it —
 * a 30s default would be fine, but an explicit value documents the coupling.
 */
const CUSTOM_ENTRY_TEST_TIMEOUT_MS = 20000;

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

  /**
   * Active auth-required banner, set when a chat operation fails because the
   * provider needs (re-)authentication. Null when there is nothing to show.
   */
  private readonly _authRequiredBanner = signal<{
    providerId: string | null;
    message: string;
  } | null>(null);

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

  /**
   * Resolved scope level for the auth method: 'global' (inherited), 'app'
   * (per-runtime override), or 'workspace' (per-folder override). Populated
   * from auth:getScope on every status fetch.
   */
  private readonly _authScope = signal<SettingScope>('global');

  /**
   * Resolved scope level for the provider: 'global', 'app', or 'workspace'.
   * Populated from auth:getScope on every status fetch.
   */
  private readonly _providerScope = signal<SettingScope>('global');

  /** Absolute active folder path resolved by the backend (null when none). */
  private readonly _activeScopePath = signal<string | null>(null);

  /**
   * User-defined provider entries as stored in `provider.custom.entries`.
   *
   * Distinct from `_availableProviders`: that is the merged TILE list the
   * backend projects for rendering (built-ins first, custom after) and it
   * carries no lane, no pricing, and no reliable base URL. This signal carries
   * the raw stored shape, which is what the edit form and the security copy
   * need. Never contains an API key — those live in SecretStorage backend-side.
   */
  private readonly _customEntries = signal<readonly CustomProviderEntry[]>([]);

  /** Whether a custom-entry list/mutation request is in flight. */
  private readonly _customEntriesBusy = signal(false);

  /** Last custom-entry error, surfaced verbatim from the backend. */
  private readonly _customEntryError = signal('');

  /** Result of the most recent "Test connection" probe (null when none run). */
  private readonly _customTestState = signal<CustomProviderTestState | null>(
    null,
  );

  /** Id of the entry currently being probed, or null when idle. */
  private readonly _customTestingId = signal<string | null>(null);

  /** Guard to ensure loadAuthStatus only fetches once unless refreshed */
  private _isLoaded = false;

  /** Cached in-flight promise for loadAuthStatus deduplication */
  private _loadPromise: Promise<void> | null = null;

  /** Whether API key is configured */
  readonly hasApiKey = this._hasApiKey.asReadonly();

  /** Current auth method preference */
  readonly authMethod = this._authMethod.asReadonly();

  /** Currently selected provider ID */
  readonly selectedProviderId = this._selectedProviderId.asReadonly();

  /** Available Anthropic-compatible providers */
  readonly availableProviders = this._availableProviders.asReadonly();

  /** User-defined provider entries (raw stored shape, no secrets). */
  readonly customEntries = this._customEntries.asReadonly();

  /** Whether a custom-entry list/mutation request is in flight. */
  readonly customEntriesBusy = this._customEntriesBusy.asReadonly();

  /** Last custom-entry error message (empty when none). */
  readonly customEntryError = this._customEntryError.asReadonly();

  /** Result of the most recent custom-entry connection probe. */
  readonly customTestState = this._customTestState.asReadonly();

  /** Id of the entry currently being probed (null when idle). */
  readonly customTestingId = this._customTestingId.asReadonly();

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

  /** Active auth-required banner for the chat surface (null when none). */
  readonly authRequiredBanner = this._authRequiredBanner.asReadonly();

  /** Whether Claude CLI is installed on the system */
  readonly claudeCliInstalled = this._claudeCliInstalled.asReadonly();

  /** Persisted auth method (last loaded/saved from backend) */
  readonly persistedAuthMethod = this._persistedAuthMethod.asReadonly();

  /** Persisted provider ID (last loaded/saved from backend) */
  readonly persistedProviderId = this._persistedProviderId.asReadonly();

  /** Resolved auth-method scope level ('global' | 'app' | 'workspace') */
  readonly authScope = this._authScope.asReadonly();

  /** Resolved provider scope level ('global' | 'app' | 'workspace') */
  readonly providerScope = this._providerScope.asReadonly();

  /** Absolute active folder path the scope applies to (null when none) */
  readonly activeScopePath = this._activeScopePath.asReadonly();

  /** Whether the active folder overrides either the auth method or the provider */
  readonly hasWorkspaceOverride = computed(
    () =>
      this._authScope() === 'workspace' ||
      this._providerScope() === 'workspace',
  );

  readonly hasAppOverride = computed(
    () => this._authScope() === 'app' || this._providerScope() === 'app',
  );

  readonly activeScope = computed<SettingScope>(() => {
    if (this.hasWorkspaceOverride()) return 'workspace';
    if (this.hasAppOverride()) return 'app';
    return 'global';
  });

  /**
   * The tile ID of the currently active (persisted) provider.
   * Returns 'claude' when persisted method is apiKey, otherwise the persisted provider ID.
   * Used to show an "Active" indicator on the correct tile, separate from the viewed tile.
   */
  readonly persistedTileId = computed(() => {
    if (this._isLoading()) return null;
    const method = this._persistedAuthMethod();
    if (method === 'apiKey' || method === 'claudeCli') {
      return 'claude';
    }
    return this._persistedProviderId();
  });

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
    if (method === 'apiKey' || method === 'claudeCli') return false;
    if (method !== 'thirdParty') return false;
    const provider = this.selectedProvider();
    if (provider?.authType === 'oauth') {
      if (provider.id === 'github-copilot') return this._copilotAuthenticated();
      if (provider.id === 'openai-codex') return this._codexAuthenticated();
      return false;
    }
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
    const provider = this.selectedProvider();
    if (provider?.authType === 'oauth') {
      if (provider.id === 'github-copilot') return this._copilotAuthenticated();
      if (provider.id === 'openai-codex') return this._codexAuthenticated();
      return false;
    }
    if (provider?.authType === 'none') return true;

    return this.hasProviderKey();
  });

  /**
   * Currently selected provider info object from the available providers list.
   * Returns null if the selected provider ID doesn't match any available provider.
   */
  readonly selectedProvider = computed(() => {
    const method = this._authMethod();
    if (method === 'apiKey' || method === 'claudeCli') {
      return null;
    }
    const id = this._selectedProviderId();
    return this._availableProviders().find((p) => p.id === id) ?? null;
  });

  /**
   * Ids of every user-defined entry. Tiles use this — NOT a name heuristic —
   * to decide which get edit/delete affordances. Built-in tiles must not.
   */
  readonly customEntryIds = computed(
    () => new Set(this._customEntries().map((entry) => entry.id)),
  );

  /**
   * The stored entry behind the currently selected tile, or null when the
   * selection is a built-in provider (or Claude direct).
   */
  readonly selectedCustomEntry = computed<CustomProviderEntry | null>(() => {
    const method = this._authMethod();
    if (method === 'apiKey' || method === 'claudeCli') return null;
    const id = this._selectedProviderId();
    return this._customEntries().find((entry) => entry.id === id) ?? null;
  });

  /**
   * Host of the selected custom entry's base URL — the string the security
   * copy names so the user sees exactly which machine their key reaches.
   * Falls back to the raw base URL if it somehow will not parse.
   */
  readonly selectedCustomHost = computed<string | null>(() => {
    const entry = this.selectedCustomEntry();
    if (!entry) return null;
    try {
      return new URL(entry.baseUrl).host;
    } catch {
      return entry.baseUrl;
    }
  });

  /** Whether the currently selected tile is a user-defined provider. */
  readonly isCustomProviderSelected = computed(
    () => this.selectedCustomEntry() !== null,
  );

  /**
   * Whether the selected custom entry has NO manual pricing configured, which
   * is the condition under which per-session cost must render as
   * "cost unavailable" rather than `$0.00`.
   *
   * Built-in providers return false — their pricing comes from the registry or
   * a live models endpoint, so this flag says nothing about them.
   */
  readonly selectedCustomPricingMissing = computed(() => {
    const entry = this.selectedCustomEntry();
    if (!entry) return false;
    return entry.pricing === null || entry.pricing === undefined;
  });

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

  /** Whether `providerId` resolves to a user-defined entry. */
  isCustomProvider(providerId: string): boolean {
    return this.customEntryIds().has(providerId);
  }

  /** One stored entry by id, or null when it is not user-defined. */
  customEntry(providerId: string): CustomProviderEntry | null {
    return (
      this._customEntries().find((entry) => entry.id === providerId) ?? null
    );
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
    if (!this._loadPromise) {
      this._loadPromise = this.fetchAndPopulateAuthStatus()
        .then((success) => {
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
    if (method === 'apiKey' || method === 'claudeCli') {
      this._selectedProviderId.set('anthropic');
    }
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
   * @param applyTo - Write target: 'global' default, 'app' for the current runtime, or 'workspace' for the active folder
   */
  async saveAndTest(
    params: AuthSaveSettingsParams,
    applyTo: ApplyTo = 'global',
  ): Promise<void> {
    if (this._isSaving()) {
      console.warn(
        '[AuthStateService] Save already in progress, ignoring duplicate call',
      );
      return;
    }
    const savedAuthMethod = this._authMethod();
    const savedProviderId = this._selectedProviderId();

    this._isSaving.set(true);
    this._connectionStatus.set('saving');
    this._errorMessage.set('');
    this._successMessage.set('');

    try {
      const saveResult = await this.rpc.call('auth:saveSettings', {
        ...params,
        applyTo: params.applyTo ?? applyTo,
      });

      if (!saveResult.isSuccess() || !saveResult.data?.success) {
        const errorMsg =
          saveResult.error ||
          saveResult.data?.error ||
          'Failed to save settings';
        this._connectionStatus.set('error');
        this._errorMessage.set(errorMsg);
        return;
      }
      this._connectionStatus.set('testing');

      const testResult = await this.rpc.call(
        'auth:testConnection',
        {} as Record<string, never>,
      );

      if (testResult.isSuccess() && testResult.data?.success) {
        this._connectionStatus.set('success');
        this._successMessage.set('Connection successful! Settings saved.');
        this._persistedAuthMethod.set(savedAuthMethod);
        this._persistedProviderId.set(savedProviderId);
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
   * Load `provider.custom.entries` from the backend.
   *
   * Always re-fetches — unlike {@link loadAuthStatus} there is no once-only
   * guard, because the list changes as a direct result of user actions in this
   * same panel and a stale list would render stale edit/delete affordances.
   */
  async loadCustomEntries(): Promise<void> {
    this._customEntriesBusy.set(true);
    try {
      const result = await this.rpc.call('provider:listCustomEntries', {});
      if (result.isSuccess() && result.data) {
        this._customEntries.set(result.data.entries);
        this._customEntryError.set('');
        return;
      }
      this._customEntryError.set(
        result.error || 'Failed to load custom providers',
      );
    } catch (error) {
      console.error('[AuthStateService] loadCustomEntries error:', error);
      this._customEntryError.set(
        error instanceof Error
          ? error.message
          : 'Failed to load custom providers',
      );
    } finally {
      this._customEntriesBusy.set(false);
    }
  }

  /**
   * Create a user-defined provider entry.
   *
   * @param entry - Non-secret metadata. The backend is the authority on id
   *   collisions and base-URL validity; client-side checks are a courtesy, not
   *   a guarantee, so a rejection here must be shown rather than swallowed.
   * @param apiKey - Optional key, forwarded once and stored in SecretStorage
   *   backend-side. It is NEVER written into the entry and never logged.
   */
  async addCustomEntry(
    entry: CustomProviderEntryInput,
    apiKey?: string,
  ): Promise<CustomProviderMutationResult> {
    return this.mutateCustomEntry(() =>
      this.rpc.call('provider:addCustomEntry', { entry, apiKey }),
    );
  }

  /**
   * Update a user-defined provider entry in place.
   *
   * @param id - Id of the entry to change (the id itself is not renameable —
   *   it keys the SecretStorage slot holding the API key).
   * @param changes - Partial metadata patch.
   * @param apiKey - Optional replacement key. Omit to leave the stored key
   *   untouched; pass an empty string to clear it.
   */
  async updateCustomEntry(
    id: string,
    changes: CustomProviderEntryChanges,
    apiKey?: string,
  ): Promise<CustomProviderMutationResult> {
    return this.mutateCustomEntry(() =>
      this.rpc.call('provider:updateCustomEntry', { id, changes, apiKey }),
    );
  }

  /**
   * Delete a user-defined provider entry and its stored key.
   *
   * @returns Whether the backend reported the entry as removed. A `false`
   *   result with no error means the entry was already gone.
   */
  async removeCustomEntry(id: string): Promise<boolean> {
    this._customEntriesBusy.set(true);
    this._customEntryError.set('');
    try {
      const result = await this.rpc.call('provider:removeCustomEntry', { id });
      if (!result.isSuccess() || !result.data) {
        this._customEntryError.set(
          result.error || 'Failed to remove custom provider',
        );
        return false;
      }
      await this.reloadAfterCustomMutation();
      if (this._customTestState()?.id === id) {
        this._customTestState.set(null);
      }
      return result.data.removed;
    } catch (error) {
      console.error('[AuthStateService] removeCustomEntry error:', error);
      this._customEntryError.set(
        error instanceof Error
          ? error.message
          : 'Failed to remove custom provider',
      );
      return false;
    } finally {
      this._customEntriesBusy.set(false);
    }
  }

  /**
   * Probe a user-defined endpoint with one real round-trip.
   *
   * Unlike `auth:testConnection` (which reflects local SDK-adapter health and
   * never leaves the machine), this actually talks to the user's endpoint, so
   * it can take seconds. Callers must render {@link customTestingId} as a
   * pending state rather than blocking.
   *
   * The returned `message` comes from the backend's failure classification and
   * is surfaced verbatim — it is the part that tells the user what to fix.
   */
  async testCustomEntry(id: string): Promise<CustomProviderTestResult> {
    if (this._customTestingId() !== null) {
      return {
        ok: false,
        message: 'A connection test is already running.',
      };
    }

    this._customTestingId.set(id);
    this._customTestState.set(null);

    try {
      const result = await this.rpc.call(
        'provider:testCustomEntry',
        { id },
        { timeout: CUSTOM_ENTRY_TEST_TIMEOUT_MS },
      );

      const outcome: CustomProviderTestResult =
        result.isSuccess() && result.data
          ? {
              ok: result.data.ok,
              message: result.data.message,
              ...(result.data.latencyMs === undefined
                ? {}
                : { latencyMs: result.data.latencyMs }),
            }
          : {
              ok: false,
              message: result.error || 'Connection test failed',
            };

      this._customTestState.set({ id, ...outcome });
      return outcome;
    } catch (error) {
      console.error('[AuthStateService] testCustomEntry error:', error);
      const outcome: CustomProviderTestResult = {
        ok: false,
        message:
          error instanceof Error ? error.message : 'Connection test failed',
      };
      this._customTestState.set({ id, ...outcome });
      return outcome;
    } finally {
      this._customTestingId.set(null);
    }
  }

  /** Clear the last custom-entry error (user dismissed or retried). */
  clearCustomEntryError(): void {
    this._customEntryError.set('');
  }

  /** Discard the last connection-probe result. */
  clearCustomTestState(): void {
    this._customTestState.set(null);
  }

  /**
   * Shared add/update path: run the mutation, surface a rejection verbatim, and
   * on success re-read both the entry list and the merged provider list so the
   * tile grid shows the change without a manual refresh.
   */
  private async mutateCustomEntry(
    run: () => Promise<{
      isSuccess(): boolean;
      data?: { entry: CustomProviderEntry };
      error?: string;
    }>,
  ): Promise<CustomProviderMutationResult> {
    this._customEntriesBusy.set(true);
    this._customEntryError.set('');
    try {
      const result = await run();
      if (!result.isSuccess() || !result.data) {
        const message = result.error || 'Failed to save custom provider';
        this._customEntryError.set(message);
        return { ok: false, error: message };
      }
      const entry = result.data.entry;
      await this.reloadAfterCustomMutation();
      return { ok: true, entry };
    } catch (error) {
      console.error('[AuthStateService] custom entry mutation error:', error);
      const message =
        error instanceof Error
          ? error.message
          : 'Failed to save custom provider';
      this._customEntryError.set(message);
      return { ok: false, error: message };
    } finally {
      this._customEntriesBusy.set(false);
    }
  }

  /**
   * Re-read entries and auth status after a mutation. A failure to refresh is
   * logged but not promoted to an error — the write itself already succeeded,
   * and reporting it as a failure would push the user to retry a mutation that
   * has already landed.
   */
  private async reloadAfterCustomMutation(): Promise<void> {
    try {
      await this.loadCustomEntries();
      await this.refreshAuthStatus();
    } catch (error) {
      console.warn(
        '[AuthStateService] post-mutation refresh failed (write succeeded):',
        error,
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
        const saveResult = await this.rpc.call('auth:saveSettings', {
          authMethod: this._authMethod(),
          anthropicProviderId: 'github-copilot',
        });

        if (saveResult.isSuccess()) {
          this._persistedAuthMethod.set(this._authMethod());
          this._persistedProviderId.set('github-copilot');
        } else {
          console.warn(
            '[AuthStateService] Post-login saveSettings failed:',
            saveResult.error,
          );
        }
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
   * Flag that a chat operation failed because the provider requires
   * (re-)authentication. Surfaces an inline banner on the chat surface. Called
   * from the chat orchestrator when an RPC returns errorCode 'AUTH_REQUIRED'.
   */
  flagAuthRequired(providerId: string | null, message: string): void {
    if (providerId === 'openai-codex') {
      this._codexTokenStale.set(true);
    }
    this._authRequiredBanner.set({ providerId, message });
  }

  /** Dismiss the auth-required banner (user acknowledged or re-authenticated). */
  clearAuthRequiredBanner(): void {
    this._authRequiredBanner.set(null);
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

  /**
   * Clear the most-specific present override (workspace → app → global),
   * reverting to the next-less-specific layer. Refreshes auth status afterward
   * so the UI re-resolves.
   */
  async clearWorkspaceOverride(): Promise<void> {
    try {
      const result = await this.rpc.call(
        'auth:clearWorkspaceOverride',
        {} as Record<string, never>,
      );
      if (!result.isSuccess() || !result.data?.success) {
        this._errorMessage.set(
          result.error || 'Failed to reset to global default',
        );
        return;
      }
      await this.refreshAuthStatus();
    } catch (error) {
      console.error('[AuthStateService] clearWorkspaceOverride error:', error);
      this._errorMessage.set(
        error instanceof Error
          ? error.message
          : 'Failed to reset to global default',
      );
    }
  }

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
        await this.fetchAndPopulateScope();
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
    this._persistedAuthMethod.set(response.authMethod);
    this._persistedProviderId.set(response.anthropicProviderId);
    this._providerKeyMap.set(
      new Map([[response.anthropicProviderId, response.hasOpenRouterKey]]),
    );
    if (response.copilotAuthenticated !== undefined) {
      this._copilotAuthenticated.set(response.copilotAuthenticated);
    }
    if (response.copilotUsername !== undefined) {
      this._copilotUsername.set(response.copilotUsername ?? null);
    }
    this._codexAuthenticated.set(response.codexAuthenticated ?? false);
    this._codexTokenStale.set(response.codexTokenStale ?? false);
    this._claudeCliInstalled.set(response.claudeCliInstalled ?? false);

    // Clear a stale Codex auth banner once credentials are healthy again.
    const banner = this._authRequiredBanner();
    if (
      banner?.providerId === 'openai-codex' &&
      (response.codexAuthenticated ?? false) &&
      !(response.codexTokenStale ?? false)
    ) {
      this._authRequiredBanner.set(null);
    }
  }

  private async fetchAndPopulateScope(): Promise<void> {
    try {
      const result = await this.rpc.call(
        'auth:getScope',
        {} as Record<string, never>,
      );
      if (result.isSuccess() && result.data) {
        this._authScope.set(result.data.authMethodScope);
        this._providerScope.set(result.data.providerScope);
        this._activeScopePath.set(result.data.activePath);
      }
    } catch (error) {
      console.warn('[AuthStateService] fetchAndPopulateScope failed:', error);
    }
  }
}
