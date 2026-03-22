/**
 * Settings Import Service
 * TASK_2025_210: Imports a PtahSettingsExport object into the current platform's storage.
 *
 * Platform-agnostic — uses ISecretStorage and IWorkspaceProvider via PLATFORM_TOKENS.
 *
 * Import rules:
 * - Validates schema version before processing (rejects unknown versions)
 * - Never overwrites existing credentials unless explicitly requested
 * - Graceful failure: if one key fails, continues with remaining keys
 * - Returns a detailed SettingsImportResult summary
 *
 * SECURITY: Never logs imported secret values.
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
  providerSecretKey,
  type PtahSettingsExport,
  type SettingsImportResult,
} from './types/settings-export.types';

/** Options controlling import behavior */
export interface SettingsImportOptions {
  /**
   * When true, existing credentials will be overwritten.
   * When false (default), existing credentials are skipped.
   */
  overwrite?: boolean;
}

@injectable()
export class SettingsImportService {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(PLATFORM_TOKENS.SECRET_STORAGE)
    private readonly secretStorage: ISecretStorage,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspaceProvider: IWorkspaceProvider
  ) {}

  /**
   * Import settings from a previously exported PtahSettingsExport object.
   *
   * @param data - The parsed export data (caller handles file I/O and JSON parsing)
   * @param options - Import options (overwrite behavior)
   * @returns Detailed summary of imported, skipped, and errored keys
   */
  async importSettings(
    data: PtahSettingsExport,
    options: SettingsImportOptions = {}
  ): Promise<SettingsImportResult> {
    const { overwrite = false } = options;

    this.logger.info('[SettingsImport] Starting import', {
      version: data.version,
      source: data.source,
      overwrite,
    });

    // Step 1: Validate schema version
    const validationError = this.validateExportData(data);
    if (validationError) {
      this.logger.error('[SettingsImport] Validation failed', {
        error: validationError,
      });
      return {
        imported: [],
        skipped: [],
        errors: [validationError],
      };
    }

    const result: SettingsImportResult = {
      imported: [],
      skipped: [],
      errors: [],
    };

    // Step 2: Import secrets
    await this.importSecret(
      SECRET_KEYS.LICENSE_KEY,
      data.licenseKey,
      overwrite,
      result
    );
    await this.importSecret(
      SECRET_KEYS.OAUTH_TOKEN,
      data.auth.oauthToken,
      overwrite,
      result
    );
    await this.importSecret(
      SECRET_KEYS.API_KEY,
      data.auth.apiKey,
      overwrite,
      result
    );

    // Step 3: Import per-provider keys
    if (data.auth.providerKeys) {
      for (const [providerId, value] of Object.entries(
        data.auth.providerKeys
      )) {
        const secretKey = providerSecretKey(providerId);
        await this.importSecret(secretKey, value, overwrite, result);
      }
    }

    // Step 4: Import configuration values
    // Config keys are non-sensitive; we import them via workspace config update.
    // Note: IWorkspaceProvider only has getConfiguration, not setConfiguration.
    // Config values are stored back into ISecretStorage is not appropriate here;
    // instead we store them as state. For now, config import stores config
    // values as prefixed keys in ISecretStorage with a config: prefix so
    // they survive cross-platform transfer. The consuming app can read them
    // back on startup.
    // UPDATE: Since IWorkspaceProvider doesn't expose a write method, and
    // the config values are non-sensitive display preferences, we store them
    // in a single serialized key in secret storage for the consuming platform
    // to apply on its own.
    if (data.config && Object.keys(data.config).length > 0) {
      await this.importConfigBundle(data.config, overwrite, result);
    }

    this.logger.info('[SettingsImport] Import complete', {
      imported: result.imported.length,
      skipped: result.skipped.length,
      errors: result.errors.length,
    });

    return result;
  }

  // ------------------------------------------------------------------
  // Validation
  // ------------------------------------------------------------------

  /**
   * Validate the export data structure and version.
   * Returns an error string if invalid, undefined if valid.
   */
  private validateExportData(data: unknown): string | undefined {
    if (!data || typeof data !== 'object') {
      return 'Import data is not a valid object';
    }

    const obj = data as Record<string, unknown>;

    if (obj['version'] !== SETTINGS_EXPORT_VERSION) {
      return `Unsupported schema version: ${String(
        obj['version']
      )}. Expected version ${SETTINGS_EXPORT_VERSION}`;
    }

    if (typeof obj['exportedAt'] !== 'string') {
      return 'Missing or invalid exportedAt timestamp';
    }

    if (obj['source'] !== 'vscode' && obj['source'] !== 'electron') {
      return `Invalid source platform: ${String(obj['source'])}`;
    }

    if (!obj['auth'] || typeof obj['auth'] !== 'object') {
      return 'Missing or invalid auth section';
    }

    return undefined;
  }

  // ------------------------------------------------------------------
  // Secret import
  // ------------------------------------------------------------------

  /**
   * Import a single secret key.
   * - If the value is absent/empty in the export, do nothing.
   * - If a value already exists and overwrite is false, skip it.
   * - Otherwise store the value.
   */
  private async importSecret(
    key: string,
    value: string | undefined,
    overwrite: boolean,
    result: SettingsImportResult
  ): Promise<void> {
    if (!value) {
      return; // Nothing to import for this key
    }

    try {
      const existing = await this.secretStorage.get(key);

      if (existing && !overwrite) {
        result.skipped.push(key);
        this.logger.debug('[SettingsImport] Skipped existing secret', {
          key,
          reason: 'already exists',
        });
        return;
      }

      await this.secretStorage.store(key, value);
      result.imported.push(key);
      this.logger.debug('[SettingsImport] Imported secret', { key });
    } catch (error) {
      const errorMsg = `${key}: ${
        error instanceof Error ? error.message : String(error)
      }`;
      result.errors.push(errorMsg);
      this.logger.warn('[SettingsImport] Failed to import secret', {
        key,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // ------------------------------------------------------------------
  // Config import
  // ------------------------------------------------------------------

  /**
   * Store the configuration bundle as a serialized JSON string in secret storage
   * under a well-known key. The consuming platform reads this key on startup
   * and applies the values to its workspace configuration.
   *
   * This approach is necessary because IWorkspaceProvider does not expose a
   * write/update method — it is read-only by design. The platform-specific
   * startup code (VS Code main.ts or Electron main.ts) is responsible for
   * reading this key and applying it to the actual configuration store.
   */
  private async importConfigBundle(
    config: Record<string, unknown>,
    overwrite: boolean,
    result: SettingsImportResult
  ): Promise<void> {
    const configKey = 'ptah.importedConfig';

    try {
      const existing = await this.secretStorage.get(configKey);

      if (existing && !overwrite) {
        result.skipped.push('config (bundle)');
        this.logger.debug('[SettingsImport] Skipped config bundle', {
          reason: 'already exists',
        });
        return;
      }

      const serialized = JSON.stringify(config);
      await this.secretStorage.store(configKey, serialized);

      const configKeys = Object.keys(config);
      for (const key of configKeys) {
        result.imported.push(`config:${key}`);
      }

      this.logger.info('[SettingsImport] Config bundle stored', {
        keyCount: configKeys.length,
      });
    } catch (error) {
      const errorMsg = `config (bundle): ${
        error instanceof Error ? error.message : String(error)
      }`;
      result.errors.push(errorMsg);
      this.logger.warn('[SettingsImport] Failed to store config bundle', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
