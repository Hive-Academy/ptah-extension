import * as vscode from 'vscode';
import type {
  LicenseService,
  LicenseStatus,
} from '@ptah-extension/vscode-core';
import { resolveEnvironment } from '@ptah-extension/shared';
import { LicenseCommands } from '../commands/license-commands';
import { WebviewHtmlGenerator } from '../services/webview-html-generator';

/**
 * Register only license-related commands when extension is blocked (TASK_2025_121 Batch 3)
 *
 * When license is invalid, only these commands are available:
 * - ptah.enterLicenseKey: Enter license key
 * - ptah.checkLicenseStatus: Check current status
 * - ptah.openPricing: Open pricing page
 *
 * @param context - VS Code extension context
 * @param licenseService - License service instance
 */
export function registerLicenseOnlyCommands(
  context: vscode.ExtensionContext,
  licenseService: LicenseService,
): void {
  // Create LicenseCommands instance manually (DI not fully setup)
  const licenseCommands = new LicenseCommands(licenseService);

  const isDev = context.extensionMode === vscode.ExtensionMode.Development;
  const { urls } = resolveEnvironment(isDev);

  context.subscriptions.push(
    vscode.commands.registerCommand('ptah.enterLicenseKey', async () => {
      await licenseCommands.enterLicenseKey();
      // After license key entry, reload window to complete activation
    }),
    vscode.commands.registerCommand('ptah.checkLicenseStatus', async () => {
      await licenseCommands.checkLicenseStatus();
    }),
    vscode.commands.registerCommand('ptah.openPricing', () => {
      vscode.env.openExternal(vscode.Uri.parse(urls.PRICING_URL));
    }),
    vscode.commands.registerCommand('ptah.openSignup', () => {
      vscode.env.openExternal(
        vscode.Uri.parse(urls.SIGNUP_URL + '?source=vscode'),
      );
    }),
    vscode.commands.registerCommand('ptah.toggleChat', () => {
      vscode.commands.executeCommand('ptah.main.focus');
    }),
  );
}

/**
 * Handle license blocking flow with embedded welcome page (TASK_2025_126)
 *
 * TASK_2025_126: Replaces the modal popup with an embedded welcome page
 * inside the extension webview. This provides a better UX for unlicensed users.
 *
 * Flow:
 * 1. Register minimal license commands (ptah.enterLicenseKey, ptah.openPricing)
 * 2. Create minimal webview provider with initialView: 'welcome'
 * 3. Handle license:getStatus and command:execute RPC calls inline
 * 4. DO NOT show blocking modal (showLicenseRequiredUI)
 *
 * @param context - VS Code extension context
 * @param licenseService - License service instance
 * @param status - Current license status
 */
