/**
 * Auth Secrets Service
 *
 * Manages SDK authentication credentials using VS Code's SecretStorage.
 * SecretStorage provides encrypted, secure storage for sensitive data.
 *
 * TASK_2025_076: Secure credential storage for API key
 *
 * @packageDocumentation
 */

import { injectable, inject } from 'tsyringe';
import type * as vscode from 'vscode';
import { Logger } from '../logging';
import { TOKENS } from '../di/tokens';

/**
 * Auth credential types supported by this service
 */
export type AuthCredentialType = 'apiKey';

/**
 * Interface for auth secrets management
 */
export interface IAuthSecretsService {
  /**
   * Get credential from SecretStorage
   * @param type - Credential type ('apiKey')
   * @returns Credential value or undefined if not set
   *
   * @example
   * ```typescript
   * const key = await authSecrets.getCredential('apiKey');
   * if (key) {
   *   console.log('API key is configured');
   * }
   * ```
   */
  getCredential(type: AuthCredentialType): Promise<string | undefined>;

  /**
   * Store credential in SecretStorage
   * @param type - Credential type ('apiKey')
   * @param value - Credential value to store. Empty string deletes the credential.
   *
   * @example
   * ```typescript
   * await authSecrets.setCredential('apiKey', 'sk-ant-api03-xxx');
   * // To delete:
   * await authSecrets.setCredential('apiKey', '');
   * ```
   */
  setCredential(type: AuthCredentialType, value: string): Promise<void>;

  /**
   * Delete credential from SecretStorage
   * @param type - Credential type to delete
   *
   * @example
   * ```typescript
   * await authSecrets.deleteCredential('apiKey');
   * ```
   */
  deleteCredential(type: AuthCredentialType): Promise<void>;

  /**
   * Check if credential exists in SecretStorage
   * Returns boolean only - NEVER the actual value
   * @param type - Credential type to check
   * @returns True if credential exists and has non-empty value
   *
   * @example
   * ```typescript
   * const hasApiKey = await authSecrets.hasCredential('apiKey');
   * ```
   */
  hasCredential(type: AuthCredentialType): Promise<boolean>;

  /**
   * Get API key for a specific Anthropic-compatible provider
   * @param providerId - Provider ID (e.g., 'openrouter', 'moonshot', 'z-ai')
   * @returns Provider API key or undefined if not set
   */
  getProviderKey(providerId: string): Promise<string | undefined>;

  /**
   * Store API key for a specific Anthropic-compatible provider
   * Each provider gets its own isolated storage slot.
   * @param providerId - Provider ID
   * @param value - API key to store. Empty string deletes the key.
   */
  setProviderKey(providerId: string, value: string): Promise<void>;

  /**
   * Delete API key for a specific provider
   * @param providerId - Provider ID
   */
  deleteProviderKey(providerId: string): Promise<void>;

  /**
   * Check if a specific provider has an API key configured
   * @param providerId - Provider ID
   * @returns True if provider key exists and is non-empty
   */
  hasProviderKey(providerId: string): Promise<boolean>;

  /**
   * Delete legacy secrets that are no longer used.
   * Call once during extension activation to clean up orphaned keys.
   */
  cleanupLegacySecrets(): Promise<void>;
}

/**
 * Auth Secrets Service Implementation
 *
 * Uses VS Code's SecretStorage for encrypted credential storage.
 * Keys are stored with prefix: `ptah.auth.{credentialType}`
 *
 * Pattern Reference: LlmSecretsService (llm-abstraction)
 *
 * Error Handling Pattern (similar to LlmSecretsService):
 * - Public methods may throw on storage failures
 * - SecretStorage errors propagate to caller for handling
 * - All errors are logged before throwing
 * - SECURITY: Never log actual credential values
 */
@injectable()
export class AuthSecretsService implements IAuthSecretsService {
  private readonly SECRET_PREFIX = 'ptah.auth';

  /**
   * Key mapping for credential types - single source of truth
   */
  private readonly KEY_MAP: Record<AuthCredentialType, string> = {
    apiKey: 'anthropicApiKey',
  };

  constructor(
    @inject(TOKENS.EXTENSION_CONTEXT)
    private readonly context: vscode.ExtensionContext,
    @inject(TOKENS.LOGGER)
    private readonly logger: Logger,
  ) {
    this.logger.info('[AuthSecretsService.constructor] Service initialized');
  }

  /**
   * Get the secret storage key for a credential type
   * @param type - Credential type
   * @returns Full secret storage key with prefix
   */
  private getSecretKey(type: AuthCredentialType): string {
    return `${this.SECRET_PREFIX}.${this.KEY_MAP[type]}`;
  }

  /**
   * Get credential from SecretStorage.
   *
   * Keys are stored encrypted by VS Code's SecretStorage API.
   *
   * @param type - Credential type to get
   * @returns Credential string, or undefined if not set
   *
   * @example
   * ```typescript
   * const key = await authSecrets.getCredential('apiKey');
   * if (key) {
   *   console.log('API key configured');
   * }
   * ```
   */
  async getCredential(type: AuthCredentialType): Promise<string | undefined> {
    const secretKey = this.getSecretKey(type);
    const value = await this.context.secrets.get(secretKey);

    this.logger.debug('[AuthSecretsService.getCredential] Retrieved status', {
      type,
      hasValue: !!value,
    });

    return value;
  }

