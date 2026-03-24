/**
 * API Key Service for Ptah Electron
 *
 * TASK_2025_200 Batch 5, Task 5.2
 *
 * Centralizes API key management logic for the Electron app.
 * Encapsulates the flow: store/retrieve/validate API keys via ISecretStorage,
 * sync keys to process.env for SDK adapters, and provide status checks.
 *
 * This service is used by:
 *   - main.ts (Phase 3) to load saved keys on startup
 *   - RPC handlers (auth:setApiKey, auth:getApiKeyStatus, llm:setApiKey)
 *   - Application menu (future: settings panel)
 */

import type { ISecretStorage } from '@ptah-extension/platform-core';

/** Supported API key provider identifiers. */
export type ApiKeyProvider = 'anthropic' | 'openrouter';

/** Environment variable names for each provider. */
const PROVIDER_ENV_VARS: Record<ApiKeyProvider, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
};

/** Secret storage key prefix. Keys are stored as `ptah.apiKey.<provider>`. */
const STORAGE_KEY_PREFIX = 'ptah.apiKey';

/** Status result for a single provider (does not expose the key value). */
export interface ApiKeyStatus {
  provider: ApiKeyProvider;
  displayName: string;
  hasApiKey: boolean;
  isDefault: boolean;
}

/**
 * Service that manages API key lifecycle: store, load, remove, and status.
 *
 * All methods operate through ISecretStorage (Electron safeStorage under the hood)
 * and synchronize keys into process.env so that Claude Agent SDK and other
 * adapters can read them without depending on platform-specific storage.
 */
export class ApiKeyService {
  constructor(private readonly secretStorage: ISecretStorage) {}

  /**
   * Store an API key for a provider.
   * Persists to secret storage AND sets the corresponding environment variable.
   */
  async setApiKey(provider: ApiKeyProvider, apiKey: string): Promise<void> {
    const storageKey = `${STORAGE_KEY_PREFIX}.${provider}`;
    await this.secretStorage.store(storageKey, apiKey);

    const envVar = PROVIDER_ENV_VARS[provider];
    if (envVar) {
      process.env[envVar] = apiKey;
    }
  }

  /**
   * Load an API key from secret storage and set it in process.env.
   * Returns true if a key was found, false otherwise.
   * Called on app startup (Phase 3 in main.ts).
   */
  async loadApiKey(provider: ApiKeyProvider): Promise<boolean> {
    const storageKey = `${STORAGE_KEY_PREFIX}.${provider}`;
    const apiKey = await this.secretStorage.get(storageKey);

    if (apiKey) {
      const envVar = PROVIDER_ENV_VARS[provider];
      if (envVar) {
        process.env[envVar] = apiKey;
      }
      return true;
    }
    return false;
  }

  /**
   * Remove a stored API key for a provider.
   * Clears both secret storage and the environment variable.
   */
  async removeApiKey(provider: ApiKeyProvider): Promise<void> {
    const storageKey = `${STORAGE_KEY_PREFIX}.${provider}`;
    await this.secretStorage.delete(storageKey);

    const envVar = PROVIDER_ENV_VARS[provider];
    if (envVar) {
      delete process.env[envVar];
    }
  }

  /**
   * Get the configuration status of all supported providers.
   * Returns an array of ApiKeyStatus objects (never exposes actual key values).
   */
  async getApiKeyStatus(): Promise<ApiKeyStatus[]> {
    const anthropicKey = await this.secretStorage.get(
      `${STORAGE_KEY_PREFIX}.anthropic`
    );
    const openrouterKey = await this.secretStorage.get(
      `${STORAGE_KEY_PREFIX}.openrouter`
    );

    return [
      {
        provider: 'anthropic',
        displayName: 'Anthropic (Claude)',
        hasApiKey: !!anthropicKey,
        isDefault: true,
      },
      {
        provider: 'openrouter',
        displayName: 'OpenRouter',
        hasApiKey: !!openrouterKey,
        isDefault: false,
      },
    ];
  }

  /**
   * Check whether any API key is configured (for quick auth-gate checks).
   */
  async hasAnyApiKey(): Promise<boolean> {
    const statuses = await this.getApiKeyStatus();
    return statuses.some((s) => s.hasApiKey);
  }

  /**
   * Basic format validation for API key strings.
   * Does NOT verify the key is valid with the provider -- just checks format.
   */
  validateKeyFormat(
    provider: ApiKeyProvider,
    apiKey: string
  ): { valid: boolean; error?: string } {
    const trimmed = apiKey.trim();
    if (trimmed.length === 0) {
      return { valid: false, error: 'API key cannot be empty' };
    }

    if (provider === 'anthropic') {
      if (!trimmed.startsWith('sk-ant-')) {
        return {
          valid: false,
          error: 'Anthropic API keys start with "sk-ant-"',
        };
      }
      if (trimmed.length < 20) {
        return { valid: false, error: 'API key is too short' };
      }
      return { valid: true };
    }

    if (provider === 'openrouter') {
      if (!trimmed.startsWith('sk-or-')) {
        return {
          valid: false,
          error: 'OpenRouter API keys start with "sk-or-"',
        };
      }
      if (trimmed.length < 20) {
        return { valid: false, error: 'API key is too short' };
      }
      return { valid: true };
    }

    // Unknown provider -- accept if reasonably long
    return trimmed.length > 10
      ? { valid: true }
      : { valid: false, error: 'API key is too short' };
  }
}
