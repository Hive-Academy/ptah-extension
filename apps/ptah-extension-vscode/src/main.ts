// CRITICAL: reflect-metadata MUST be imported first for TSyringe to work
import 'reflect-metadata';

import {
  type Logger,
  type LicenseService,
  type LicenseStatus,
  TOKENS,
} from '@ptah-extension/vscode-core';
import * as vscode from 'vscode';
import { PtahExtension } from './core/ptah-extension';
import { DIContainer } from './di/container';
import { LicenseCommands } from './commands/license-commands';

let ptahExtension: PtahExtension | undefined;

/**
 * Show license required UI with blocking modal (TASK_2025_121 Batch 3)
 *
 * Displays a modal dialog when license is invalid, offering options to:
 * - Start Trial: Opens pricing page
 * - Enter License Key: Triggers license entry command
 * - View Pricing: Opens pricing page
 *
 * @param status - Current license status with reason
 * @returns Selected action or undefined if dismissed
 */
async function showLicenseRequiredUI(
  status: LicenseStatus
): Promise<string | undefined> {
  const message =
    status.reason === 'expired'
      ? 'Your Ptah subscription has expired. Please renew to continue using the extension.'
      : status.reason === 'trial_ended'
      ? 'Your Ptah trial has ended. Subscribe to continue using the extension.'
      : 'Ptah requires a subscription to use. Start your 14-day free trial today!';

  const selection = await vscode.window.showWarningMessage(
    message,
    { modal: true },
    'Start Trial',
    'Enter License Key',
    'View Pricing'
  );

  return selection;
}

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
function registerLicenseOnlyCommands(
  context: vscode.ExtensionContext,
  licenseService: LicenseService
): void {
  // Create LicenseCommands instance manually (DI not fully setup)
  const licenseCommands = new LicenseCommands(licenseService);

  context.subscriptions.push(
    vscode.commands.registerCommand('ptah.enterLicenseKey', async () => {
      await licenseCommands.enterLicenseKey();
      // After license key entry, reload window to complete activation
    }),
    vscode.commands.registerCommand('ptah.checkLicenseStatus', async () => {
      await licenseCommands.checkLicenseStatus();
    }),
    vscode.commands.registerCommand('ptah.openPricing', () => {
      vscode.env.openExternal(vscode.Uri.parse('https://ptah.dev/pricing'));
    })
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
async function handleLicenseBlocking(
  context: vscode.ExtensionContext,
  licenseService: LicenseService,
  status: LicenseStatus
): Promise<void> {
  // Register minimal commands for license management
  registerLicenseOnlyCommands(context, licenseService);

  // TASK_2025_126: Show webview with welcome view instead of modal
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { WebviewHtmlGenerator } = require('./services/webview-html-generator');
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
        { workspaceInfo, initialView: 'welcome', isLicensed: false }
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
                isCommunity: false,  // RENAMED from isBasic
                daysRemaining: null,
                trialActive: false,
                trialDaysRemaining: null,
                reason: frontendReason,
              },
              correlationId,
            };
            webviewView.webview.postMessage({ type: 'rpc:response', ...response });
          } else if (method === 'command:execute') {
            // Execute ptah.* commands only (security: same check as CommandRpcHandlers)
            try {
              const command = params?.command;
              if (command && typeof command === 'string' && command.startsWith('ptah.')) {
                await vscode.commands.executeCommand(command, ...(params?.args || []));
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
                  data: { success: false, error: 'Only ptah.* commands are allowed' },
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
          }
        }
      });
    },
  };

  // Register the webview provider
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('ptah.main', provider, {
      webviewOptions: { retainContextWhenHidden: true },
    })
  );

  console.log('[Activate] Webview registered with welcome view for unlicensed user');
  // DO NOT call showLicenseRequiredUI() - webview handles onboarding
}

