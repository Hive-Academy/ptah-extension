/**
 * Auth Secrets Service
 *
 * Manages SDK authentication credentials using VS Code's SecretStorage.
 * SecretStorage provides encrypted, secure storage for sensitive data.
 *
 * TASK_2025_076: Secure credential storage for OAuth token and API key
 *
 * @packageDocumentation
 */

import { injectable, inject } from 'tsyringe';
import * as vscode from 'vscode';
import { Logger } from '../logging';
import { ConfigManager } from '../config';
import { TOKENS } from '../di/tokens';

/**
 * Auth credential types supported by this service
 */
export type AuthCredentialType = 'oauthToken' | 'apiKey';

/**
 * Interface for auth secrets management
 */
export interface IAuthSecretsService {
  /**
   * Get credential from SecretStorage
   * @param type - Credential type ('oauthToken' or 'apiKey')
   * @returns Credential value or undefined if not set
   *
   * @example
   * ```typescript
   * const token = await authSecrets.getCredential('oauthToken');
   * if (token) {
   *   console.log('OAuth token is configured');
   * }
   * ```
   */
  getCredential(type: AuthCredentialType): Promise<string | undefined>;

  /**
   * Store credential in SecretStorage
   * @param type - Credential type ('oauthToken' or 'apiKey')
   * @param value - Credential value to store. Empty string deletes the credential.
   *
   * @example
   * ```typescript
   * await authSecrets.setCredential('oauthToken', 'sk-ant-oat01-xxx');
   * // To delete:
   * await authSecrets.setCredential('oauthToken', '');
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
   * const hasOAuth = await authSecrets.hasCredential('oauthToken');
   * const hasApiKey = await authSecrets.hasCredential('apiKey');
   * ```
   */
  hasCredential(type: AuthCredentialType): Promise<boolean>;