export async function handleLicenseBlocking(
  context: vscode.ExtensionContext,
  licenseService: LicenseService,
  status: LicenseStatus,
): Promise<void> {
  // Register minimal commands for license management
  registerLicenseOnlyCommands(context, licenseService);

  // TASK_2025_126: Show webview with welcome view instead of modal

  const htmlGenerator = new WebviewHtmlGenerator(context);

  // Map backend license reason to frontend reason format
  // Backend uses: 'expired' | 'revoked' | 'not_found' | 'trial_ended'
  // Frontend expects: 'expired' | 'trial_ended' | 'no_license'
  let frontendReason: 'expired' | 'trial_ended' | 'no_license' | undefined;
  if (status.reason) {
    switch (status.reason) {
      case 'expired':
      case 'revoked':
        frontendReason = 'expired';
        break;
      case 'trial_ended':
        frontendReason = 'trial_ended';
        break;
      case 'not_found':
        frontendReason = 'no_license';
        break;
    }
  }

  // Create minimal webview provider for unlicensed users
  const provider: vscode.WebviewViewProvider = {
    resolveWebviewView(webviewView: vscode.WebviewView): void {
      webviewView.webview.options = {
        enableScripts: true,
        localResourceRoots: [
          vscode.Uri.joinPath(context.extensionUri, 'webview', 'browser'),
          vscode.Uri.joinPath(context.extensionUri, 'assets'),
          context.extensionUri,
        ],
      };

      // Generate HTML with welcome view
      const workspaceInfo = {
        name: vscode.workspace.workspaceFolders?.[0]?.name || 'Workspace',
        path: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '',
      };

      webviewView.webview.html = htmlGenerator.generateAngularWebviewContent(
        webviewView.webview,
        { workspaceInfo, initialView: 'welcome', isLicensed: false },
      );

      // Setup minimal message listener for RPC calls (license status, command execution)
      webviewView.webview.onDidReceiveMessage(async (message) => {
        // Handle RPC calls - minimal handler for unlicensed state
        // Note: RPC messages have structure { type: 'rpc:call', payload: { method, params, correlationId } }
        if (message.type === 'rpc:call' || message.type === 'rpc:request') {
          const { method, params, correlationId } = message.payload || {};

          if (method === 'license:getStatus') {
            // Return license status for context-aware welcome messaging
            // TASK_2025_128: Renamed isBasic to isCommunity for freemium model
            const response = {
              success: true,
              data: {
                valid: false,
                tier: status.tier || 'expired',
                isPremium: false,
                isCommunity: false, // RENAMED from isBasic
                daysRemaining: null,
                trialActive: false,
                trialDaysRemaining: null,
                reason: frontendReason,
              },
              correlationId,
            };
            webviewView.webview.postMessage({
              type: 'rpc:response',
              ...response,
            });
          } else if (method === 'license:setKey') {
            // Inline license key verification from welcome screen
            try {
              const key = params?.licenseKey;
              if (!key || typeof key !== 'string') {
                webviewView.webview.postMessage({
                  type: 'rpc:response',
                  success: true,
                  data: { success: false, error: 'License key is required' },
                  correlationId,
                });
                return;
              }

              // Validate format
              if (!/^ptah_lic_[a-f0-9]{64}$/.test(key)) {
                webviewView.webview.postMessage({
                  type: 'rpc:response',
                  success: true,
                  data: {
                    success: false,
                    error:
                      'Invalid license key format. Keys start with ptah_lic_ followed by 64 hex characters.',
                  },
                  correlationId,
                });
                return;
              }

              // Store and verify
              await licenseService.setLicenseKey(key);
              const newStatus = await licenseService.verifyLicense();

              if (newStatus.valid) {
                webviewView.webview.postMessage({
                  type: 'rpc:response',
                  success: true,
                  data: {
                    success: true,
                    tier: newStatus.tier,
                    plan: newStatus.plan
                      ? { name: newStatus.plan.name }
                      : undefined,
                  },
                  correlationId,
                });
                // Reload window after a short delay to let the response reach the webview
                setTimeout(
                  () =>
                    vscode.commands.executeCommand(
                      'workbench.action.reloadWindow',
                    ),
                  1500,
                );
              } else {
                webviewView.webview.postMessage({
                  type: 'rpc:response',
                  success: true,
                  data: {
                    success: false,
                    error:
                      'License verification failed. Please check your key and try again.',
                  },
                  correlationId,
                });
              }
            } catch (error) {
              webviewView.webview.postMessage({
                type: 'rpc:response',
                success: false,
                data: {
                  success: false,
                  error:
                    error instanceof Error
                      ? error.message
                      : 'Failed to verify license key',
                },
                correlationId,
              });
            }
          } else if (method === 'command:execute') {
            // Execute ptah.* commands only (security: same check as CommandRpcHandlers)
            try {
              const command = params?.command;
              if (
                command &&
                typeof command === 'string' &&
                command.startsWith('ptah.')
              ) {
                await vscode.commands.executeCommand(
                  command,
                  ...(params?.args || []),
                );
                webviewView.webview.postMessage({
                  type: 'rpc:response',
                  success: true,
                  data: { success: true },
                  correlationId,
                });
              } else {
                webviewView.webview.postMessage({
                  type: 'rpc:response',
                  success: false,
                  data: {
                    success: false,
                    error: 'Only ptah.* commands are allowed',
                  },
                  correlationId,
                });
              }
            } catch (error) {
              webviewView.webview.postMessage({
                type: 'rpc:response',
                success: false,
                data: {
                  success: false,
                  error: error instanceof Error ? error.message : String(error),
                },
                correlationId,
              });
            }
          } else if (method === 'settings:import') {
            // Inline settings import for unlicensed users (TASK_2025_210)
            // Full SettingsImportService requires DI container which isn't set up yet.
            // Handle file dialog + secret storage directly via VS Code APIs.
            try {
              const fileUris = await vscode.window.showOpenDialog({
                canSelectMany: false,
                filters: { 'JSON Files': ['json'] },
                title: 'Import Ptah Settings',
                openLabel: 'Import',
              });

              if (!fileUris || fileUris.length === 0) {
                webviewView.webview.postMessage({
                  type: 'rpc:response',
                  success: true,
                  data: { cancelled: true },
                  correlationId,
                });
                return;
              }

              // Read and parse JSON file
              const fileContent = await vscode.workspace.fs.readFile(
                fileUris[0],
              );
              const jsonString = new TextDecoder().decode(fileContent);
              let importData: Record<string, unknown>;
              try {
                importData = JSON.parse(jsonString);
              } catch {
                webviewView.webview.postMessage({
                  type: 'rpc:response',
                  success: false,
                  error: 'File is not valid JSON',
                  correlationId,
                });
                return;
              }

              // Validate basic structure (version 1, has auth section)
              if (
                !importData ||
                typeof importData !== 'object' ||
                importData['version'] !== 1 ||
                !importData['auth']
              ) {
                webviewView.webview.postMessage({
                  type: 'rpc:response',
                  success: false,
                  error:
                    'Invalid settings file. Expected a Ptah settings export (version 1).',
                  correlationId,
                });
                return;
              }

              // Import secrets directly via context.secrets (VS Code SecretStorage)
              const imported: string[] = [];
              const errors: string[] = [];
              const auth = importData['auth'] as Record<string, unknown>;

              if (
                importData['licenseKey'] &&
                typeof importData['licenseKey'] === 'string'
              ) {
                try {
                  await context.secrets.store(
                    'ptah.licenseKey',
                    importData['licenseKey'] as string,
                  );
                  imported.push('ptah.licenseKey');
                } catch (e) {
                  errors.push(
                    `licenseKey: ${e instanceof Error ? e.message : String(e)}`,
                  );
                }
              }

              if (auth['apiKey'] && typeof auth['apiKey'] === 'string') {
                try {
                  await context.secrets.store(
                    'ptah.auth.anthropicApiKey',
                    auth['apiKey'] as string,
                  );
                  imported.push('ptah.auth.anthropicApiKey');
                } catch (e) {
                  errors.push(
                    `apiKey: ${e instanceof Error ? e.message : String(e)}`,
                  );
                }
              }

              if (
                auth['providerKeys'] &&
                typeof auth['providerKeys'] === 'object'
              ) {
                for (const [providerId, value] of Object.entries(
                  auth['providerKeys'] as Record<string, unknown>,
                )) {
                  if (typeof value === 'string' && value) {
                    try {
                      await context.secrets.store(
                        `ptah.auth.provider.${providerId}`,
                        value,
                      );
                      imported.push(`provider:${providerId}`);
                    } catch (e) {
                      errors.push(
                        `provider:${providerId}: ${e instanceof Error ? e.message : String(e)}`,
                      );
                    }
                  }
                }
              }

              // Import config values via VS Code workspace configuration
              const importConfig = importData['config'] as
                | Record<string, unknown>
                | undefined;
              if (importConfig && typeof importConfig === 'object') {
                const ptahConfig = vscode.workspace.getConfiguration('ptah');
                for (const [key, value] of Object.entries(importConfig)) {
                  try {
                    await ptahConfig.update(
                      key,
                      value,
                      vscode.ConfigurationTarget.Global,
                    );
                    imported.push(`config:${key}`);
                  } catch (e) {
                    errors.push(
                      `config:${key}: ${e instanceof Error ? e.message : String(e)}`,
                    );
                  }
                }
              }

              // Response shape must match RpcMethodRegistry['settings:import']['result']
              // which nests imported/skipped/errors inside a `result` wrapper.
              webviewView.webview.postMessage({
                type: 'rpc:response',
                success: true,
                data: {
                  cancelled: false,
                  result: { imported, skipped: [], errors },
                },
                correlationId,
              });

              // If a license key was imported, schedule a window reload so the
              // extension re-runs activation with the new credentials.
              // Same pattern as Electron's SettingsRpcHandlers — 1.5s
              // delay lets the RPC response reach the webview before reload.
              if (imported.includes('ptah.licenseKey')) {
                setTimeout(
                  () =>
                    vscode.commands.executeCommand(
                      'workbench.action.reloadWindow',
                    ),
                  1500,
                );
              }
            } catch (error) {
              webviewView.webview.postMessage({
                type: 'rpc:response',
                success: false,
                error:
                  error instanceof Error
                    ? error.message
                    : 'Import failed. Please try again.',
                correlationId,
              });
            }
          }
        }
      });
    },
  };

  // Register the webview provider
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('ptah.main', provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  // DO NOT call showLicenseRequiredUI() - webview handles onboarding
}