export async function activate(
  context: vscode.ExtensionContext
): Promise<void> {
  console.log('===== PTAH ACTIVATION START =====');
  try {
    // ========================================
    // STEP 1: MINIMAL DI SETUP FOR LICENSE CHECK (TASK_2025_121)
    // ========================================
    // Initialize minimal DI container with only license-related services
    // This allows license verification before full service initialization
    console.log(
      '[Activate] Step 1: Setting up minimal DI for license check...'
    );
    DIContainer.setupMinimal(context);
    console.log('[Activate] Step 1: Minimal DI setup complete');

    // ========================================
    // STEP 2: LICENSE VERIFICATION (BLOCKING)
    // ========================================
    // CRITICAL: License verification MUST happen BEFORE full service init
    // If license is invalid, block extension and show license UI
    console.log('[Activate] Step 2: Verifying license (BLOCKING)...');
    const licenseService = DIContainer.resolve<LicenseService>(
      TOKENS.LICENSE_SERVICE
    );
    const licenseStatus: LicenseStatus = await licenseService.verifyLicense();

    // TASK_2025_128: Freemium model - Community tier has valid: true
    // This check only blocks users with explicitly expired/revoked licenses (payment failures)
    // Community users (no license key) have valid: true and bypass this block
    if (!licenseStatus.valid) {
      // BLOCK EXTENSION - Only for revoked/payment-failed licenses
      console.log(
        `[Activate] BLOCKED: License invalid (reason: ${
          licenseStatus.reason || 'unknown'
        })`
      );

      // Handle blocking flow (show UI, register minimal commands)
      await handleLicenseBlocking(context, licenseService, licenseStatus);

      // DO NOT continue with normal activation
      console.log('[Activate] Extension blocked - awaiting valid license');
      return;
    }

    // Community and Pro users both reach here
    console.log(
      `[Activate] Step 2: License verified (tier: ${licenseStatus.tier})`
    );

    // ========================================
    // STEP 3: FULL DI SETUP (Licensed users only)
    // ========================================
    console.log('[Activate] Step 3: Setting up full DI Container...');
    DIContainer.setup(context);
    console.log('[Activate] Step 3: Full DI Container setup complete');

    // Get logger from DI container
    console.log('[Activate] Step 4: Resolving Logger...');
    const logger = DIContainer.resolve<Logger>(TOKENS.LOGGER);
    logger.info('Activating Ptah extension (licensed user)...', {
      tier: licenseStatus.tier,
      valid: licenseStatus.valid,
    });
    console.log('[Activate] Step 4: Logger resolved');

    // Register RPC Methods (Phase 2 - TASK_2025_021)
    // Extracted to RpcMethodRegistrationService for clean separation
    console.log('[Activate] Step 5: Registering RPC methods...');
    const rpcMethodRegistration = DIContainer.resolve(
      TOKENS.RPC_METHOD_REGISTRATION_SERVICE
    ) as { registerAll: () => void };
    rpcMethodRegistration.registerAll();
    console.log('[Activate] Step 5: RPC methods registered');

    // Initialize autocomplete discovery watchers (TASK_2025_019 Phase 2)
    // NOTE: MCP discovery service was planned but never implemented - only agent and command discovery exist
    console.log('[Activate] Step 6: Initializing autocomplete watchers...');
    const agentDiscovery = DIContainer.resolve(
      TOKENS.AGENT_DISCOVERY_SERVICE
    ) as { initializeWatchers: () => void };
    const commandDiscovery = DIContainer.resolve(
      TOKENS.COMMAND_DISCOVERY_SERVICE
    ) as { initializeWatchers: () => void };
    agentDiscovery.initializeWatchers();
    commandDiscovery.initializeWatchers();
    logger.info('Autocomplete discovery watchers initialized (2 services)');
    console.log('[Activate] Step 6: Autocomplete watchers initialized');

    // Step 7: Initialize SDK authentication (TASK_2025_057 Batch 1)
    console.log('[Activate] Step 7: Initializing SDK authentication...');
    const sdkAdapter = DIContainer.resolve(TOKENS.SDK_AGENT_ADAPTER) as {
      initialize: () => Promise<boolean>;
      preloadSdk: () => Promise<void>;
    };
    const authInitialized = await sdkAdapter.initialize();

    if (!authInitialized) {
      logger.warn('SDK authentication not configured - showing onboarding UI');
    } else {
      logger.info('SDK authentication initialized successfully');

      // Pre-load SDK in background (non-blocking) to speed up first chat
      // This shifts ~100-200ms import cost from first user interaction to activation
      console.log('[Activate] Step 7.1: Pre-loading SDK in background...');
      sdkAdapter.preloadSdk().catch((err) => {
        logger.warn('SDK preload failed (will retry on first use)', {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }
    console.log(
      '[Activate] Step 7: SDK authentication initialization complete'
    );

    // Step 8: Import existing Claude Code sessions (TASK_2025_091)
    console.log('[Activate] Step 8: Importing existing sessions...');
    const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (workspacePath) {
      try {
        const { SDK_TOKENS } = require('@ptah-extension/agent-sdk');
        const sessionImporter = DIContainer.getContainer().resolve(
          SDK_TOKENS.SDK_SESSION_IMPORTER
        ) as {
          scanAndImport: (path: string, limit?: number) => Promise<number>;
        };
        const imported = await sessionImporter.scanAndImport(workspacePath, 5);
        if (imported > 0) {
          logger.info(`Imported ${imported} existing Claude Code sessions`);
        }
      } catch (importError) {
        logger.debug('Session import skipped (no existing sessions or error)', {
          error:
            importError instanceof Error
              ? importError.message
              : String(importError),
        });
      }
    }
    console.log('[Activate] Step 8: Session import complete');

    // Initialize main extension controller
    console.log('[Activate] Step 9: Creating PtahExtension instance...');
    ptahExtension = new PtahExtension(context);
    console.log('[Activate] Step 9: PtahExtension instance created');

    console.log('[Activate] Step 10: Calling ptahExtension.initialize()...');
    await ptahExtension.initialize();
    console.log('[Activate] Step 10: ptahExtension.initialize() complete');

    // Show onboarding UI if authentication not configured (TASK_2025_057 Batch 1)
    if (!authInitialized) {
      console.log('[Activate] Step 10.1: Showing authentication onboarding...');
      await ptahExtension.showAuthenticationOnboarding();
      console.log('[Activate] Step 10.1: Authentication onboarding displayed');
    }

    // Register all providers, commands, and services
    console.log('[Activate] Step 11: Calling ptahExtension.registerAll()...');
    await ptahExtension.registerAll();
    console.log('[Activate] Step 11: ptahExtension.registerAll() complete');

    // ========================================
    // STEP 12: CONDITIONAL MCP SERVER START (TASK_2025_121)
    // ========================================
    // MCP Server only starts for Pro tier users (Pro-only feature)
    console.log('[Activate] Step 12: Conditional MCP Server registration...');

    if (licenseStatus.tier === 'pro' || licenseStatus.tier === 'trial_pro') {
      // PRO USER: Register MCP Server (Pro-only feature)
      logger.info('Registering premium MCP server (Pro tier user)');
      const codeExecutionMCP = DIContainer.resolve(TOKENS.CODE_EXECUTION_MCP);
      const mcpPort = await (
        codeExecutionMCP as { start: () => Promise<number> }
      ).start();
      context.subscriptions.push(codeExecutionMCP as vscode.Disposable);
      logger.info(`Code Execution MCP Server started on port ${mcpPort}`);
      console.log(
        `[Activate] Step 12: Pro MCP Server started (port ${mcpPort})`
      );
    } else {
      // COMMUNITY USER: Skip MCP Server (Pro-only feature)
      logger.info('Skipping MCP server (Community tier - Pro feature only)', {
        tier: licenseStatus.tier,
      });
      console.log(
        `[Activate] Step 12: MCP Server skipped (tier: ${licenseStatus.tier})`
      );
    }

    // Note: MCP config (.mcp.json) writing removed - SDK tools are now native
    // and don't require external MCP server registration. The Code Execution
    // MCP server runs locally and Ptah tools (help, executeCode) are registered
    // directly with the SDK via mcpServers option in SdkAgentAdapter.

    // ========================================
    // STEP 13: LICENSE STATUS WATCHER
    // ========================================
    console.log('[Activate] Step 13: Setting up license status watcher...');

    // Handle dynamic license changes (upgrade/expire)
    licenseService.on('license:verified', async (newStatus: LicenseStatus) => {
      logger.info('License status changed', { newStatus });
      // For simplicity, we show a message prompting user to reload window
      vscode.window
        .showInformationMessage(
          'License status updated! Reload window to apply changes.',
          'Reload Window'
        )
        .then((action) => {
          if (action === 'Reload Window') {
            vscode.commands.executeCommand('workbench.action.reloadWindow');
          }
        });
    });

    licenseService.on('license:expired', (newStatus: LicenseStatus) => {
      logger.warn('License expired - extension will be blocked on reload', {
        newStatus,
      });
      vscode.window.showWarningMessage(
        'Your Ptah license has expired. Please renew your subscription to continue using the extension.'
      );
    });

    console.log('[Activate] Step 13: License status watcher initialized');

    // Background revalidation (every 24 hours)
    const revalidationInterval = setInterval(
      () => licenseService.revalidate(),
      24 * 60 * 60 * 1000
    );
    context.subscriptions.push({
      dispose: () => clearInterval(revalidationInterval),
    });

    logger.info('Ptah extension activated successfully');
    console.log('===== PTAH ACTIVATION COMPLETE =====');

    // Show welcome message for first-time users
    const isFirstTime = context.globalState.get('ptah.firstActivation', true);
    if (isFirstTime) {
      await ptahExtension.showWelcome();
      await context.globalState.update('ptah.firstActivation', false);
    }
  } catch (error) {
    console.error('===== PTAH ACTIVATION FAILED =====');
    console.error('[Activate] Error details:', error);
    console.error(
      '[Activate] Error stack:',
      error instanceof Error ? error.stack : 'No stack trace'
    );
    const logger = DIContainer.resolve<Logger>(TOKENS.LOGGER);
    logger.error(
      'Failed to activate Ptah extension',
      error instanceof Error ? error : new Error(String(error))
    );
    vscode.window.showErrorMessage(
      `Ptah activation failed: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`
    );
  }
}

export function deactivate(): void {
  const logger = DIContainer.resolve<Logger>(TOKENS.LOGGER);
  logger.info('Deactivating Ptah extension');

  // NOTE: We intentionally do NOT remove ptah from .mcp.json on deactivation.
  // The MCP config must persist so that resumed Claude sessions can find
  // the permission-prompt-tool. The port gets updated on next activation.

  ptahExtension?.dispose();
  ptahExtension = undefined;
  DIContainer.clear();
}
