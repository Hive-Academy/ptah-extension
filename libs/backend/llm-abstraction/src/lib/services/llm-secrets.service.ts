/**
 * LLM Secrets Service
 *
 * Manages API keys for LLM providers using VS Code's SecretStorage.
 * SecretStorage provides encrypted, secure storage for sensitive data.
 *
 * @packageDocumentation
 */

import { injectable, inject } from 'tsyringe';
import * as vscode from 'vscode';
import { TOKENS, Logger } from '@ptah-extension/vscode-core';
import { LlmProviderName } from '../types/provider-types';

// Re-export for backwards compatibility (DO NOT REMOVE - used by other services)
export type { LlmProviderName } from '../types/provider-types';

/**
 * All provider names that require API keys.
 * Currently empty since vscode-lm does not require an API key.
 */
export const API_KEY_PROVIDERS: readonly LlmProviderName[] = [] as const;

/**
 * Interface for LLM secrets management
 */
export interface ILlmSecretsService {
  /**
   * Get API key for a provider
   * @param provider - Provider name
   * @returns API key or undefined if not set
   */
  getApiKey(provider: LlmProviderName): Promise<string | undefined>;

  /**
   * Store API key for a provider
   * @param provider - Provider name
   * @param key - API key to store
   */
  setApiKey(provider: LlmProviderName, key: string): Promise<void>;

  /**
   * Delete API key for a provider
   * @param provider - Provider name
   */
  deleteApiKey(provider: LlmProviderName): Promise<void>;

  /**
   * Check if provider has a configured API key
   * @param provider - Provider name
   * @returns true if API key is configured (vscode-lm always returns true)
   */
  hasApiKey(provider: LlmProviderName): Promise<boolean>;

  /**
   * Get list of providers that have API keys configured
   * @returns Array of provider names with configured keys
   */
  getConfiguredProviders(): Promise<LlmProviderName[]>;

  /**
   * Validate API key format for a provider
   * @param provider - Provider name
   * @param key - API key to validate
   * @returns true if key format is valid
   */
  validateKeyFormat(provider: LlmProviderName, key: string): boolean;
}

/**
 * LLM Secrets Service Implementation
 *
 * Uses VS Code's SecretStorage for encrypted API key storage.
 * Keys are stored with prefix: `ptah.llm.{provider}.apiKey`
 *
 * Error Handling Pattern (TASK_2025_073 Batch 3):
 * - Public methods may throw on validation failures
 * - SecretStorage errors propagate to caller for handling
 * - All errors are logged before throwing
 */
@injectable()
export class LlmSecretsService implements ILlmSecretsService {
  private readonly SECRET_PREFIX = 'ptah.llm';

  constructor(
    @inject(TOKENS.EXTENSION_CONTEXT)
    private readonly context: vscode.ExtensionContext,
    @inject(TOKENS.LOGGER)
    private readonly logger: Logger
  ) {
    this.logger.info('[LlmSecretsService.constructor] Service initialized');
  }

  /**
   * Get the secret storage key for a provider
   */
  private getSecretKey(provider: LlmProviderName): string {
    return `${this.SECRET_PREFIX}.${provider}.apiKey`;
  }

  /**
   * Get API key for a provider from SecretStorage.
   *
   * Returns undefined for vscode-lm (no API key needed).
   * Keys are stored encrypted by VS Code's SecretStorage API.
   *
   * @param provider - Provider name to get API key for
   * @returns API key string, or undefined if not set or provider is vscode-lm
   *
   * @example
   * ```typescript
   * const apiKey = await secretsService.getApiKey('vscode-lm');
   * // Returns undefined for vscode-lm (no API key needed)
   * ```
   */
  async getApiKey(provider: LlmProviderName): Promise<string | undefined> {
    // VS Code LM doesn't need an API key
    if (provider === 'vscode-lm') {
      return undefined;
    }

    const secretKey = this.getSecretKey(provider);
    const apiKey = await this.context.secrets.get(secretKey);

    this.logger.debug(
      '[LlmSecretsService.getApiKey] Retrieved API key status',
      {
        provider,
        hasKey: !!apiKey,
      }
    );

    return apiKey;
  }

