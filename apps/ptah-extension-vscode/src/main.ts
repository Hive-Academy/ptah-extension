// CRITICAL: reflect-metadata MUST be imported first for TSyringe to work
import 'reflect-metadata';

import * as vscode from 'vscode';
import {
  type Logger,
  TOKENS,
  SentryService,
} from '@ptah-extension/vscode-core';
import {
  SDK_TOKENS,
  PtahCliRegistry,
  SkillJunctionService,
} from '@ptah-extension/agent-sdk';
import { DIContainer } from './di/container';
import { PtahExtension } from './core/ptah-extension';
import { bootstrapVscode } from './activation/bootstrap';
import { wireRuntimeVscode } from './activation/wire-runtime';
import { registerPostInit } from './activation/post-init';

let ptahExtension: PtahExtension | undefined;

export async function activate(
  context: vscode.ExtensionContext,
): Promise<void> {
  try {
    const boot = await bootstrapVscode(context);
    if (boot.blocked) return;

    await wireRuntimeVscode(context, boot.logger, boot.licenseStatus);
    ptahExtension = await registerPostInit(
      context,
      boot.logger,
      boot.licenseStatus,
      boot.authInitialized,
    );

    boot.logger.info('Ptah extension activated successfully');
  } catch (error) {
    console.error('===== PTAH ACTIVATION FAILED =====');
    console.error('[Activate] Error details:', error);
    console.error(
      '[Activate] Error stack:',
      error instanceof Error ? error.stack : 'No stack trace',
    );
    const logger = DIContainer.resolve<Logger>(TOKENS.LOGGER);
    logger.error(
      'Failed to activate Ptah extension',
      error instanceof Error ? error : new Error(String(error)),
    );
    try {
      const sentry = DIContainer.resolve<SentryService>(TOKENS.SENTRY_SERVICE);
      sentry.captureException(
        error instanceof Error ? error : new Error(String(error)),
        { errorSource: 'activate' },
      );
    } catch {
      // Sentry may not be initialized yet — ignore
    }
    vscode.window.showErrorMessage(
      `Ptah activation failed: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`,
    );
  }
}

export async function deactivate(): Promise<void> {
  const logger = DIContainer.resolve<Logger>(TOKENS.LOGGER);
  logger.info('Deactivating Ptah extension');

  // NOTE: We intentionally do NOT remove ptah from .mcp.json on deactivation.
  // The MCP config must persist so that resumed Claude sessions can find
  // the permission-prompt-tool. The port gets updated on next activation.

  // TASK_2025_201: Remove workspace skill junctions
  try {
    const skillJunction = DIContainer.resolve<SkillJunctionService>(
      SDK_TOKENS.SDK_SKILL_JUNCTION,
    );
    skillJunction.deactivateSync();
  } catch {
    // Junction service may not be initialized yet - safe to ignore
  }

  // TASK_2025_167: Dispose all Ptah CLI adapters before clearing the container
  try {
    const ptahCliRegistry = DIContainer.resolve<PtahCliRegistry>(
      SDK_TOKENS.SDK_PTAH_CLI_REGISTRY,
    );
    ptahCliRegistry.disposeAll();
  } catch {
    // Registry may not be initialized yet - safe to ignore
  }

  ptahExtension?.dispose();
  ptahExtension = undefined;

  // Flush pending Sentry events before the process exits
  try {
    const sentryService = DIContainer.resolve<SentryService>(
      TOKENS.SENTRY_SERVICE,
    );
    await sentryService.flush(2000);
  } catch {
    // Ignore — extension is shutting down
  }

  DIContainer.clear();
}