  /**
   * Store credential in SecretStorage.
   *
   * Keys are encrypted by VS Code's SecretStorage API.
   * Empty or whitespace-only values trigger deletion.
   *
   * @param type - Credential type to store
   * @param value - Credential value to store (will be trimmed)
   *
   * @example
   * ```typescript
   * await authSecrets.setCredential('apiKey', 'sk-ant-api03-...');
   * console.log('API key stored successfully');
   * ```
   */
  async setCredential(type: AuthCredentialType, value: string): Promise<void> {
    if (!value || value.trim().length === 0) {
      // Empty value means delete
      await this.deleteCredential(type);
      return;
    }

    const secretKey = this.getSecretKey(type);
    await this.context.secrets.store(secretKey, value.trim());

    // SECURITY: Never log actual credential values
    this.logger.info('[AuthSecretsService.setCredential] Credential stored', {
      type,
      valueLength: value.length,
      // Removed valuePrefix for security - never log credential data
    });
  }

  /**
   * Delete credential from SecretStorage.
   *
   * Removes the encrypted key from VS Code's SecretStorage.
   *
   * @param type - Credential type to delete
   *
   * @example
   * ```typescript
   * await authSecrets.deleteCredential('apiKey');
   * console.log('API key removed');
   * ```
   */
  async deleteCredential(type: AuthCredentialType): Promise<void> {
    const secretKey = this.getSecretKey(type);
    await this.context.secrets.delete(secretKey);

    this.logger.info(
      '[AuthSecretsService.deleteCredential] Credential deleted',
      {
        type,
      },
    );
  }

  /**
   * Check if credential exists in SecretStorage.
   *
   * SECURITY: Returns boolean only - never the actual credential value.
   *
   * @param type - Credential type to check
   * @returns true if credential is configured and non-empty
   *
   * @example
   * ```typescript
   * if (await authSecrets.hasCredential('apiKey')) {
   *   console.log('API key is configured');
   * } else {
   *   console.log('Please configure API key');
   * }
   * ```
   */
  async hasCredential(type: AuthCredentialType): Promise<boolean> {
    const value = await this.getCredential(type);
    return !!value && value.length > 0;
  }

  // ================================================================
  // Per-provider key storage (each provider gets its own slot)
  // Storage key pattern: ptah.auth.provider.{providerId}
  // ================================================================

  /**
   * Get the secret storage key for a provider-specific API key
   */
  private getProviderSecretKey(providerId: string): string {
    return `${this.SECRET_PREFIX}.provider.${providerId}`;
  }

  /**
   * Get API key for a specific Anthropic-compatible provider.
   */
  async getProviderKey(providerId: string): Promise<string | undefined> {
    const secretKey = this.getProviderSecretKey(providerId);
    const value = await this.context.secrets.get(secretKey);

    this.logger.debug('[AuthSecretsService.getProviderKey] Retrieved status', {
      providerId,
      hasValue: !!value,
    });

    return value;
  }

  /**
   * Store API key for a specific Anthropic-compatible provider.
   * Each provider gets its own isolated storage slot to prevent overwriting.
   */
  async setProviderKey(providerId: string, value: string): Promise<void> {
    if (!value || value.trim().length === 0) {
      await this.deleteProviderKey(providerId);
      return;
    }

    const secretKey = this.getProviderSecretKey(providerId);
    await this.context.secrets.store(secretKey, value.trim());

    this.logger.info(
      '[AuthSecretsService.setProviderKey] Provider key stored',
      {
        providerId,
        valueLength: value.length,
      },
    );
  }

  /**
   * Delete API key for a specific provider.
   */
  async deleteProviderKey(providerId: string): Promise<void> {
    const secretKey = this.getProviderSecretKey(providerId);
    await this.context.secrets.delete(secretKey);

    this.logger.info(
      '[AuthSecretsService.deleteProviderKey] Provider key deleted',
      {
        providerId,
      },
    );
  }

  /**
   * Check if a specific provider has an API key configured.
   * SECURITY: Returns boolean only.
   */
  async hasProviderKey(providerId: string): Promise<boolean> {
    const value = await this.getProviderKey(providerId);
    return !!value && value.length > 0;
  }

  // ================================================================
  // Legacy secret cleanup
  // ================================================================

  /**
   * Keys that were removed from the codebase but may still exist in storage.
   * - `ptah.auth.claudeOAuthToken`: Removed for Anthropic TOS compliance.
   *   The Claude Agent SDK spawns the CLI binary which uses its own credential store.
   */
  private readonly LEGACY_KEYS = ['ptah.auth.claudeOAuthToken'];

  /**
   * Delete legacy secrets that are no longer used.
   * Safe to call multiple times — deleting a non-existent key is a no-op.
   */
  async cleanupLegacySecrets(): Promise<void> {
    for (const key of this.LEGACY_KEYS) {
      try {
        await this.context.secrets.delete(key);
        this.logger.info(
          '[AuthSecretsService.cleanupLegacySecrets] Deleted legacy key',
          { key },
        );
      } catch (error) {
        this.logger.warn(
          '[AuthSecretsService.cleanupLegacySecrets] Failed to delete legacy key',
          {
            key,
            error: error instanceof Error ? error.message : String(error),
          },
        );
      }
    }
  }
}