  /**
   * Store API key for a provider in SecretStorage.
   *
   * Validates key format before storing (provider-specific validation).
   * Keys are encrypted by VS Code's SecretStorage API.
   * Ignores vscode-lm (no API key needed).
   *
   * @param provider - Provider name to store API key for
   * @param key - API key to store (will be validated)
   * @throws Error if key format is invalid for the provider
   *
   * @example
   * ```typescript
   * // vscode-lm does not require an API key; calling setApiKey is a no-op
   * await secretsService.setApiKey('vscode-lm', 'any-value');
   * // Logs a warning and returns immediately
   * ```
   */
  async setApiKey(provider: LlmProviderName, key: string): Promise<void> {
    // VS Code LM doesn't use API keys
    if (provider === 'vscode-lm') {
      this.logger.warn(
        '[LlmSecretsService.setApiKey] Attempted to set API key for vscode-lm (not needed)',
        { provider }
      );
      return;
    }

    // Validate key format
    if (!this.validateKeyFormat(provider, key)) {
      throw new Error(`Invalid API key format for provider: ${provider}`);
    }

    const secretKey = this.getSecretKey(provider);
    await this.context.secrets.store(secretKey, key);

    this.logger.info('API key stored', {
      provider,
      keyLength: key.length,
    });
  }

  /**
   * Delete API key for a provider from SecretStorage.
   *
   * Removes the encrypted key from VS Code's SecretStorage.
   * Ignores vscode-lm (no API key needed).
   *
   * @param provider - Provider name to delete API key for
   *
   * @example
   * ```typescript
   * // vscode-lm does not use API keys; calling deleteApiKey is a no-op
   * await secretsService.deleteApiKey('vscode-lm');
   * ```
   */
  async deleteApiKey(provider: LlmProviderName): Promise<void> {
    // VS Code LM doesn't use API keys
    if (provider === 'vscode-lm') {
      return;
    }

    const secretKey = this.getSecretKey(provider);
    await this.context.secrets.delete(secretKey);

    this.logger.info(
      '[LlmSecretsService.deleteApiKey] API key deleted successfully',
      { provider }
    );
  }

  /**
   * Check if provider has a configured API key.
   *
   * Checks SecretStorage for the provider's API key.
   * Always returns true for vscode-lm (no API key needed).
   *
   * @param provider - Provider name to check
   * @returns true if API key is configured (vscode-lm always returns true)
   *
   * @example
   * ```typescript
   * if (await secretsService.hasApiKey('vscode-lm')) {
   *   console.log('VS Code LM is available (always true, no API key needed)');
   * }
   * ```
   */
  async hasApiKey(provider: LlmProviderName): Promise<boolean> {
    // VS Code LM is always available (no API key needed)
    if (provider === 'vscode-lm') {
      return true;
    }

    const key = await this.getApiKey(provider);
    return !!key && key.length > 0;
  }

  /**
   * Get list of providers that have API keys configured.
   *
   * Checks SecretStorage for each provider's API key.
   * Always includes vscode-lm (no API key needed).
   *
   * @returns Array of provider names with configured keys (e.g., ['vscode-lm'])
   *
   * @example
   * ```typescript
   * const configured = await secretsService.getConfiguredProviders();
   * console.log(`Configured providers: ${configured.join(', ')}`);
   * ```
   */
  async getConfiguredProviders(): Promise<LlmProviderName[]> {
    const providers: LlmProviderName[] = ['vscode-lm']; // Always available

    // Check each API key provider
    for (const provider of API_KEY_PROVIDERS) {
      if (await this.hasApiKey(provider)) {
        providers.push(provider);
      }
    }

    this.logger.debug(
      '[LlmSecretsService.getConfiguredProviders] Retrieved configured providers',
      {
        count: providers.length,
        providers,
      }
    );

    return providers;
  }

  /**
   * Validate API key format for a provider.
   *
   * Only vscode-lm is supported, which does not use API keys.
   * Always returns false since no API key validation is needed.
   *
   * @param provider - Provider name to validate key for
   * @param key - API key to validate
   * @returns Always false (vscode-lm does not use API keys)
   *
   * @example
   * ```typescript
   * // vscode-lm never needs API key validation
   * secretsService.validateKeyFormat('vscode-lm', 'any'); // false
   * ```
   */
  validateKeyFormat(provider: LlmProviderName, key: string): boolean {
    if (!key || key.trim().length === 0) {
      return false;
    }

    switch (provider) {
      case 'vscode-lm':
        // VS Code LM doesn't use API keys
        return false;

      default:
        return false;
    }
  }
}
