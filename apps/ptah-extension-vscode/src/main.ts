// CRITICAL: reflect-metadata MUST be imported first for TSyringe to work
import 'reflect-metadata';

// Install process-level safety nets BEFORE anything else can throw.
// Without these, an unhandled background rejection (e.g. from a fire-and-forget
// Promise inside openAndMigrate, agent SDK preload, or a now-async decryptToken
// caller) kills the extension host with exit code 7 and we lose the error.
try {
  process.on('unhandledRejection', (reason: unknown) => {
    try {
      const msg =
        reason instanceof Error ? String(reason.message) : String(reason);
      const stack =
        reason instanceof Error && typeof reason.stack === 'string'
          ? reason.stack
          : '';
      console.error('[Ptah VS Code] UNHANDLED_REJECTION:', msg);
      if (stack)
        console.error('[Ptah VS Code] UNHANDLED_REJECTION stack:', stack);
    } catch {
      /* ignore */
    }
  });
  process.on('uncaughtException', (err: unknown) => {
    try {
      const msg = err instanceof Error ? String(err.message) : String(err);
      const stack =
        err instanceof Error && typeof err.stack === 'string' ? err.stack : '';
      console.error('[Ptah VS Code] UNCAUGHT_EXCEPTION:', msg);
      if (stack)
        console.error('[Ptah VS Code] UNCAUGHT_EXCEPTION stack:', stack);
    } catch {
      /* ignore */
    }
  });
} catch {
  /* process listeners are best-effort */
}

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
    // CRASH-PROOF CATCH: every step is independently try/wrapped so that a
    // bad error object (Proxy, throwing getter, circular structure) cannot
    // re-throw and trigger Node exit code 7 ("Internal Exception Handler
    // Run-Time Failure"). Each step must still attempt to surface a message
    // so users see something instead of a silent host crash.
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
    try {
      console.error('===== PTAH ACTIVATION FAILED =====');
    } catch {
      // ignore — even console.error can throw if IPC is torn down
    }
    try {
      console.error('[Activate] message:', safeMessage);
    } catch {
      /* ignore */
    }
    try {
      if (safeStack) console.error('[Activate] stack:', safeStack);
    } catch {
      /* ignore */
    }
    try {
      const errorCtor =
        error && typeof error === 'object' && error.constructor
          ? error.constructor.name
          : typeof error;
      console.error('[Activate] errorType:', errorCtor);
    } catch {
      /* ignore */
    }
    try {
      const logger = DIContainer.resolve<Logger>(TOKENS.LOGGER);
      logger.error(
        'Failed to activate Ptah extension',
        error instanceof Error ? error : new Error(safeMessage),
      );
    } catch {
      // Logger may not be registered yet — already logged via console above
    }
    try {
      const sentry = DIContainer.resolve<SentryService>(TOKENS.SENTRY_SERVICE);
      sentry.captureException(
        error instanceof Error ? error : new Error(safeMessage),
        { errorSource: 'activate' },
      );
    } catch {
      // Sentry may not be initialized yet — ignore
    }
    try {
      vscode.window.showErrorMessage(`Ptah activation failed: ${safeMessage}`);
    } catch {
      /* ignore */
    }
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
