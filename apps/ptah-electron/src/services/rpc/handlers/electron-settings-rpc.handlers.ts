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
import type { Logger, RpcHandler } from '@ptah-extension/vscode-core';
import {
  SDK_TOKENS,
  countPopulatedSecrets,
  type SettingsExportService,
  type SettingsImportService,
  type PtahSettingsExport,
} from '@ptah-extension/agent-sdk';
import type { IPlatformCommands } from '@ptah-extension/rpc-handlers';

@injectable()
export class ElectronSettingsRpcHandlers {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(SDK_TOKENS.SDK_SETTINGS_EXPORT)
    private readonly settingsExportService: SettingsExportService,
    @inject(SDK_TOKENS.SDK_SETTINGS_IMPORT)
    private readonly settingsImportService: SettingsImportService,
    @inject(TOKENS.PLATFORM_COMMANDS)
    private readonly platformCommands: IPlatformCommands
  ) {}

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
            '[Electron RPC] settings:export cancelled by user (warning)'
          );
          return { exported: false, cancelled: true };
        }

        // Step 2: Collect settings from platform-agnostic service
        const exportData = await this.settingsExportService.collectSettings(
          'electron'
        );

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
          error instanceof Error ? error : new Error(String(error))
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
            { filePath } as unknown as Error
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
        const importResult = await this.settingsImportService.importSettings(
          parsedData as PtahSettingsExport
        );

        this.logger.info('[Electron RPC] settings:import completed', {
          filePath,
          imported: importResult.imported.length,
          skipped: importResult.skipped.length,
          errors: importResult.errors.length,
        } as unknown as Error);

        // If a license key was imported, schedule a full app relaunch so the
        // main process re-runs the license check (Phase 3.5 in main.ts).
        // Same pattern as LicenseRpcHandlers.registerSetKey() — 1.5s delay
        // lets the RPC response reach the renderer before restart.
        if (importResult.imported.includes('ptah.licenseKey')) {
          this.logger.info(
            '[Electron RPC] License key imported, scheduling app relaunch'
          );
          setTimeout(() => this.platformCommands.reloadWindow(), 1500);
        }

        return {
          cancelled: false,
          result: importResult,
        };
      } catch (error) {
        this.logger.error(
          '[Electron RPC] settings:import failed',
          error instanceof Error ? error : new Error(String(error))
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
