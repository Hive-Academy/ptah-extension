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
import {
  LucideAngularModule,
  CheckCircle,
  XCircle,
  Loader2,
  Check,
  Trash2,
} from 'lucide-angular';
import { ClaudeRpcService, RpcResult } from '@ptah-extension/core';
import type {
  AuthSaveSettingsParams,
  AuthSaveSettingsResponse,
  AuthTestConnectionResponse,
  AuthGetAuthStatusResponse,
} from '@ptah-extension/shared';

/**
 * AuthConfigComponent - Authentication configuration form
 *
 * Complexity Level: 2 (Form with RPC integration and state management)
 * Patterns: Signal-based state, RPC integration
 *
 * Responsibilities:
 * - Display authentication method selection (OAuth, API Key, Auto-detect)
 * - Collect OAuth token and/or API key inputs
 * - Save settings via RPC (auth:saveSettings)
 * - Test connection via RPC (auth:testConnection)
 * - Display connection status and error messages
 *
 * SOLID Principles:
 * - Single Responsibility: Authentication configuration only
 * - Dependency Inversion: Depends on ClaudeRpcService abstraction for RPC
 *
 * State Management:
 * - Signal-based reactive state for form inputs and connection status
 * - No local storage - all config saved to VS Code settings via RPC
 *
 * Error Handling:
 * - Catches RPC errors and displays user-friendly messages
 * - Handles network failures and timeout scenarios
 * - Validates form inputs before saving
 */
