/**
 * License Commands
 *
 * Command handlers for license key management (enter, remove, check status)
 * Available via VS Code Command Palette
 *
 * TASK_2025_075 Batch 6: Command palette integration for license management
 *
 * @packageDocumentation
 */

import * as vscode from 'vscode';
import { injectable, inject } from 'tsyringe';
import { LicenseService, TOKENS } from '@ptah-extension/vscode-core';

/**
 * License Commands Implementation
 *
 * Provides command palette handlers for:
 * - ptah.enterLicenseKey: Enter/update license key
 * - ptah.removeLicenseKey: Remove license key (downgrade to free tier)
 * - ptah.checkLicenseStatus: View current license status
 *
 * Security:
 * - License key input uses password mode (hidden input)
 * - Input validation before server verification
 * - License keys NEVER displayed (only sent via email)
 *
 * UX:
 * - Clear success/error messages
 * - Reload window prompt after license changes
 * - User-friendly error explanations
 */
@injectable()
export class LicenseCommands {
  constructor(
    @inject(TOKENS.LICENSE_SERVICE)
    private readonly licenseService: LicenseService
  ) {}

  /**
   * Enter License Key Command
   *
   * Flow:
   * 1. Show password input box with format validation
   * 2. Store license key in SecretStorage
   * 3. Verify with server
   * 4. Show success/error message
   * 5. Prompt user to reload window
   *
   * Security:
   * - Input box uses password mode (no plaintext display)
   * - Format validated before server call (ptah_lic_{64-hex})
   *
   * @example
   * Command Palette > Ptah: Enter License Key
   */
  async enterLicenseKey(): Promise<void> {
    const licenseKey = await vscode.window.showInputBox({
      prompt: 'Enter your Ptah premium license key',
      placeHolder: 'ptah_lic_...',
      password: true,
      validateInput: (value) => {
        if (!value) return null;
        if (!value.startsWith('ptah_lic_')) {
          return 'License key must start with "ptah_lic_"';
        }
        if (value.length !== 73) {
          // ptah_lic_ (9) + 64 hex chars
          return 'Invalid license key format (expected 73 characters)';
        }
        if (!/^ptah_lic_[a-f0-9]{64}$/.test(value)) {
          return 'Invalid license key format (must be lowercase hex after prefix)';
        }
        return null;
      },
    });

    if (!licenseKey) {
      // User cancelled input
      return;
    }

    // Store license key and verify
    await this.licenseService.setLicenseKey(licenseKey);
    const status = await this.licenseService.verifyLicense();

    if (status.valid) {
      const action = await vscode.window.showInformationMessage(
        `License activated! Plan: ${status.plan?.name}. Reload window to enable premium features.`,
        'Reload Window'
      );
      if (action === 'Reload Window') {
        await vscode.commands.executeCommand('workbench.action.reloadWindow');
      }
    } else {
      vscode.window.showErrorMessage(
        `License verification failed: ${
          status.reason || 'Invalid license key'
        }. Please check your license key and try again.`
      );
    }
  }

  /**
   * Remove License Key Command
   *
   * Flow:
   * 1. Show confirmation warning
   * 2. Delete license key from SecretStorage
   * 3. Downgrade to free tier
   * 4. Prompt user to reload window
   *
   * Security:
   * - Confirmation required (prevent accidental removal)
   * - License key deleted from encrypted storage
   *
   * @example
   * Command Palette > Ptah: Remove License Key
   */
  async removeLicenseKey(): Promise<void> {
    const confirm = await vscode.window.showWarningMessage(
      'Remove your license key? Premium features will be disabled.',
      'Remove',
      'Cancel'
    );

    if (confirm !== 'Remove') {
      // User cancelled
      return;
    }

    await this.licenseService.clearLicenseKey();

    const action = await vscode.window.showInformationMessage(
      'License key removed. Reload window to apply changes.',
      'Reload Window'
    );
    if (action === 'Reload Window') {
      await vscode.commands.executeCommand('workbench.action.reloadWindow');
    }
  }

  /**
   * Check License Status Command
   *
   * Flow:
   * 1. Verify license with server (or use cache)
   * 2. Display license information in info message
   *
   * Displays:
   * - Plan name and tier
   * - Expiration date (if applicable)
   * - Days remaining (if applicable)
   * - Upgrade link for free tier users
   *
   * @example
   * Command Palette > Ptah: Check License Status
   */
  async checkLicenseStatus(): Promise<void> {
    const status = await this.licenseService.verifyLicense();

    if (status.valid) {
      const expiresText = status.expiresAt
        ? new Date(status.expiresAt).toLocaleDateString()
        : 'Never';
      const daysText = status.daysRemaining
        ? `${status.daysRemaining} days`
        : 'Unlimited';

      vscode.window.showInformationMessage(
        `Plan: ${status.plan?.name} (${status.tier})\nExpires: ${expiresText}\nDays Remaining: ${daysText}`
      );
    } else {
      vscode.window.showInformationMessage(
        `License Status: Free Tier\nReason: ${
          status.reason || 'No license key'
        }\n\nUpgrade at https://ptah.dev/pricing`
      );
    }
  }

  /**
   * Register all license commands with VS Code
   *
   * Commands registered:
   * - ptah.enterLicenseKey
   * - ptah.removeLicenseKey
   * - ptah.checkLicenseStatus
   *
   * @param context - Extension context for command disposal
   */
  registerCommands(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
      vscode.commands.registerCommand('ptah.enterLicenseKey', () =>
        this.enterLicenseKey()
      ),
      vscode.commands.registerCommand('ptah.removeLicenseKey', () =>
        this.removeLicenseKey()
      ),
      vscode.commands.registerCommand('ptah.checkLicenseStatus', () =>
        this.checkLicenseStatus()
      )
    );
  }
}
