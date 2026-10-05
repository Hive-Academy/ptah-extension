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
  type ISessionSpawner,
} from '@ptah-extension/cli-agent-runtime';
import { flushSessionMetadataStores } from '@ptah-extension/agent-sdk';
import { killRunningChecks } from '@ptah-extension/vscode-lm-tools';
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

  // Agents before proxies: a spawned CLI agent's subprocess is the expensive
  // thing, and a completed continuation-capable agent holds one open until it is
  // aborted. Without this, deactivate left every `claude.exe` a session ever
  // spawned resident (TASK_2026_323 B11). `deactivate()` is awaited by VS Code,
  // so this is the one host that can genuinely wait for the reap.
  //
  // The ORDER is the point, and this host had it backwards until TASK_2026_326:
  // a per-agent translation proxy exists to serve a live agent process, so
  // stopping it first leaves that process alive and talking to a closed socket —
  // it then fails its way out instead of being aborted, which is the opposite of
  // a clean reap. Electron already tore down in this order and said so in its
  // comment; the extension only said so.
  //
  // Child sessions BEFORE the agents (TASK_2026_584): `dispose()` marks every
  // live child stopped (`host-shutdown`), clears its timers and releases its
  // policy and MCP root synchronously, so no completion is pushed into a parent
  // that is going away and no runtime timer outlives the host.
  try {
    if (DIContainer.isRegistered(CLI_AGENT_RUNTIME_TOKENS.SESSION_SPAWNER)) {
      DIContainer.resolve<ISessionSpawner>(
        CLI_AGENT_RUNTIME_TOKENS.SESSION_SPAWNER,
      ).dispose();
    }
  } catch (error: unknown) {
    // degradation-audit: reported - logged at warn; shutdown continues and
    // the agent reap below still runs.
    logger.warn('Session spawner dispose failed (non-fatal)', {
      reason: error instanceof Error ? error.message : String(error),
    });
  }

  // A `ptah_run_check` in flight owns an Nx process tree in its own process
  // group, which would outlive the extension host. The check kill and the
  // agent reap are independent, so they run together and both are awaited: a
  // slow `taskkill` must not spend the deactivate budget the reap and the
  // metadata flush below need.
  const checksKilled = killRunningChecksWithin(
    RUN_CHECK_KILL_BUDGET_MS,
    logger,
  );
  const agentsReaped = (async (): Promise<void> => {
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
  })();
  await Promise.all([checksKilled, agentsReaped]);

  try {
    const ptahCliRegistry = DIContainer.resolve<PtahCliRegistry>(
      CLI_AGENT_RUNTIME_TOKENS.SDK_PTAH_CLI_REGISTRY,
    );
    ptahCliRegistry.disposeAll();
  } catch (error: unknown) {
    logger.warn('CLI registry dispose failed (non-fatal)', {
      reason: error instanceof Error ? error.message : String(error),
    });
  }

  // AFTER the agents are reaped: an agent's exit persists its CLI session
  // reference, so draining the store's coalesced write queue any earlier would
  // miss exactly the references this teardown just produced. `deactivate()` is
  // awaited by VS Code, so this host can genuinely wait for the write to land
  // instead of merely starting it (TASK_2026_324 finding 3).
  await flushSessionMetadataStores();

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

/**
 * How long deactivate waits for the run-check tree kills. Matches the
 * tree-kill grace period (`PROCESS_TREE_KILL_GRACE_MS`, 5 s), after which a
 * POSIX kill has escalated to SIGKILL and a Windows `taskkill` has been spawned.
 */
const RUN_CHECK_KILL_BUDGET_MS = 5_000;

/**
 * Await {@link killRunningChecks}, giving up after `budgetMs`. The kill never
 * rejects, so there is no catch; an overrun is logged and deactivate moves on
 * while the kill keeps running.
 */
async function killRunningChecksWithin(
  budgetMs: number,
  logger: Logger,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<'expired'>((resolve) => {
    timer = setTimeout(() => resolve('expired'), budgetMs);
  });
  try {
    const outcome = await Promise.race([
      killRunningChecks().then(() => 'killed' as const),
      expired,
    ]);
    if (outcome === 'expired') {
      logger.warn('Running check kill exceeded its budget; continuing', {
        budgetMs,
      });
    }
  } finally {
    clearTimeout(timer);
  }
}