@Component({
  selector: 'ptah-auth-config',
  standalone: true,
  imports: [FormsModule, LucideAngularModule],
  templateUrl: './auth-config.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AuthConfigComponent implements OnInit {
  private readonly rpcService = inject(ClaudeRpcService);

  // Timeout constants
  private readonly CONNECTION_TEST_TIMEOUT_MS = 10000;

  // Lucide icons
  readonly CheckCircleIcon = CheckCircle;
  readonly XCircleIcon = XCircle;
  readonly Loader2Icon = Loader2;
  readonly CheckIcon = Check;
  readonly Trash2Icon = Trash2;

  // Form state signals
  readonly authMethod = signal<'oauth' | 'apiKey' | 'openrouter' | 'auto'>(
    'auto'
  );
  readonly oauthToken = signal('');
  readonly apiKey = signal('');
  // TASK_2025_091: OpenRouter API key
  readonly openrouterKey = signal('');

  // Credential status signals (TASK_2025_076)
  readonly hasExistingOAuthToken = signal(false);
  readonly hasExistingApiKey = signal(false);
  // TASK_2025_091: OpenRouter status
  readonly hasExistingOpenRouterKey = signal(false);
  readonly isLoadingStatus = signal(true);

  /**
   * Event emitted when auth status changes (after successful save)
   * Parent components should refresh their auth state when this fires
   */
  readonly authStatusChanged = output<void>();

  // Connection status signals
  readonly connectionStatus = signal<
    'idle' | 'saving' | 'testing' | 'success' | 'error'
  >('idle');
  readonly errorMessage = signal('');
  readonly successMessage = signal('');

  /**
   * Computed signal to determine if Save & Test button should be enabled
   * Button is enabled when there's a new credential value entered based on auth method
   */
  readonly canSaveAndTest = computed(() => {
    const method = this.authMethod();
    const oauth = this.oauthToken().trim();
    const apiKeyValue = this.apiKey().trim();
    const openrouterKeyValue = this.openrouterKey().trim();

    switch (method) {
      case 'oauth':
        return oauth.length > 0;
      case 'apiKey':
        return apiKeyValue.length > 0;
      case 'openrouter':
        return openrouterKeyValue.length > 0;
      case 'auto':
        return (
          oauth.length > 0 ||
          apiKeyValue.length > 0 ||
          openrouterKeyValue.length > 0
        );
      default:
        return false;
    }
  });

  /**
   * Fetch auth status on component initialization
   */
  async ngOnInit(): Promise<void> {
    try {
      await this.fetchAuthStatus();
    } catch (error) {
      console.error(
        '[AuthConfigComponent] Failed to initialize auth status:',
        error
      );
      this.errorMessage.set(
        'Failed to load authentication status. Please try refreshing.'
      );
      this.isLoadingStatus.set(false);
    }
  }

  /**
   * Fetch current auth status from backend
   * SECURITY: Only boolean flags returned, never actual credential values
   */
  async fetchAuthStatus(): Promise<void> {
    this.isLoadingStatus.set(true);
    try {
      const result = await this.rpcService.call('auth:getAuthStatus', {});

      if (result.isSuccess() && result.data) {
        this.hasExistingOAuthToken.set(result.data.hasOAuthToken);
        this.hasExistingApiKey.set(result.data.hasApiKey);
        // TASK_2025_091: OpenRouter status
        this.hasExistingOpenRouterKey.set(result.data.hasOpenRouterKey);
        this.authMethod.set(result.data.authMethod);
      }
    } catch (error) {
      console.error(
        '[AuthConfigComponent] Failed to fetch auth status:',
        error
      );
      // Graceful degradation - show empty state
    } finally {
      this.isLoadingStatus.set(false);
    }
  }

  /**
   * Save authentication settings and test connection
   *
   * Flow:
   * 1. Validate form inputs
   * 2. Call auth:saveSettings RPC (saves to VS Code config)
   * 3. Wait for ConfigManager watcher to trigger SDK re-initialization
   * 4. Call auth:testConnection RPC to verify SDK health
   * 5. Display success or error message
   *
   * Error Handling:
   * - Missing credentials: Display validation error
   * - RPC save failure: Display save error
   * - Connection test failure: Display connection error with details
   * - Network timeout: Display timeout error
   */
  async saveAndTest(): Promise<void> {
    // Reset status
    this.connectionStatus.set('saving');
    this.errorMessage.set('');
    this.successMessage.set('');

    try {
      // Validate inputs based on auth method
      const method = this.authMethod();
      const oauth = this.oauthToken().trim();
      const apiKeyValue = this.apiKey().trim();
      const openrouterKeyValue = this.openrouterKey().trim();

      // Validation
      if (method === 'oauth' && !oauth) {
        this.connectionStatus.set('error');
        this.errorMessage.set(
          'OAuth token is required for OAuth authentication'
        );
        return;
      }

      if (method === 'apiKey' && !apiKeyValue) {
        this.connectionStatus.set('error');
        this.errorMessage.set('API key is required for API Key authentication');
        return;
      }

      // TASK_2025_091: OpenRouter validation
      if (method === 'openrouter' && !openrouterKeyValue) {
        this.connectionStatus.set('error');
        this.errorMessage.set(
          'OpenRouter API key is required for OpenRouter authentication'
        );
        return;
      }

      if (method === 'auto' && !oauth && !apiKeyValue && !openrouterKeyValue) {
        this.connectionStatus.set('error');
        this.errorMessage.set(
          'At least one credential is required for Auto-detect mode'
        );
        return;
      }

      // Step 1: Save settings via RPC
      const saveParams: AuthSaveSettingsParams = {
        authMethod: method,
        claudeOAuthToken: oauth || undefined,
        anthropicApiKey: apiKeyValue || undefined,
        // TASK_2025_091: Include OpenRouter key
        openrouterApiKey: openrouterKeyValue || undefined,
      };

      const saveResult = await this.rpcService.call(
        'auth:saveSettings',
        saveParams
      );

      if (!saveResult.isSuccess()) {
        this.connectionStatus.set('error');
        this.errorMessage.set(
          saveResult.error || 'Failed to save authentication settings'
        );
        return;
      }

      // Step 2: Test connection (waits for SDK re-initialization)
      this.connectionStatus.set('testing');
      this.successMessage.set('Settings saved. Testing connection...');

      const testResult = await Promise.race([
        this.rpcService.call('auth:testConnection', {}),
        new Promise<never>((_, reject) =>
          setTimeout(
            () =>
              reject(new Error('Connection test timed out after 10 seconds')),
            this.CONNECTION_TEST_TIMEOUT_MS
          )
        ),
      ]);

      if (testResult.isSuccess()) {
        const testData = testResult.data!;
        if (testData.success && testData.health.status === 'available') {
          // Success!
          this.connectionStatus.set('success');
          this.successMessage.set(
            `✓ Connected successfully! (${Math.round(
              testData.health.responseTime || 0
            )}ms)`
          );
          this.errorMessage.set('');
          // Refetch status to update configured badges (TASK_2025_076)
          await this.fetchAuthStatus();
          // Notify parent components to refresh their auth state
          this.authStatusChanged.emit();
        } else {
          // Connection test failed
          this.connectionStatus.set('error');
          this.errorMessage.set(
            testData.errorMessage ||
              testData.health.errorMessage ||
              'Connection test failed. Please check your credentials.'
          );
          this.successMessage.set('');
        }
      } else {
        // RPC call failed
        this.connectionStatus.set('error');
        this.errorMessage.set(
          testResult.error || 'Connection test failed. Please try again.'
        );
        this.successMessage.set('');
      }
    } catch (error) {
      // Handle unexpected errors (network issues, timeouts, etc.)
      this.connectionStatus.set('error');
      this.errorMessage.set(
        error instanceof Error
          ? `Error: ${error.message}`
          : 'An unexpected error occurred. Please try again.'
      );
      this.successMessage.set('');
      console.error('[AuthConfigComponent] Error during save/test:', error);
    }
  }

  /**
   * Update auth method selection
   */
  onAuthMethodChange(method: 'oauth' | 'apiKey' | 'openrouter' | 'auto'): void {
    this.authMethod.set(method);
    // Reset status when user changes method
    this.connectionStatus.set('idle');
    this.errorMessage.set('');
    this.successMessage.set('');
  }

  /**
   * Delete OAuth token from SecretStorage
   */
  async deleteOAuthToken(): Promise<void> {
    this.connectionStatus.set('saving');
    this.errorMessage.set('');
    this.successMessage.set('');

    try {
      const saveParams: AuthSaveSettingsParams = {
        authMethod: this.authMethod(),
        claudeOAuthToken: '', // Empty string triggers deletion
      };

      const result = await this.rpcService.call(
        'auth:saveSettings',
        saveParams
      );

      if (result.isSuccess()) {
        this.successMessage.set('OAuth token removed successfully');
        this.connectionStatus.set('success');
        this.oauthToken.set('');
        await this.fetchAuthStatus();
      } else {
        this.errorMessage.set(result.error || 'Failed to remove OAuth token');
        this.connectionStatus.set('error');
      }
    } catch (error) {
      this.errorMessage.set(
        error instanceof Error ? error.message : 'Failed to remove OAuth token'
      );
      this.connectionStatus.set('error');
    }
  }

  /**
   * Delete API key from SecretStorage
   */
  async deleteApiKey(): Promise<void> {
    this.connectionStatus.set('saving');
    this.errorMessage.set('');
    this.successMessage.set('');

    try {
      const saveParams: AuthSaveSettingsParams = {
        authMethod: this.authMethod(),
        anthropicApiKey: '', // Empty string triggers deletion
      };

      const result = await this.rpcService.call(
        'auth:saveSettings',
        saveParams
      );

      if (result.isSuccess()) {
        this.successMessage.set('API key removed successfully');
        this.connectionStatus.set('success');
        this.apiKey.set('');
        await this.fetchAuthStatus();
      } else {
        this.errorMessage.set(result.error || 'Failed to remove API key');
        this.connectionStatus.set('error');
      }
    } catch (error) {
      this.errorMessage.set(
        error instanceof Error ? error.message : 'Failed to remove API key'
      );
      this.connectionStatus.set('error');
    }
  }

  /**
   * Delete OpenRouter key from SecretStorage (TASK_2025_091)
   */
  async deleteOpenRouterKey(): Promise<void> {
    this.connectionStatus.set('saving');
    this.errorMessage.set('');
    this.successMessage.set('');

    try {
      const saveParams: AuthSaveSettingsParams = {
        authMethod: this.authMethod(),
        openrouterApiKey: '', // Empty string triggers deletion
      };

      const result = await this.rpcService.call(
        'auth:saveSettings',
        saveParams
      );

      if (result.isSuccess()) {
        this.successMessage.set('OpenRouter key removed successfully');
        this.connectionStatus.set('success');
        this.openrouterKey.set('');
        await this.fetchAuthStatus();
      } else {
        this.errorMessage.set(
          result.error || 'Failed to remove OpenRouter key'
        );
        this.connectionStatus.set('error');
      }
    } catch (error) {
      this.errorMessage.set(
        error instanceof Error
          ? error.message
          : 'Failed to remove OpenRouter key'
      );
      this.connectionStatus.set('error');
    }
  }
}
