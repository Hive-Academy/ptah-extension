import * as vscode from 'vscode';
import {
  type Logger,
  type LicenseService,
  type LicenseStatus,
  TOKENS,
  bringUpSubsystems,
} from '@ptah-extension/vscode-core';
import { setPtahMcpPort } from '@ptah-extension/agent-sdk';
import { DIContainer } from '../di/container';
import { PtahExtension } from '../core/ptah-extension';

/**
 * Final activation stage: constructs the PtahExtension controller, brings up
 * the local MCP subsystem unconditionally, schedules background membership
 * revalidation, and shows the first-time welcome message.
 *
 * Harness propagation used to happen here too, through two CLI sync callbacks.
 * It moved to `reconcileHarness` in `wire-runtime.ts`, which runs earlier and
 * covers Claude and every rival CLI in one pass (TASK_2026_278 Batch 2).
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

    await bringUpSubsystems({
      container,
      logger,
      onMcpPortChange: (port) => {
        setPtahMcpPort(port ?? 0);
      },
    });

    logger.info('[post-init] Subsystems brought up');
  } catch (bringUpError: unknown) {
    logger.warn('[post-init] Subsystem bring-up failed (non-fatal)', {
      error:
        bringUpError instanceof Error
          ? bringUpError.message
          : String(bringUpError),
    });
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
