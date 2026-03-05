/**
 * Ptah CLI Config Persistence Service
 *
 * Injectable singleton responsible for loading, saving, and migrating
 * Ptah CLI agent configurations from VS Code's ConfigManager.
 *
 * @see TASK_2025_176 - PtahCliRegistry refactoring
 */

import { injectable, inject } from 'tsyringe';
import type { PtahCliConfig } from '@ptah-extension/shared';
import {
  Logger,
  TOKENS,
  type ConfigManager,
  type IAuthSecretsService,
} from '@ptah-extension/vscode-core';
import {
  PTAH_CLI_KEY_PREFIX,
  PTAH_CLI_AGENTS_CONFIG_KEY,
} from './ptah-cli-registry.utils';

@injectable()
export class PtahCliConfigPersistence {
  /** Cached migration promise to ensure one-time execution */
  private migrationPromise: Promise<void> | null = null;

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.CONFIG_MANAGER) private readonly config: ConfigManager,
    @inject(TOKENS.AUTH_SECRETS_SERVICE)
    private readonly authSecrets: IAuthSecretsService
  ) {}

  /**
   * Load Ptah CLI configs from ConfigManager
   */
  loadConfigs(): PtahCliConfig[] {
    return this.config.getWithDefault<PtahCliConfig[]>(
      PTAH_CLI_AGENTS_CONFIG_KEY,
      []
    );
  }

  /**
   * Save Ptah CLI configs to ConfigManager
   */
  async saveConfigs(configs: PtahCliConfig[]): Promise<void> {
    await this.config.set(PTAH_CLI_AGENTS_CONFIG_KEY, configs);
  }

  /**
   * Ensure legacy config/secret migration has run exactly once.
   * Safe to call multiple times; the migration promise is cached.
   */
  async ensureMigrated(): Promise<void> {
    if (!this.migrationPromise) {
      this.migrationPromise = this.migrateFromLegacyKeys();
    }
    return this.migrationPromise;
  }

  /**
   * One-time migration from legacy customAgents config key and secret prefix.
   * Reads from old key, writes to new key, migrates secret storage prefixes.
   */
  private async migrateFromLegacyKeys(): Promise<void> {
    const LEGACY_CONFIG_KEY = 'customAgents';
    const LEGACY_KEY_PREFIX = 'customAgent';

    const legacyConfigs = this.config.getWithDefault<PtahCliConfig[]>(
      LEGACY_CONFIG_KEY,
      []
    );
    if (legacyConfigs.length === 0) return;

    const currentConfigs = this.config.getWithDefault<PtahCliConfig[]>(
      PTAH_CLI_AGENTS_CONFIG_KEY,
      []
    );
    if (currentConfigs.length > 0) return;

    this.logger.info(
      '[PtahCliConfigPersistence] Migrating legacy customAgents config...'
    );

    await this.config.set(PTAH_CLI_AGENTS_CONFIG_KEY, legacyConfigs);

    for (const agentConfig of legacyConfigs) {
      try {
        const legacyKey = await this.authSecrets.getProviderKey(
          `${LEGACY_KEY_PREFIX}.${agentConfig.id}`
        );
        if (legacyKey) {
          await this.authSecrets.setProviderKey(
            `${PTAH_CLI_KEY_PREFIX}.${agentConfig.id}`,
            legacyKey
          );
          await this.authSecrets.deleteProviderKey(
            `${LEGACY_KEY_PREFIX}.${agentConfig.id}`
          );
        }
      } catch {
        this.logger.warn(
          `[PtahCliConfigPersistence] Failed to migrate secret for agent ${agentConfig.id}`
        );
      }
    }

    await this.config.set(LEGACY_CONFIG_KEY, undefined);

    this.logger.info(
      `[PtahCliConfigPersistence] Migrated ${legacyConfigs.length} agents to new config key`
    );
  }
}
