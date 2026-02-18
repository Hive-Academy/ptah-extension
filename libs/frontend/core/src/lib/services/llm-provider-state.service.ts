/**
 * LlmProviderStateService - Signal-Based LLM Provider State Management
 * TASK_2025_155: LLM Provider Configuration UI
 *
 * Centralizes all LLM provider state: configured providers, default provider selection,
 * API key management, and loading/error status.
 *
 * Follows AuthStateService signal-based pattern (private _signal, public asReadonly).
 * RPC integration: claude-rpc.service.ts (RpcResult pattern)
 */

import { Injectable, signal, inject } from '@angular/core';
import type {
  LlmProviderName,
  LlmProviderCapability,
} from '@ptah-extension/shared';
import { ClaudeRpcService } from './claude-rpc.service';

/**
 * LlmProviderStateService - Signal-based LLM provider state
 *
 * Responsibilities:
 * - Track available LLM providers and their configuration status
 * - Track default provider selection
 * - Manage API key set/remove operations
 * - Provide readonly signals for reactive UI updates
 * - Sync provider state with backend via RPC
 *
 * Usage:
 * ```typescript
 * readonly providerState = inject(LlmProviderStateService);
 *
 * // Read provider state
 * console.log(providerState.providers());       // Array of providers
 * console.log(providerState.defaultProvider()); // 'openai' | 'google-genai' | etc.
 * console.log(providerState.isLoading());       // true/false
 *
 * // Load initial status
 * await providerState.loadProviderStatus();
 *
 * // Set an API key
 * const success = await providerState.setApiKey('openai', 'sk-...');
 * ```
 */
@Injectable({ providedIn: 'root' })
export class LlmProviderStateService {
  private readonly rpc = inject(ClaudeRpcService);

  // --- Private mutable signals ---

  /** Available LLM providers with their configuration status */
  private readonly _providers = signal<
    Array<{
      provider: LlmProviderName;
      displayName: string;
      isConfigured: boolean;
      defaultModel: string;
      capabilities: LlmProviderCapability[];
    }>
  >([]);

  /** Currently selected default provider */
  private readonly _defaultProvider = signal<LlmProviderName | ''>('');

  /** Whether a provider status load is in progress */
  private readonly _isLoading = signal(false);

  /** Error message from last operation */
  private readonly _error = signal('');

  /** Guard to ensure loadProviderStatus only fetches once unless refreshed */
  private _isLoaded = false;

  /** Cached in-flight promise for loadProviderStatus deduplication */
  private _loadPromise: Promise<void> | null = null;

  // --- Public readonly signals ---

  /** Available LLM providers with configuration status */
  readonly providers = this._providers.asReadonly();

  /** Currently selected default provider */
  readonly defaultProvider = this._defaultProvider.asReadonly();

  /** Whether a provider status load is in progress */
  readonly isLoading = this._isLoading.asReadonly();

  /** Error message from last operation */
  readonly error = this._error.asReadonly();

  // --- Public methods ---

