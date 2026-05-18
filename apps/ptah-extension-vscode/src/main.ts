import 'reflect-metadata';

process.on('unhandledRejection', (reason: unknown) => {
  const msg = reason instanceof Error ? String(reason.message) : String(reason);
  const stack =
    reason instanceof Error && typeof reason.stack === 'string'
      ? reason.stack
      : '';
  console.error('[Ptah VS Code] UNHANDLED_REJECTION:', msg);
  if (stack) console.error('[Ptah VS Code] UNHANDLED_REJECTION stack:', stack);
});
process.on('uncaughtException', (err: unknown) => {
  const msg = err instanceof Error ? String(err.message) : String(err);
  const stack =
    err instanceof Error && typeof err.stack === 'string' ? err.stack : '';
  console.error('[Ptah VS Code] UNCAUGHT_EXCEPTION:', msg);
  if (stack) console.error('[Ptah VS Code] UNCAUGHT_EXCEPTION stack:', stack);
});

import * as vscode from 'vscode';
import {
  type Logger,
  TOKENS,
  SentryService,
} from '@ptah-extension/vscode-core';
import { SDK_TOKENS, SkillJunctionService } from '@ptah-extension/agent-sdk';
import {
  CLI_AGENT_RUNTIME_TOKENS,
  PtahCliRegistry,
} from '@ptah-extension/cli-agent-runtime';
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
    let safeMessage = 'Unknown error';
    let safeStack = '';
    try {
      safeMessage =
        error instanceof Error ? String(error.message) : String(error);
    } catch {
      safeMessage = '<error message inspection failed>';
    }
    try {
      safeStack =
        error instanceof Error && typeof error.stack === 'string'
          ? error.stack
          : '';
    } catch {
      safeStack = '<stack inspection failed>';
    }

    console.error('===== PTAH ACTIVATION FAILED =====');

    console.error('[Activate] message:', safeMessage);

    if (safeStack) console.error('[Activate] stack:', safeStack);

    const errorCtor =
      error && typeof error === 'object' && error.constructor
        ? error.constructor.name
        : typeof error;
    console.error('[Activate] errorType:', errorCtor);

    const logger = DIContainer.resolve<Logger>(TOKENS.LOGGER);
    logger.error(
      'Failed to activate Ptah extension',
      error instanceof Error ? error : new Error(safeMessage),
    );

    const sentry = DIContainer.resolve<SentryService>(TOKENS.SENTRY_SERVICE);
    sentry.captureException(
      error instanceof Error ? error : new Error(safeMessage),
      { errorSource: 'activate' },
    );

    vscode.window.showErrorMessage(`Ptah activation failed: ${safeMessage}`);
  }
}

export async function deactivate(): Promise<void> {
  const logger = DIContainer.resolve<Logger>(TOKENS.LOGGER);
  logger.info('Deactivating Ptah extension');

  const skillJunction = DIContainer.resolve<SkillJunctionService>(
    SDK_TOKENS.SDK_SKILL_JUNCTION,
  );
  skillJunction.deactivateSync();

  const ptahCliRegistry = DIContainer.resolve<PtahCliRegistry>(
    CLI_AGENT_RUNTIME_TOKENS.SDK_PTAH_CLI_REGISTRY,
  );
  ptahCliRegistry.disposeAll();

  ptahExtension?.dispose();
  ptahExtension = undefined;

  const sentryService = DIContainer.resolve<SentryService>(
    TOKENS.SENTRY_SERVICE,
  );
  await sentryService.flush(2000);

  DIContainer.clear();
}
