import {
  Component,
  inject,
  signal,
  computed,
  output,
  ChangeDetectionStrategy,
  OnInit,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SlicePipe } from '@angular/common';
import {
  LucideAngularModule,
  CheckCircle,
  XCircle,
  Loader2,
  Check,
  Trash2,
} from 'lucide-angular';
import { AuthStateService, ClaudeRpcService } from '@ptah-extension/core';
import type {
  AuthMethod,
  AuthSaveSettingsParams,
} from '@ptah-extension/shared';

/**
 * AuthConfigComponent - Authentication configuration form
 *
 * Complexity Level: 2 (Form with service delegation and local form state)
 * Patterns: Signal delegation to AuthStateService, local form signals only
 *
 * Responsibilities:
 * - Display authentication method selection (Provider, OAuth, API Key, Auto-detect)
 * - Collect credential inputs (OAuth token, API key, provider key)
 * - Delegate save/delete/test operations to AuthStateService
 * - Display connection status and error messages from service
 *
 * SOLID Principles:
 * - Single Responsibility: Authentication configuration form only
 * - Dependency Inversion: Depends on AuthStateService abstraction for all auth state
 * - Open/Closed: Extensible via composition (provider model selector added by parent)
 *
 * State Management:
 * - Auth state (credentials, providers, status) managed by AuthStateService
 * - Local form state (text input values, replace toggles) managed by component signals
 * - No duplicate state between component and service
 *
 * Critical Fixes (TASK_2025_133):
 * - Critical Issue #1: deleteProviderKey uses UI-selected provider ID (not persisted)
 * - Critical Issue #2: Single source of truth via AuthStateService
 * - Critical Issue #4: Provider switch calls checkProviderKeyStatus for correct badge
 * - Serious Issue #6: Concurrent guard via isSaving signal
 */