  /**
   * Load provider status from backend.
   * Populates providers and defaultProvider signals from the llm:getProviderStatus RPC.
   * Uses _isLoaded guard so subsequent calls are no-ops unless the initial load failed.
   * Deduplicates concurrent calls by returning the same in-flight promise.
   */
  async loadProviderStatus(): Promise<void> {
    if (this._isLoaded) {
      return;
    }
    // Deduplicate concurrent calls: return the same in-flight promise
    if (!this._loadPromise) {
      this._loadPromise = this.fetchProviderStatus()
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
   * Fetch provider status from backend and populate signals.
   * Called by loadProviderStatus (once) and after setApiKey/removeApiKey (always).
   *
   * @returns true if the fetch succeeded, false otherwise
   */
  private async fetchProviderStatus(): Promise<boolean> {
    this._isLoading.set(true);
    this._error.set('');

    try {
      const result = await this.rpc.call(
        'llm:getProviderStatus',
        {} as Record<string, never>
      );

      if (result.isSuccess() && result.data) {
        this._providers.set(result.data.providers);
        this._defaultProvider.set(result.data.defaultProvider);
        return true;
      } else {
        const errorMsg = result.error || 'Failed to load provider status';
        this._error.set(errorMsg);
        console.error(
          '[LlmProviderStateService] Failed to load provider status:',
          errorMsg
        );
        return false;
      }
    } catch (error) {
      const errorMsg =
        error instanceof Error
          ? error.message
          : 'Failed to load provider status';
      this._error.set(errorMsg);
      console.error(
        '[LlmProviderStateService] loadProviderStatus error:',
        error
      );
      return false;
    } finally {
      this._isLoading.set(false);
    }
  }

  /**
   * Set an API key for the given provider.
   * On success, refreshes provider status to reflect the updated configuration.
   *
   * @param provider - The LLM provider to set the key for
   * @param apiKey - The API key string
   * @returns true if the key was saved successfully, false otherwise
   */
  async setApiKey(provider: LlmProviderName, apiKey: string): Promise<boolean> {
    this._error.set('');

    try {
      const result = await this.rpc.call('llm:setApiKey', { provider, apiKey });

      if (result.isSuccess() && result.data?.success) {
        await this.fetchProviderStatus();
        return true;
      }

      const errorMsg =
        result.data?.error || result.error || 'Failed to set API key';
      this._error.set(errorMsg);
      console.error(
        '[LlmProviderStateService] Failed to set API key:',
        errorMsg
      );
      return false;
    } catch (error) {
      const errorMsg =
        error instanceof Error ? error.message : 'Failed to set API key';
      this._error.set(errorMsg);
      console.error('[LlmProviderStateService] setApiKey error:', error);
      return false;
    }
  }

  /**
   * Remove the API key for the given provider.
   * On success, refreshes provider status to reflect the updated configuration.
   *
   * @param provider - The LLM provider whose key should be removed
   * @returns true if the key was removed successfully, false otherwise
   */
  async removeApiKey(provider: LlmProviderName): Promise<boolean> {
    this._error.set('');

    try {
      const result = await this.rpc.call('llm:removeApiKey', provider);

      if (result.isSuccess() && result.data?.success) {
        await this.fetchProviderStatus();
        return true;
      }

      const errorMsg =
        result.data?.error || result.error || 'Failed to remove API key';
      this._error.set(errorMsg);
      console.error(
        '[LlmProviderStateService] Failed to remove API key:',
        errorMsg
      );
      return false;
    } catch (error) {
      const errorMsg =
        error instanceof Error ? error.message : 'Failed to remove API key';
      this._error.set(errorMsg);
      console.error('[LlmProviderStateService] removeApiKey error:', error);
      return false;
    }
  }

  /**
   * Set the default LLM provider.
   * On success, updates the local defaultProvider signal immediately.
   *
   * @param provider - The LLM provider to set as default
   * @returns true if the default was updated successfully, false otherwise
   */
  async setDefaultProvider(provider: LlmProviderName): Promise<boolean> {
    this._error.set('');

    try {
      const result = await this.rpc.call('llm:setDefaultProvider', {
        provider,
      });

      if (result.isSuccess() && result.data?.success) {
        this._defaultProvider.set(provider);
        return true;
      }

      const errorMsg =
        result.data?.error || result.error || 'Failed to set default provider';
      this._error.set(errorMsg);
      console.error(
        '[LlmProviderStateService] Failed to set default provider:',
        errorMsg
      );
      return false;
    } catch (error) {
      const errorMsg =
        error instanceof Error
          ? error.message
          : 'Failed to set default provider';
      this._error.set(errorMsg);
      console.error(
        '[LlmProviderStateService] setDefaultProvider error:',
        error
      );
      return false;
    }
  }
}
