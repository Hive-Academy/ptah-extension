import {
  Component,
  inject,
  signal,
  ChangeDetectionStrategy,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  LucideAngularModule,
  CheckCircle,
  XCircle,
  Loader2,
} from 'lucide-angular';
import { ClaudeRpcService, RpcResult } from '@ptah-extension/core';
import type {
  AuthSaveSettingsParams,
  AuthSaveSettingsResponse,
  AuthTestConnectionResponse,
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
export class AuthConfigComponent {
  private readonly rpcService = inject(ClaudeRpcService);

  // Lucide icons
  readonly CheckCircleIcon = CheckCircle;
  readonly XCircleIcon = XCircle;
  readonly Loader2Icon = Loader2;

  // Form state signals
  readonly authMethod = signal<'oauth' | 'apiKey' | 'auto'>('auto');
  readonly oauthToken = signal('');
  readonly apiKey = signal('');

  // Connection status signals
  readonly connectionStatus = signal<
    'idle' | 'saving' | 'testing' | 'success' | 'error'
  >('idle');
  readonly errorMessage = signal('');
  readonly successMessage = signal('');

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

      if (method === 'auto' && !oauth && !apiKeyValue) {
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
      };

      const saveResult = await this.rpcService.call<AuthSaveSettingsResponse>(
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

      const testResult = await this.callWithTimeout<AuthTestConnectionResponse>(
        'auth:testConnection',
        {},
        10000,
        'Connection test timed out after 10 seconds'
      );

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
  onAuthMethodChange(method: 'oauth' | 'apiKey' | 'auto'): void {
    this.authMethod.set(method);
    // Reset status when user changes method
    this.connectionStatus.set('idle');
    this.errorMessage.set('');
    this.successMessage.set('');
  }

  /**
   * Call RPC method with timeout protection
   * @param method - RPC method name
   * @param params - RPC method parameters
   * @param timeoutMs - Timeout in milliseconds
   * @param errorMessage - Error message to show on timeout
   * @returns RpcResult with success/error state
   */
  private async callWithTimeout<T>(
    method: string,
    params: unknown,
    timeoutMs: number,
    errorMessage: string
  ): Promise<RpcResult<T>> {
    return Promise.race([
      this.rpcService.call<T>(method, params),
      new Promise<RpcResult<T>>((_, reject) =>
        setTimeout(() => reject(new Error(errorMessage)), timeoutMs)
      ),
    ]);
  }
}
