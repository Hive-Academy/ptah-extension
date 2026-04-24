/**
 * Electron Settings RPC Handlers
 *
 * Handles settings export/import methods specific to Electron:
 * - settings:export - Collect settings, show native save dialog, write JSON file
 * - settings:import - Show native open dialog, read JSON file, import settings
 *
 * Uses SettingsExportService and SettingsImportService from @ptah-extension/agent-sdk
 * for platform-agnostic settings collection and import logic. File I/O and native
 * dialogs are handled here in the Electron-specific layer.
 *
 * TASK_2025_210 Batch 3: Electron RPC handler for settings export/import
 */

import { injectable, inject } from 'tsyringe';
import { TOKENS } from '@ptah-extension/vscode-core';
import type {
  Logger,
  RpcHandler,
  LicenseService,
} from '@ptah-extension/vscode-core';
import {
  SDK_TOKENS,
  countPopulatedSecrets,
  SECRET_KEYS,
  type SettingsExportService,
  type SettingsImportService,
  type PtahSettingsExport,
} from '@ptah-extension/agent-sdk';
import type { IPlatformCommands } from '@ptah-extension/rpc-handlers';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import type { ElectronWorkspaceProvider } from '@ptah-extension/platform-electron';

@injectable()
export class SettingsRpcHandlers {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(SDK_TOKENS.SDK_SETTINGS_EXPORT)
    private readonly settingsExportService: SettingsExportService,
    @inject(SDK_TOKENS.SDK_SETTINGS_IMPORT)
    private readonly settingsImportService: SettingsImportService,
    @inject(TOKENS.PLATFORM_COMMANDS)
    private readonly platformCommands: IPlatformCommands,
    @inject(TOKENS.LICENSE_SERVICE)
    private readonly licenseService: LicenseService,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspaceProvider: IWorkspaceProvider,
  ) {}

  /**
   * Access ElectronWorkspaceProvider for setConfiguration().
   * Uses runtime type guard instead of unsafe double assertion.
   */
  private get electronProvider(): ElectronWorkspaceProvider {
    if ('setConfiguration' in this.workspaceProvider) {
      return this.workspaceProvider as unknown as ElectronWorkspaceProvider;
    }
    throw new Error(
      'WorkspaceProvider does not support setConfiguration — expected ElectronWorkspaceProvider',
    );
  }

  register(): void {
    this.registerExport();
    this.registerImport();
  }

  /**
   * Register settings:export RPC method.
   *
   * Flow:
   * 1. Collect all exportable settings via SettingsExportService
   * 2. Show Electron native save dialog with default filename
   * 3. Write pretty-printed JSON to the selected path
   * 4. Return success status with file path and item counts
   */
  private registerExport(): void {
    this.rpcHandler.registerMethod('settings:export', async () => {
      try {
        // Step 1: Security warning -- user must explicitly proceed
        const { dialog: electronDialog } = await import('electron');

        const warningResult = await electronDialog.showMessageBox({
          type: 'warning',
          title: 'Export Settings',
          message:
            'This will export your API keys and tokens in PLAINTEXT to a JSON file. ' +
            'Only use this file on trusted devices and delete it after importing.',
          buttons: ['Export Settings', 'Cancel'],
          defaultId: 1,
          cancelId: 1,
        });

        if (warningResult.response !== 0) {
          this.logger.info(
            '[Electron RPC] settings:export cancelled by user (warning)',
          );
          return { exported: false, cancelled: true };
        }

        // Step 2: Collect settings from platform-agnostic service
        const exportData =
          await this.settingsExportService.collectSettings('electron');

        // Step 3: Show native save dialog
        const fs = await import('node:fs/promises');

        const result = await electronDialog.showSaveDialog({
          defaultPath: 'ptah-settings-export.json',
          filters: [{ name: 'JSON Files', extensions: ['json'] }],
          title: 'Export Ptah Settings',
        });

        if (result.canceled || !result.filePath) {
          this.logger.info('[Electron RPC] settings:export cancelled by user');
          return { exported: false, cancelled: true };
        }

        // Step 4: Write pretty-printed JSON
        const jsonContent = JSON.stringify(exportData, null, 2);
        await fs.writeFile(result.filePath, jsonContent, 'utf-8');

        const secretCount = countPopulatedSecrets(exportData);
        const configCount = Object.keys(exportData.config).length;

        this.logger.info('[Electron RPC] settings:export completed', {
          filePath: result.filePath,
          secretCount,
          configCount,
        } as unknown as Error);

        return {
          exported: true,
          filePath: result.filePath,
          secretCount,
          configCount,
        };
      } catch (error) {
        this.logger.error(
          '[Electron RPC] settings:export failed',
          error instanceof Error ? error : new Error(String(error)),
        );
        return {
          exported: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    });
  }

  /**
   * Register settings:import RPC method.
   *
   * Flow:
   * 1. Show Electron native open dialog filtered to *.json
   * 2. Read and parse the selected JSON file
   * 3. Validate the parsed data has the expected structure
   * 4. Delegate to SettingsImportService for actual import logic
   * 5. Return the SettingsImportResult for webview display
   */
  private registerImport(): void {
    this.rpcHandler.registerMethod('settings:import', async () => {
      try {
        // Step 1: Show native open dialog
        const { dialog: electronDialog } = await import('electron');
        const fs = await import('node:fs/promises');

        const result = await electronDialog.showOpenDialog({
          filters: [{ name: 'JSON Files', extensions: ['json'] }],
          properties: ['openFile'],
          title: 'Import Ptah Settings',
        });

        if (result.canceled || result.filePaths.length === 0) {
          this.logger.info('[Electron RPC] settings:import cancelled by user');
          return { cancelled: true };
        }

        const filePath = result.filePaths[0];

        // Step 2: Read file
        const fileContent = await fs.readFile(filePath, 'utf-8');

        if (!fileContent.trim()) {
          this.logger.warn(
            '[Electron RPC] settings:import - empty file selected',
            { filePath } as unknown as Error,
          );
          return {
            cancelled: false,
            result: {
              imported: [],
              skipped: [],
              errors: ['Selected file is empty'],
            },
          };
        }

        // Step 3: Parse JSON
        let parsedData: unknown;
        try {
          parsedData = JSON.parse(fileContent);
        } catch (parseError) {
          this.logger.warn('[Electron RPC] settings:import - malformed JSON', {
            filePath,
            error:
              parseError instanceof Error
                ? parseError.message
                : String(parseError),
          } as unknown as Error);
          return {
            cancelled: false,
            result: {
              imported: [],
              skipped: [],
              errors: [
                `Malformed JSON: ${
                  parseError instanceof Error
                    ? parseError.message
                    : String(parseError)
                }`,
              ],
            },
          };
        }

        // Step 4: Basic structural validation before passing to service
        if (!parsedData || typeof parsedData !== 'object') {
          return {
            cancelled: false,
            result: {
              imported: [],
              skipped: [],
              errors: ['File does not contain a valid JSON object'],
            },
          };
        }

        // Step 5: Delegate to SettingsImportService (handles version validation, key import, etc.)
        // Note: SettingsImportService skips config values because IWorkspaceProvider
        // is read-only. Electron handles config import in Step 6 below.
        const importResult = await this.settingsImportService.importSettings(
          parsedData as PtahSettingsExport,
        );

        // Step 6: Import config values via ElectronWorkspaceProvider.setConfiguration()
        // The shared SettingsImportService cannot do this (IWorkspaceProvider is read-only),
        // but ElectronWorkspaceProvider exposes setConfiguration() for both
        // file-based (~/.ptah/settings.json) and per-app (config.json) settings.
        const exportData = parsedData as PtahSettingsExport;
        if (exportData.config && Object.keys(exportData.config).length > 0) {
          for (const [key, value] of Object.entries(exportData.config)) {
            try {
              await this.electronProvider.setConfiguration('ptah', key, value);
              // Move from skipped to imported in the result
              const skippedIdx = importResult.skipped.findIndex((s) =>
                s.startsWith(`config:${key}`),
              );
              if (skippedIdx !== -1) {
                importResult.skipped.splice(skippedIdx, 1);
              }
              importResult.imported.push(`config:${key}`);
            } catch (configError) {
              importResult.errors.push(
                `config:${key}: ${
                  configError instanceof Error
                    ? configError.message
                    : String(configError)
                }`,
              );
            }
          }
          this.logger.info('[Electron RPC] Config values imported', {
            count: Object.keys(exportData.config).length,
          } as unknown as Error);
        }

        this.logger.info('[Electron RPC] settings:import completed', {
          filePath,
          imported: importResult.imported.length,
          skipped: importResult.skipped.length,
          errors: importResult.errors.length,
        } as unknown as Error);

        // If a license key was imported, verify it with the server to update
        // the in-memory license cache, then reload the renderer.
        // Without verifyLicense(), get-startup-config returns stale cached
        // status and the welcome screen re-appears after reload.
        // Only reload if verification succeeds — otherwise the stale cache
        // would cause the welcome screen to reappear (the original bug).
        if (importResult.imported.includes(SECRET_KEYS.LICENSE_KEY)) {
          this.logger.info(
            '[Electron RPC] License key imported, verifying and scheduling reload',
          );
          try {
            const status = await this.licenseService.verifyLicense();
            if (status.valid) {
              setTimeout(() => this.platformCommands.reloadWindow(), 1500);
            } else {
              this.logger.warn(
                '[Electron RPC] License key imported but verification returned invalid',
                { reason: status.reason } as unknown as Error,
              );
            }
          } catch (verifyError) {
            this.logger.warn(
              '[Electron RPC] License verification after import failed — user should restart manually',
              verifyError instanceof Error
                ? verifyError
                : new Error(String(verifyError)),
            );
          }
        }

        return {
          cancelled: false,
          result: importResult,
        };
      } catch (error) {
        this.logger.error(
          '[Electron RPC] settings:import failed',
          error instanceof Error ? error : new Error(String(error)),
        );
        return {
          cancelled: false,
          result: {
            imported: [],
            skipped: [],
            errors: [error instanceof Error ? error.message : String(error)],
          },
        };
      }
    });
  }
}
