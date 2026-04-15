/**
 * Settings Import Service
 * TASK_2025_210: Imports a PtahSettingsExport object into the current platform's storage.
 *
 * Platform-agnostic — uses ISecretStorage via PLATFORM_TOKENS for secret import.
 * Config values are not imported because IWorkspaceProvider is read-only;
 * config keys are reported as skipped so the user knows to reconfigure manually.
 *
 * Import rules:
 * - Validates schema version before processing (rejects unknown versions)
 * - Validates provider IDs against KNOWN_PROVIDER_IDS (skips unknown)
 * - Never overwrites existing credentials unless explicitly requested
 * - Graceful failure: if one key fails, continues with remaining keys
 * - Returns a detailed SettingsImportResult summary
 *
 * SECURITY: Never logs imported secret values.
 */

import { injectable, inject } from 'tsyringe';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import type { ISecretStorage } from '@ptah-extension/platform-core';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import {
  SETTINGS_EXPORT_VERSION,
  SECRET_KEYS,
  KNOWN_PROVIDER_IDS,
  providerSecretKey,
  type PtahSettingsExport,
  type SettingsImportResult,
  type KnownProviderId,
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
    options: SettingsImportOptions = {},
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
      result,
    );
    await this.importSecret(
      SECRET_KEYS.API_KEY,
      data.auth.apiKey,
      overwrite,
      result,
    );

    // Step 3: Import per-provider keys (validated against known provider IDs)
    if (data.auth.providerKeys) {
      for (const [providerId, value] of Object.entries(
        data.auth.providerKeys,
      )) {
        if (!KNOWN_PROVIDER_IDS.includes(providerId as KnownProviderId)) {
          result.skipped.push(`provider:${providerId} (unknown provider ID)`);
          this.logger.warn('[SettingsImport] Skipped unknown provider ID', {
            providerId,
          });
          continue;
        }
        const secretKey = providerSecretKey(providerId);
        await this.importSecret(secretKey, value, overwrite, result);
      }
    }

    // Step 4: Skip config values (IWorkspaceProvider is read-only)
    // Config import is not supported because IWorkspaceProvider does not
    // expose a write/update method. Config keys are reported as skipped
    // so the user is aware they need to reconfigure manually.
    if (data.config && Object.keys(data.config).length > 0) {
      const configKeys = Object.keys(data.config);
      for (const key of configKeys) {
        result.skipped.push(`config:${key} (config import not supported)`);
      }
      this.logger.info('[SettingsImport] Config keys skipped (read-only)', {
        keyCount: configKeys.length,
      });
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
        obj['version'],
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

    if (
      obj['config'] !== undefined &&
      (typeof obj['config'] !== 'object' ||
        obj['config'] === null ||
        Array.isArray(obj['config']))
    ) {
      return 'Invalid config section: expected a plain object';
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
    result: SettingsImportResult,
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
}
