import * as vscode from 'vscode';
import type {
  LicenseService,
  LicenseStatus,
} from '@ptah-extension/vscode-core';
import { resolveEnvironment } from '@ptah-extension/shared';
import { LicenseCommands } from '../commands/license-commands';
import { WebviewHtmlGenerator } from '../services/webview-html-generator';

/**
 * Register only license-related commands when extension is blocked.
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
  const licenseCommands = new LicenseCommands(licenseService);

  const isDev = context.extensionMode === vscode.ExtensionMode.Development;
  const { urls } = resolveEnvironment(isDev);

  context.subscriptions.push(
    vscode.commands.registerCommand('ptah.enterLicenseKey', async () => {
      await licenseCommands.enterLicenseKey();
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
 * Handle license blocking flow with an embedded welcome page inside the
 * extension webview, providing a better UX for unlicensed users than a
 * blocking modal popup.
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
  registerLicenseOnlyCommands(context, licenseService);

  const htmlGenerator = new WebviewHtmlGenerator(context);
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
      const workspaceInfo = {
        name: vscode.workspace.workspaceFolders?.[0]?.name || 'Workspace',
        path: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '',
      };

      webviewView.webview.html = htmlGenerator.generateAngularWebviewContent(
        webviewView.webview,
        { workspaceInfo, initialView: 'welcome', isLicensed: false },
      );
      webviewView.webview.onDidReceiveMessage(async (message) => {
        if (message.type === 'rpc:call' || message.type === 'rpc:request') {
          const { method, params, correlationId } = message.payload || {};

          if (method === 'license:getStatus') {
            const response = {
              success: true,
              data: {
                valid: false,
                tier: status.tier || 'expired',
                isPremium: false,
                isCommunity: false,
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
              webviewView.webview.postMessage({
                type: 'rpc:response',
                success: true,
                data: {
                  cancelled: false,
                  result: { imported, skipped: [], errors },
                },
                correlationId,
              });
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
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('ptah.main', provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );
}
