/**
 * Settings Export Service
 * TASK_2025_210: Collects all exportable settings into a PtahSettingsExport object.
 *
 * Platform-agnostic — uses ISecretStorage and IWorkspaceProvider via PLATFORM_TOKENS
 * so the same service works in both VS Code and Electron.
 *
 * SECURITY: Never logs actual secret values. Only logs key names and has/missing booleans.
 */

import { injectable, inject } from 'tsyringe';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import type {
  ISecretStorage,
  IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import {
  SETTINGS_EXPORT_VERSION,
  SECRET_KEYS,
  KNOWN_PROVIDER_IDS,
  KNOWN_CONFIG_KEYS,
  providerSecretKey,
  countPopulatedSecrets,
  type PtahSettingsExport,
} from './types/settings-export.types';

@injectable()
export class SettingsExportService {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(PLATFORM_TOKENS.SECRET_STORAGE)
    private readonly secretStorage: ISecretStorage,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspaceProvider: IWorkspaceProvider,
  ) {}

  /**
   * Collect all exportable settings from the current platform.
   *
   * Gathers secrets from ISecretStorage and configuration values from
   * IWorkspaceProvider. Missing keys are silently skipped — the caller
   * receives a valid PtahSettingsExport even when some values are absent.
   *
   * @param source - Which platform is performing the export
   * @returns A complete, versioned export object ready for JSON serialization
   */
  async collectSettings(
    source: 'vscode' | 'electron',
  ): Promise<PtahSettingsExport> {
    this.logger.info('[SettingsExport] Collecting settings', { source });

    const [licenseKey, apiKey, providerKeys, config] = await Promise.all([
      this.getSecret(SECRET_KEYS.LICENSE_KEY),
      this.getSecret(SECRET_KEYS.API_KEY),
      this.collectProviderKeys(),
      this.collectConfigValues(),
    ]);

    const exportData: PtahSettingsExport = {
      version: SETTINGS_EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      source,
      auth: {
        ...(apiKey ? { apiKey } : {}),
        ...(Object.keys(providerKeys).length > 0 ? { providerKeys } : {}),
      },
      config,
    };

    // Only include licenseKey field when a value exists
    if (licenseKey) {
      exportData.licenseKey = licenseKey;
    }

    const secretCount = countPopulatedSecrets(exportData);
    const configCount = Object.keys(config).length;

    this.logger.info('[SettingsExport] Collection complete', {
      source,
      secretCount,
      configCount,
    });

    return exportData;
  }

  // ------------------------------------------------------------------
  // Private helpers
  // ------------------------------------------------------------------

  /**
   * Read a single secret, logging only the key name and presence.
   */
  private async getSecret(key: string): Promise<string | undefined> {
    try {
      const value = await this.secretStorage.get(key);
      this.logger.debug('[SettingsExport] Secret read', {
        key,
        hasValue: !!value,
      });
      return value;
    } catch (error) {
      this.logger.warn('[SettingsExport] Failed to read secret', {
        key,
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }

  /**
   * Iterate over known provider IDs and collect any that have API keys stored.
   */
  private async collectProviderKeys(): Promise<Record<string, string>> {
    const keys: Record<string, string> = {};

    for (const providerId of KNOWN_PROVIDER_IDS) {
      const secretKey = providerSecretKey(providerId);
      try {
        const value = await this.secretStorage.get(secretKey);
        if (value) {
          keys[providerId] = value;
          this.logger.debug('[SettingsExport] Provider key found', {
            providerId,
            hasValue: true,
          });
        }
      } catch (error) {
        this.logger.warn('[SettingsExport] Failed to read provider key', {
          providerId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return keys;
  }

  /**
   * Enumerate all known configuration keys via IWorkspaceProvider.getConfiguration.
   * Skips undefined values so the export only contains explicitly set config.
   */
  private collectConfigValues(): Record<string, unknown> {
    const config: Record<string, unknown> = {};

    for (const key of KNOWN_CONFIG_KEYS) {
      try {
        const value = this.workspaceProvider.getConfiguration<unknown>(
          'ptah',
          key,
        );
        if (value !== undefined) {
          config[key] = value;
        }
      } catch (error) {
        this.logger.warn('[SettingsExport] Failed to read config key', {
          key,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return config;
  }
}
