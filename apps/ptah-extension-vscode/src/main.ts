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
  type DiagnosticsHandle,
  type Logger,
  type RpcVerificationResult,
  TOKENS,
  SentryService,
} from '@ptah-extension/vscode-core';
import {
  AgentProcessManager,
  CLI_AGENT_RUNTIME_TOKENS,
  PtahCliRegistry,
} from '@ptah-extension/cli-agent-runtime';
import { DIContainer } from './di/container';
import { PtahExtension } from './core/ptah-extension';
import { bootstrapVscode } from './activation/bootstrap';
import { wireRuntimeVscode } from './activation/wire-runtime';
import { registerPostInit } from './activation/post-init';

let ptahExtension: PtahExtension | undefined;
let diagnostics: DiagnosticsHandle | undefined;

/**
 * Activation API surface returned from `activate()`. Consumed by the
 * vscode e2e suite (`apps/ptah-extension-vscode-e2e`) to assert the RPC
 * registration contract against the real bundled extension.
 */
export interface PtahActivationApi {
  /** RPC verification result. */
  getRpcVerification(): RpcVerificationResult | undefined;
}

export async function activate(
  context: vscode.ExtensionContext,
): Promise<PtahActivationApi | undefined> {
  try {
    const boot = await bootstrapVscode(context);
    diagnostics = boot.diagnostics;

    await wireRuntimeVscode(context, boot.logger, boot.licenseStatus);
    ptahExtension = await registerPostInit(
      context,
      boot.logger,
      boot.licenseStatus,
      boot.authInitialized,
    );

    boot.logger.info('Ptah extension activated successfully');
    return { getRpcVerification: () => boot.rpcVerification };
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
    return undefined;
  }
}

export async function deactivate(): Promise<void> {
  const logger = DIContainer.resolve<Logger>(TOKENS.LOGGER);
  logger.info('Deactivating Ptah extension');

  // No harness teardown here, deliberately. `{ws}/.claude/{skills,commands}`
  // are workspace artifacts, not host-process resources: `ptah tui`, the
  // headless CLI, the gateway and a plain `claude` invocation all read them
  // without ever running this extension. Removing them on deactivate is the
  // defect TASK_2026_278 exists to close.
  const ptahCliRegistry = DIContainer.resolve<PtahCliRegistry>(
    CLI_AGENT_RUNTIME_TOKENS.SDK_PTAH_CLI_REGISTRY,
  );
  ptahCliRegistry.disposeAll();

  // Agents before proxies: a spawned CLI agent's subprocess is the expensive
  // thing, and a completed continuation-capable agent holds one open until it is
  // aborted. Without this, deactivate left every `claude.exe` a session ever
  // spawned resident (TASK_2026_323 B11). `deactivate()` is awaited by VS Code,
  // so this is the one host that can genuinely wait for the reap.
  try {
    const agentProcessManager = DIContainer.resolve<AgentProcessManager>(
      TOKENS.AGENT_PROCESS_MANAGER,
    );
    await agentProcessManager.disposeAll();
  } catch (error: unknown) {
    logger.warn('Agent process disposal failed (non-fatal)', {
      reason: error instanceof Error ? error.message : String(error),
    });
  }

  ptahExtension?.dispose();
  ptahExtension = undefined;

  const sentryService = DIContainer.resolve<SentryService>(
    TOKENS.SENTRY_SERVICE,
  );
  await sentryService.flush(2000);

  // After the Sentry flush, before the container is cleared: the flush is an
  // awaited network call, and a deactivate that stalls there is exactly the
  // kind of thing the lag log should still be recording.
  try {
    diagnostics?.dispose();
  } catch (error: unknown) {
    logger.warn('Diagnostics dispose failed (non-fatal)', {
      reason: error instanceof Error ? error.message : String(error),
    });
  }
  diagnostics = undefined;

  DIContainer.clear();
}
