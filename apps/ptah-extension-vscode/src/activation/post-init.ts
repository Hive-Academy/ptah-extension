import * as vscode from 'vscode';
import {
  type Logger,
  type LicenseService,
  type LicenseStatus,
  TOKENS,
  bindLicenseReactivity,
} from '@ptah-extension/vscode-core';
import { setPtahMcpPort } from '@ptah-extension/agent-sdk';
import { DIContainer } from '../di/container';
import { PtahExtension } from '../core/ptah-extension';
import { syncCliSkillsOnActivation } from './cli-skill-sync';
import { syncCliAgentsOnActivation } from './cli-agent-sync';

/**
 * Final activation stage: constructs the PtahExtension controller, wires
 * the license reactivity binder (license:verified / license:expired ->
 * MCP server + CLI sync lifecycle), schedules background revalidation,
 * and shows the first-time welcome message.
 *
 * @returns The constructed PtahExtension so the caller can assign it to the
 *   module-level `ptahExtension` variable used by `deactivate()`.
 */
export async function registerPostInit(
  context: vscode.ExtensionContext,
  logger: Logger,
  licenseStatus: LicenseStatus,
  authInitialized: boolean,
): Promise<PtahExtension> {
  const ptahExtension = new PtahExtension(context);

  await ptahExtension.initialize();
  await ptahExtension.registerAll();
  try {
    const container = DIContainer.getContainer();
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

    const binderDisposable = bindLicenseReactivity({
      container,
      logger,
      onMcpPortChange: (port) => {
        setPtahMcpPort(port ?? 0);
      },
      notify: (kind) => {
        if (kind === 'verified') {
          vscode.window.showInformationMessage(
            'Ptah premium features activated.',
          );
        } else {
          vscode.window.showWarningMessage(
            'Your Ptah license has expired. Please renew your subscription to continue using premium features.',
          );
        }
      },
      syncCliSkills: () => {
        syncCliSkillsOnActivation(workspaceRoot, logger);
      },
      syncCliAgents: () => {
        if (workspaceRoot) {
          syncCliAgentsOnActivation(workspaceRoot, logger);
        }
      },
    });
    context.subscriptions.push(binderDisposable);

    logger.info('[post-init] License reactivity binder initialized');
  } catch (binderError: unknown) {
    logger.warn(
      '[post-init] License reactivity binder setup failed (non-fatal)',
      {
        error:
          binderError instanceof Error
            ? binderError.message
            : String(binderError),
      },
    );
  }
  try {
    const licenseService = DIContainer.resolve<LicenseService>(
      TOKENS.LICENSE_SERVICE,
    );
    const revalidationInterval = setInterval(
      () => licenseService.revalidate(),
      24 * 60 * 60 * 1000,
    );
    context.subscriptions.push({
      dispose: () => clearInterval(revalidationInterval),
    });
  } catch (revalError: unknown) {
    logger.warn(
      '[post-init] Background revalidation setup failed (non-fatal)',
      {
        error:
          revalError instanceof Error ? revalError.message : String(revalError),
      },
    );
  }
  const isFirstTime = context.globalState.get('ptah.firstActivation', true);
  if (isFirstTime) {
    void ptahExtension.showWelcome();
    await context.globalState.update('ptah.firstActivation', false);
  }
  void licenseStatus;

  return ptahExtension;
}