@Component({
  selector: 'ptah-auth-config',
  standalone: true,
  imports: [FormsModule, SlicePipe, LucideAngularModule],
  templateUrl: './auth-config.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AuthConfigComponent implements OnInit {
  /** Auth state service - single source of truth for all auth state (PUBLIC for template access) */
  readonly authState = inject(AuthStateService);
  private readonly rpcService = inject(ClaudeRpcService);

  // Lucide icons
  readonly CheckCircleIcon = CheckCircle;
  readonly XCircleIcon = XCircle;
  readonly Loader2Icon = Loader2;
  readonly CheckIcon = Check;
  readonly Trash2Icon = Trash2;

  // --- Local form signals (text input values only) ---

  /** OAuth token text input value */
  readonly oauthToken = signal('');

  /** API key text input value */
  readonly apiKey = signal('');

  /** Provider API key text input value (renamed from openrouterKey for clarity) */
  readonly providerKey = signal('');

  // --- Local toggle signals for showing credential replacement inputs ---

  readonly isReplacingOAuth = signal(false);
  readonly isReplacingApiKey = signal(false);
  readonly isReplacingProviderKey = signal(false);

  /**
   * Event emitted when auth status changes (after successful save/delete)
   * Parent components can listen for backward compatibility, though the service
   * already auto-refreshes state.
   */
  readonly authStatusChanged = output<void>();

  /**
   * Computed: Currently selected provider info
   * Delegates directly to the service's selectedProvider computed signal.
   */
  readonly selectedProvider = this.authState.selectedProvider;

  /**
   * Computed signal to determine if Save & Test button should be enabled.
   * Button is enabled when there's a new credential value entered OR an existing credential
   * already saved for the selected auth method.
   *
   * Reads auth method and existing credential flags from service,
   * reads new input values from local form signals.
   */
  readonly canSaveAndTest = computed(() => {
    const method = this.authState.authMethod();
    const hasNewOAuth = this.oauthToken().trim().length > 0;
    const hasNewApiKey = this.apiKey().trim().length > 0;
    const hasNewProviderKey = this.providerKey().trim().length > 0;
    const hasExistingOAuth = this.authState.hasOAuthToken();
    const hasExistingApiKey = this.authState.hasApiKey();
    const hasExistingProviderKey = this.authState.hasProviderKey();

    switch (method) {
      case 'oauth':
        return hasNewOAuth || hasExistingOAuth;
      case 'apiKey':
        return hasNewApiKey || hasExistingApiKey;
      case 'openrouter':
        return hasNewProviderKey || hasExistingProviderKey;
      case 'auto':
        return (
          hasNewOAuth ||
          hasNewApiKey ||
          hasNewProviderKey ||
          hasExistingOAuth ||
          hasExistingApiKey ||
          hasExistingProviderKey
        );
      default:
        return false;
    }
  });

  /**
   * Load auth status on component initialization.
   * Delegates to AuthStateService which has an idempotent guard
   * (only fetches once unless refreshed).
   */
  async ngOnInit(): Promise<void> {
    try {
      await this.authState.loadAuthStatus();
    } catch (error) {
      console.error(
        '[AuthConfigComponent] Failed to initialize auth status:',
        error
      );
    }
  }

  /**
   * Save authentication settings and test connection.
   *
   * Flow:
   * 1. Guard against concurrent saves (via service's isSaving signal)
   * 2. Build params from local form inputs + service state
   * 3. Delegate to AuthStateService.saveAndTest()
   * 4. On success: reset replace toggles, clear local inputs, emit event
   *
   * The service handles:
   * - Saving settings via RPC (auth:saveSettings)
   * - Testing connection via RPC (auth:testConnection)
   * - Updating connection status, error/success messages
   * - Refreshing auth status and model list on success
   */
  async saveAndTest(): Promise<void> {
    // Concurrent guard: prevent double-click or rapid re-invocation
    if (this.authState.isSaving()) {
      return;
    }

    const currentMethod = this.authState.authMethod();
    const params: AuthSaveSettingsParams = {
      authMethod: currentMethod,
      claudeOAuthToken: this.oauthToken().trim() || undefined,
      anthropicApiKey: this.apiKey().trim() || undefined,
      openrouterApiKey: this.providerKey().trim() || undefined,
      anthropicProviderId: this.authState.selectedProviderId(),
    };

    await this.authState.saveAndTest(params);

    // After save completes, check if it was successful
    if (this.authState.connectionStatus() === 'success') {
      // Reset replacement toggles
      this.isReplacingOAuth.set(false);
      this.isReplacingApiKey.set(false);
      this.isReplacingProviderKey.set(false);
      // Clear local form inputs (service has refreshed auth status)
      this.oauthToken.set('');
      this.apiKey.set('');
      this.providerKey.set('');
      // Notify parent components
      this.authStatusChanged.emit();
    }
  }

  /**
   * Update auth method selection (delegates to service).
   *
   * When user changes auth method:
   * 1. Delegate to service (updates signal + resets status messages)
   * 2. Reset local form toggles
   *
   * The selection is persisted to the backend when the user clicks
   * "Save & Test Connection" via saveAndTest().
   */
  onAuthMethodChange(method: AuthMethod): void {
    if (this.authState.authMethod() === method) {
      return;
    }

    this.authState.setAuthMethod(method);
    this.isReplacingOAuth.set(false);
    this.isReplacingApiKey.set(false);
    this.isReplacingProviderKey.set(false);
  }

  /**
   * Handle provider selection change (delegates to service).
   *
   * When user selects a different Anthropic-compatible provider:
   * 1. Delegate to service (updates signal + resets status messages)
   * 2. Check key status for the new provider (fixes Critical Issue #4)
   * 3. Reset local provider key input
   *
   * The selection is persisted to the backend when the user clicks
   * "Save & Test Connection" via saveAndTest().
   */
  async onProviderChange(providerId: string): Promise<void> {
    if (this.authState.selectedProviderId() === providerId) {
      return;
    }

    this.authState.setSelectedProviderId(providerId);
    this.providerKey.set('');
    this.isReplacingProviderKey.set(false);

    // Query backend for key status of the newly selected provider
    // This correctly updates the badge without a full auth status refresh
    await this.authState.checkProviderKeyStatus(providerId);
  }

  /**
   * Reload VS Code window to apply auth changes
   *
   * Triggers a full window reload to ensure:
   * - SDK re-initializes with new provider/credentials
   * - All cached auth state is cleared
   * - Extension host restarts cleanly
   */
  async reloadWindow(): Promise<void> {
    try {
      await this.rpcService.call('command:execute', {
        command: 'workbench.action.reloadWindow',
      });
    } catch (error) {
      console.error('[AuthConfigComponent] Failed to reload window:', error);
    }
  }

  /**
   * Delete OAuth token from SecretStorage.
   * Delegates to AuthStateService which handles RPC call and state refresh.
   */
  async deleteOAuthToken(): Promise<void> {
    await this.authState.deleteOAuthToken();
    this.oauthToken.set('');
    this.authStatusChanged.emit();
  }

  /**
   * Delete API key from SecretStorage.
   * Delegates to AuthStateService which handles RPC call and state refresh.
   */
  async deleteApiKey(): Promise<void> {
    await this.authState.deleteApiKey();
    this.apiKey.set('');
    this.authStatusChanged.emit();
  }

  /**
   * Delete provider key from SecretStorage.
   * Fixes Critical Issue #1: Uses the UI-selected provider ID (from service)
   * instead of relying on potentially stale persisted state.
   * Delegates to AuthStateService which sends explicit providerId in RPC call.
   */
  async deleteProviderKey(): Promise<void> {
    await this.authState.deleteProviderKey(this.authState.selectedProviderId());
    this.providerKey.set('');
    this.authStatusChanged.emit();
  }
}
