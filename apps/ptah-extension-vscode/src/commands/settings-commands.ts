/**
 * Settings Commands
 *
 * Command handlers for settings export and import.
 * Available via VS Code Command Palette as:
 * - Ptah: Export Settings
 * - Ptah: Import Settings
 *
 * TASK_2025_210 Batch 2: VS Code export/import commands for cross-platform settings portability.
 *
 * Security:
 * - Export warns users that secrets will be stored in PLAINTEXT
 * - Import advises users to delete the export file after use
 * - Secret values are NEVER logged
 *
 * @packageDocumentation
 */

import * as vscode from 'vscode';
import type { Logger } from '@ptah-extension/vscode-core';
import type {
  SettingsExportService,
  SettingsImportService,
  PtahSettingsExport,
} from '@ptah-extension/agent-sdk';
import { countPopulatedSecrets } from '@ptah-extension/agent-sdk';

/**
 * Settings Commands Implementation
 *
 * Provides command palette handlers for:
 * - ptah.exportSettings: Export all settings and credentials to a JSON file
 * - ptah.importSettings: Import settings and credentials from a JSON file
 *
 * Dependencies are injected manually (not via tsyringe @injectable) because
 * the class is instantiated in main.ts after the DI container is fully set up,
 * following the same pattern used for session import resolution.
 */
export class SettingsCommands {
  constructor(
    private readonly exportService: SettingsExportService,
    private readonly importService: SettingsImportService,
    private readonly logger: Logger
  ) {}

  /**
   * Register all settings commands with VS Code.
   *
   * Commands registered:
   * - ptah.exportSettings
   * - ptah.importSettings
   *
   * @param context - Extension context for command disposal
   */
  registerCommands(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
      vscode.commands.registerCommand('ptah.exportSettings', () =>
        this.exportSettings()
      ),
      vscode.commands.registerCommand('ptah.importSettings', () =>
        this.importSettings()
      )
    );
  }

  /**
   * Export Settings Command
   *
   * Flow:
   * 1. Show security warning (plaintext secrets advisory)
   * 2. If user cancels, abort
   * 3. Collect all settings via SettingsExportService
   * 4. Show save file dialog (default: ptah-settings-export.json)
   * 5. Write JSON to user-selected location (pretty-printed)
   * 6. Show success message with exported item count
   */
  private async exportSettings(): Promise<void> {
    // Step 1: Security warning -- user must explicitly proceed
    const proceed = await vscode.window.showWarningMessage(
      'This will export your API keys and tokens in PLAINTEXT to a JSON file. ' +
        'Only use this file on trusted devices and delete it after importing. Continue?',
      { modal: true },
      'Export Settings'
    );

    if (proceed !== 'Export Settings') {
      return;
    }

    // Step 2: Collect settings from platform-agnostic service
    let exportData: PtahSettingsExport;
    try {
      exportData = await this.exportService.collectSettings('vscode');
    } catch (error) {
      this.logger.error('[SettingsCommands] Failed to collect settings', {
        error: error instanceof Error ? error.message : String(error),
      });
      vscode.window.showErrorMessage(
        'Failed to collect settings. Check the output log for details.'
      );
      return;
    }

    // Step 3: Show save file dialog
    const saveUri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file('ptah-settings-export.json'),
      filters: { 'JSON Files': ['json'] },
      title: 'Export Ptah Settings',
    });

    if (!saveUri) {
      return;
    }

    // Step 4: Write JSON file (pretty-printed for human readability)
    try {
      const jsonContent = JSON.stringify(exportData, null, 2);
      const encoder = new TextEncoder();
      await vscode.workspace.fs.writeFile(saveUri, encoder.encode(jsonContent));
    } catch (error) {
      this.logger.error('[SettingsCommands] Failed to write export file', {
        error: error instanceof Error ? error.message : String(error),
      });
      vscode.window.showErrorMessage(
        `Failed to write export file: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return;
    }

    // Step 5: Success message with count of exported items
    const secretCount = countPopulatedSecrets(exportData);
    const configCount = Object.keys(exportData.config).length;
    const totalCount = secretCount + configCount;

    vscode.window.showInformationMessage(
      `Settings exported successfully! ${totalCount} item(s) saved ` +
        `(${secretCount} credential(s), ${configCount} config value(s)).`
    );

    this.logger.info('[SettingsCommands] Export complete', {
      secretCount,
      configCount,
      totalCount,
    });
  }

  /**
   * Import Settings Command
   *
   * Flow:
   * 1. Show open file dialog (filter: *.json)
   * 2. Read and parse JSON file
   * 3. Call SettingsImportService to import
   * 4. Show import summary (imported, skipped, errors)
   * 5. Warn user to delete the export file
   * 6. Offer to reload window
   */
  private async importSettings(): Promise<void> {
    // Step 1: Show open file dialog
    const fileUris = await vscode.window.showOpenDialog({
      canSelectMany: false,
      filters: { 'JSON Files': ['json'] },
      title: 'Import Ptah Settings',
      openLabel: 'Import',
    });

    if (!fileUris || fileUris.length === 0) {
      return;
    }

    const fileUri = fileUris[0];

    // Step 2: Read and parse JSON file
    let importData: PtahSettingsExport;
    try {
      const fileContent = await vscode.workspace.fs.readFile(fileUri);
      const decoder = new TextDecoder();
      const jsonString = decoder.decode(fileContent);
      importData = JSON.parse(jsonString) as PtahSettingsExport;
    } catch (error) {
      this.logger.error('[SettingsCommands] Failed to read import file', {
        error: error instanceof Error ? error.message : String(error),
      });
      vscode.window.showErrorMessage(
        `Failed to read or parse import file: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return;
    }

    // Step 3: Call import service
    let result;
    try {
      result = await this.importService.importSettings(importData);
    } catch (error) {
      this.logger.error('[SettingsCommands] Failed to import settings', {
        error: error instanceof Error ? error.message : String(error),
      });
      vscode.window.showErrorMessage(
        `Failed to import settings: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return;
    }

    // Step 4: Show import summary
    const summaryParts: string[] = [];
    if (result.imported.length > 0) {
      summaryParts.push(`${result.imported.length} imported`);
    }
    if (result.skipped.length > 0) {
      summaryParts.push(`${result.skipped.length} skipped (already exist)`);
    }
    if (result.errors.length > 0) {
      summaryParts.push(`${result.errors.length} error(s)`);
    }

    const summary =
      summaryParts.length > 0 ? summaryParts.join(', ') : 'No items to import';

    this.logger.info('[SettingsCommands] Import complete', {
      imported: result.imported.length,
      skipped: result.skipped.length,
      errors: result.errors.length,
    });

    // Step 5: Show result and warn about deleting the export file
    if (result.errors.length > 0) {
      vscode.window.showWarningMessage(
        `Settings import completed with issues: ${summary}. ` +
          `Errors: ${result.errors.join('; ')}`
      );
    } else {
      vscode.window.showInformationMessage(
        `Settings import complete: ${summary}.`
      );
    }

    // Step 6: Prominently warn user to delete the export file
    const deleteWarning = await vscode.window.showWarningMessage(
      'IMPORTANT: Please delete the export file now. ' +
        'It contains plaintext API keys and tokens that should not be left on disk.',
      { modal: true },
      'Reload Window',
      'OK'
    );

    if (deleteWarning === 'Reload Window') {
      await vscode.commands.executeCommand('workbench.action.reloadWindow');
    }
  }
}