  /**
   * Migrate credentials from ConfigManager to SecretStorage (one-time operation)
   * @returns Object indicating which credentials were migrated
   *
   * @example
   * ```typescript
   * const result = await authSecrets.migrateFromConfigManager();
   * if (result.oauthMigrated || result.apiKeyMigrated) {
   *   console.log('Credentials migrated to secure storage');
   * }
   * ```
   */
  migrateFromConfigManager(): Promise<{
    oauthMigrated: boolean;
    apiKeyMigrated: boolean;
  }>;
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
    oauthToken: 'claudeOAuthToken',
    apiKey: 'anthropicApiKey',
  };

  constructor(
    @inject(TOKENS.EXTENSION_CONTEXT)
    private readonly context: vscode.ExtensionContext,
    @inject(TOKENS.LOGGER)
    private readonly logger: Logger,
    @inject(TOKENS.CONFIG_MANAGER)
    private readonly configManager: ConfigManager
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
   * Get the config manager key for a credential type (for migration)
   * @param type - Credential type
   * @returns Config key without prefix
   */
  private getConfigKey(type: AuthCredentialType): string {
    return this.KEY_MAP[type];
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
   * const token = await authSecrets.getCredential('oauthToken');
   * if (token) {
   *   console.log('OAuth token configured');
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
   * await authSecrets.setCredential('oauthToken', 'sk-ant-oat01-...');
   * console.log('OAuth token stored successfully');
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
      }
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
   * if (await authSecrets.hasCredential('oauthToken')) {
   *   console.log('OAuth token is configured');
   * } else {
   *   console.log('Please configure OAuth token');
   * }
   * ```
   */
  async hasCredential(type: AuthCredentialType): Promise<boolean> {
    const value = await this.getCredential(type);
    return !!value && value.length > 0;
  }

  /**
   * Migrate credentials from ConfigManager to SecretStorage.
   *
   * One-time migration for users who previously stored credentials
   * in plain-text VS Code settings. After migration:
   * 1. Credentials are stored in encrypted SecretStorage
   * 2. Plain-text settings values are cleared
   *
   * Safe to call multiple times - only migrates if SecretStorage is empty
   * and ConfigManager has a value.
   *
   * TASK_2025_076 Batch 2 - Task 2.3: Added rollback mechanism for safety.
   * If migration fails mid-way, credentials are restored to ConfigManager.
   * Each credential type is migrated independently for partial success.
   *
   * @returns Object with migration status for each credential type
   *
   * @example
   * ```typescript
   * const result = await authSecrets.migrateFromConfigManager();
   * if (result.oauthMigrated) {
   *   console.log('OAuth token migrated to SecretStorage');
   * }
   * ```
   */
  async migrateFromConfigManager(): Promise<{
    oauthMigrated: boolean;
    apiKeyMigrated: boolean;
  }> {
    let oauthMigrated = false;
    let apiKeyMigrated = false;

    // Backup original values for rollback
    const oauthConfigKey = this.getConfigKey('oauthToken');
    const apiKeyConfigKey = this.getConfigKey('apiKey');
    const originalOAuth = this.configManager.get<string>(oauthConfigKey);
    const originalApiKey = this.configManager.get<string>(apiKeyConfigKey);

    // Migrate OAuth token (isolated try-catch for partial success)
    try {
      if (originalOAuth?.trim()) {
        // Check if already in SecretStorage
        const existingOauth = await this.hasCredential('oauthToken');
        if (!existingOauth) {
          await this.setCredential('oauthToken', originalOAuth);
          // Clear from ConfigManager (plain text)
          await this.configManager.set(oauthConfigKey, '');
          oauthMigrated = true;
          this.logger.info(
            '[AuthSecretsService.migrateFromConfigManager] OAuth token migrated to SecretStorage'
          );
        }
      }
    } catch (error) {
      this.logger.error(
        '[AuthSecretsService.migrateFromConfigManager] OAuth migration failed, rolling back',
        error instanceof Error ? error : new Error(String(error))
      );
      // Rollback: Restore original value to ConfigManager
      if (originalOAuth) {
        try {
          await this.configManager.set(oauthConfigKey, originalOAuth);
          this.logger.info(
            '[AuthSecretsService.migrateFromConfigManager] OAuth token rolled back to ConfigManager'
          );
        } catch (rollbackError) {
          this.logger.error(
            '[AuthSecretsService.migrateFromConfigManager] OAuth rollback failed - data may be lost',
            rollbackError instanceof Error
              ? rollbackError
              : new Error(String(rollbackError))
          );
        }
      }
    }

    // Migrate API key (isolated try-catch for partial success)
    try {
      if (originalApiKey?.trim()) {
        // Check if already in SecretStorage
        const existingApiKey = await this.hasCredential('apiKey');
        if (!existingApiKey) {
          await this.setCredential('apiKey', originalApiKey);
          // Clear from ConfigManager (plain text)
          await this.configManager.set(apiKeyConfigKey, '');
          apiKeyMigrated = true;
          this.logger.info(
            '[AuthSecretsService.migrateFromConfigManager] API key migrated to SecretStorage'
          );
        }
      }
    } catch (error) {
      this.logger.error(
        '[AuthSecretsService.migrateFromConfigManager] API key migration failed, rolling back',
        error instanceof Error ? error : new Error(String(error))
      );
      // Rollback: Restore original value to ConfigManager
      if (originalApiKey) {
        try {
          await this.configManager.set(apiKeyConfigKey, originalApiKey);
          this.logger.info(
            '[AuthSecretsService.migrateFromConfigManager] API key rolled back to ConfigManager'
          );
        } catch (rollbackError) {
          this.logger.error(
            '[AuthSecretsService.migrateFromConfigManager] API key rollback failed - data may be lost',
            rollbackError instanceof Error
              ? rollbackError
              : new Error(String(rollbackError))
          );
        }
      }
    }

    this.logger.debug(
      '[AuthSecretsService.migrateFromConfigManager] Migration complete',
      {
        oauthMigrated,
        apiKeyMigrated,
      }
    );

    return { oauthMigrated, apiKeyMigrated };
  }
}
