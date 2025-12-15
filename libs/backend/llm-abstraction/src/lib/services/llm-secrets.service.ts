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
 * All provider names that require API keys
 */
export const API_KEY_PROVIDERS: readonly LlmProviderName[] = [
  'anthropic',
  'openai',
  'google-genai',
  'openrouter',
] as const;

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
    this.logger.info('[LlmSecretsService] Initialized');
  }

  /**
   * Get the secret storage key for a provider
   */
  private getSecretKey(provider: LlmProviderName): string {
    return `${this.SECRET_PREFIX}.${provider}.apiKey`;
  }

  async getApiKey(provider: LlmProviderName): Promise<string | undefined> {
    // VS Code LM doesn't need an API key
    if (provider === 'vscode-lm') {
      return undefined;
    }

    const secretKey = this.getSecretKey(provider);
    const apiKey = await this.context.secrets.get(secretKey);

    this.logger.debug('[LlmSecretsService] getApiKey', {
      provider,
      hasKey: !!apiKey,
    });

    return apiKey;
  }

  async setApiKey(provider: LlmProviderName, key: string): Promise<void> {
    // VS Code LM doesn't use API keys
    if (provider === 'vscode-lm') {
      this.logger.warn(
        '[LlmSecretsService] Attempted to set API key for vscode-lm (not needed)'
      );
      return;
    }

    // Validate key format
    if (!this.validateKeyFormat(provider, key)) {
      throw new Error(`Invalid API key format for provider: ${provider}`);
    }

    const secretKey = this.getSecretKey(provider);
    await this.context.secrets.store(secretKey, key);

    this.logger.info('[LlmSecretsService] API key stored', {
      provider,
      keyLength: key.length,
      keyPrefix: key.substring(0, 10) + '...',
    });
  }

  async deleteApiKey(provider: LlmProviderName): Promise<void> {
    // VS Code LM doesn't use API keys
    if (provider === 'vscode-lm') {
      return;
    }

    const secretKey = this.getSecretKey(provider);
    await this.context.secrets.delete(secretKey);

    this.logger.info('[LlmSecretsService] API key deleted', { provider });
  }

  async hasApiKey(provider: LlmProviderName): Promise<boolean> {
    // VS Code LM is always available (no API key needed)
    if (provider === 'vscode-lm') {
      return true;
    }

    const key = await this.getApiKey(provider);
    return !!key && key.length > 0;
  }

  async getConfiguredProviders(): Promise<LlmProviderName[]> {
    const providers: LlmProviderName[] = ['vscode-lm']; // Always available

    // Check each API key provider
    for (const provider of API_KEY_PROVIDERS) {
      if (await this.hasApiKey(provider)) {
        providers.push(provider);
      }
    }

    this.logger.debug('[LlmSecretsService] getConfiguredProviders', {
      providers,
    });

    return providers;
  }

  validateKeyFormat(provider: LlmProviderName, key: string): boolean {
    if (!key || key.trim().length === 0) {
      return false;
    }

    const trimmedKey = key.trim();

    switch (provider) {
      case 'anthropic':
        // Anthropic API keys start with 'sk-ant-api' or similar
        return trimmedKey.startsWith('sk-ant-') && trimmedKey.length >= 20;

      case 'openai':
        // OpenAI API keys start with 'sk-'
        return trimmedKey.startsWith('sk-') && trimmedKey.length >= 20;

      case 'google-genai':
        // Google API keys are typically 39 characters
        return trimmedKey.length >= 30;

      case 'openrouter':
        // OpenRouter API keys start with 'sk-or-'
        return trimmedKey.startsWith('sk-or-') && trimmedKey.length >= 20;

      case 'vscode-lm':
        // VS Code LM doesn't use API keys
        return false;

      default:
        return false;
    }
  }
}
