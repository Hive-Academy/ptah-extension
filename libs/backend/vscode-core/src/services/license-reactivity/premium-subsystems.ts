/**
 * Premium Subsystems — reactive bring-up / tear-down helpers.
 *
 * Called by `bindLicenseReactivity` whenever the license tier transitions
 * community → pro/trial_pro (bring up) or pro/trial_pro → community/expired
 * (tear down). Each subsystem is isolated in its own try/catch so a single
 * failure never blocks the others.
 *
 * Design:
 * - All operations are idempotent by checking state before acting.
 * - The caller never needs to know the current tier — we re-verify here.
 * - No DI decorators: these are plain exported async functions.
 * - CLI sync is delegated to optional app-provided callbacks to avoid
 *   circular dependencies (agent-sdk/agent-generation → vscode-core).
 */

import type { DependencyContainer } from 'tsyringe';
import type { Logger } from '../../logging';
import { TOKENS } from '../../di/tokens';
import type { LicenseService } from '../license.service';
import type { FeatureGateService } from '../feature-gate.service';

export interface PremiumSubsystemsDeps {
  container: DependencyContainer;
  logger: Logger;
  /**
   * Called after MCP server starts (with port) or stops (with null).
   */
  onMcpPortChange?: (port: number | null) => void;
  /**
   * Optional soft toast notifier — called after a successful transition.
   */
  notify?: (kind: 'verified' | 'expired') => void;
  /**
   * App-provided CLI skill sync callback (fire-and-forget).
   * If omitted, CLI skill sync is skipped.
   */
  syncCliSkills?: () => void;
  /**
   * App-provided CLI agent sync callback (fire-and-forget).
   * If omitted, CLI agent sync is skipped.
   */
  syncCliAgents?: () => void;
}

// ---------------------------------------------------------------------------
// bringUpPremiumSubsystems
// ---------------------------------------------------------------------------

/**
 * Idempotently start premium subsystems after a license:verified event.
 *
 * Steps:
 * 1. Re-verify license — bail if not premium (we never trust the caller).
 * 2. Start CodeExecutionMCP if registered and not already running.
 * 3. Call ensureRegisteredForSubagents on MCP.
 * 4. Run CLI skill sync (fire-and-forget, app-provided callback).
 * 5. Run CLI agent sync (fire-and-forget, app-provided callback).
 * 6. Invalidate FeatureGateService cache.
 * 7. Call notify('verified') if at least one subsystem was touched.
 */
export async function bringUpPremiumSubsystems(
  deps: PremiumSubsystemsDeps,
): Promise<void> {
  const { container, logger } = deps;

  // Step 1: re-verify — never trust the caller's claim.
  let isPremium = false;
  try {
    const licenseService = container.resolve<LicenseService>(
      TOKENS.LICENSE_SERVICE,
    );
    const status = await licenseService.verifyLicense();
    isPremium =
      status.valid &&
      (status.tier === 'pro' ||
        status.tier === 'trial_pro' ||
        status.plan?.isPremium === true);
  } catch (error: unknown) {
    logger.warn(
      '[PremiumSubsystems] License re-verification failed — aborting bring-up',
      {
        error: error instanceof Error ? error.message : String(error),
      },
    );
    return;
  }

  if (!isPremium) {
    logger.debug(
      '[PremiumSubsystems] bringUp called but license is not premium — skipping',
    );
    return;
  }

  let anyStarted = false;

  // Step 2 + 3: Start MCP server and register for subagents.
  try {
    if (container.isRegistered(TOKENS.CODE_EXECUTION_MCP)) {
      const mcpService = container.resolve(TOKENS.CODE_EXECUTION_MCP) as {
        start: () => Promise<number>;
        getPort: () => number | null;
        ensureRegisteredForSubagents: () => void;
      };

      if (mcpService.getPort() !== null) {
        logger.debug(
          '[PremiumSubsystems] MCP server already running — skipping start',
        );
      } else {
        logger.info('[PremiumSubsystems] Starting MCP server...');
        const port = await mcpService.start();
        deps.onMcpPortChange?.(port);
        logger.info(`[PremiumSubsystems] MCP server started on port ${port}`);
        anyStarted = true;
      }

      // Always try to register (idempotent internally)
      try {
        mcpService.ensureRegisteredForSubagents();
      } catch (regError: unknown) {
        logger.warn(
          '[PremiumSubsystems] MCP ensureRegisteredForSubagents failed (non-fatal)',
          {
            error:
              regError instanceof Error ? regError.message : String(regError),
          },
        );
      }
    } else {
      logger.debug(
        '[PremiumSubsystems] CODE_EXECUTION_MCP not registered — skipping MCP start',
      );
    }
  } catch (mcpError: unknown) {
    logger.warn('[PremiumSubsystems] MCP server start failed (non-fatal)', {
      error: mcpError instanceof Error ? mcpError.message : String(mcpError),
    });
  }

  // Step 4: CLI skill sync (fire-and-forget, delegated to app callback).
  if (deps.syncCliSkills) {
    try {
      deps.syncCliSkills();
      anyStarted = true;
    } catch (skillSyncError: unknown) {
      logger.warn('[PremiumSubsystems] CLI skill sync failed (non-fatal)', {
        error:
          skillSyncError instanceof Error
            ? skillSyncError.message
            : String(skillSyncError),
      });
    }
  }

  // Step 5: CLI agent sync (fire-and-forget, delegated to app callback).
  if (deps.syncCliAgents) {
    try {
      deps.syncCliAgents();
      anyStarted = true;
    } catch (agentSyncError: unknown) {
      logger.warn('[PremiumSubsystems] CLI agent sync failed (non-fatal)', {
        error:
          agentSyncError instanceof Error
            ? agentSyncError.message
            : String(agentSyncError),
      });
    }
  }

  // Step 6: Invalidate FeatureGateService cache.
  try {
    if (container.isRegistered(TOKENS.FEATURE_GATE_SERVICE)) {
      const featureGate = container.resolve<FeatureGateService>(
        TOKENS.FEATURE_GATE_SERVICE,
      );
      featureGate.invalidateCache();
      logger.debug('[PremiumSubsystems] FeatureGateService cache invalidated');
    }
  } catch (fgError: unknown) {
    logger.warn(
      '[PremiumSubsystems] FeatureGateService cache invalidation failed (non-fatal)',
      {
        error: fgError instanceof Error ? fgError.message : String(fgError),
      },
    );
  }

  // Step 7: Notify.
  if (anyStarted) {
    deps.notify?.('verified');
  }
}

// ---------------------------------------------------------------------------
// tearDownPremiumSubsystems
// ---------------------------------------------------------------------------

/**
 * Idempotently stop premium subsystems after a license:expired event.
 *
 * Steps:
 * 1. Stop CodeExecutionMCP (null-safe internally).
 * 2. Run CLI_PLUGIN_SYNC_SERVICE.cleanupAll().
 * 3. Invalidate FeatureGateService cache.
 * 4. Call notify('expired').
 */
export async function tearDownPremiumSubsystems(
  deps: PremiumSubsystemsDeps,
): Promise<void> {
  const { container, logger } = deps;

  // Step 1: Stop MCP server.
  try {
    if (container.isRegistered(TOKENS.CODE_EXECUTION_MCP)) {
      const mcpService = container.resolve(TOKENS.CODE_EXECUTION_MCP) as {
        stop: () => Promise<void>;
        getPort: () => number | null;
      };
      if (mcpService.getPort() !== null) {
        logger.info(
          '[PremiumSubsystems] Stopping MCP server (license expired)',
        );
        await mcpService.stop();
        deps.onMcpPortChange?.(null);
        logger.info('[PremiumSubsystems] MCP server stopped');
      } else {
        logger.debug(
          '[PremiumSubsystems] MCP server was not running — skipping stop',
        );
      }
    }
  } catch (mcpError: unknown) {
    logger.warn('[PremiumSubsystems] MCP server stop failed (non-fatal)', {
      error: mcpError instanceof Error ? mcpError.message : String(mcpError),
    });
  }

  // Step 2: Clean up CLI skills/agents via the sync service.
  try {
    if (container.isRegistered(TOKENS.CLI_PLUGIN_SYNC_SERVICE)) {
      const cliPluginSync = container.resolve(
        TOKENS.CLI_PLUGIN_SYNC_SERVICE,
      ) as {
        cleanupAll: () => Promise<void>;
      };
      await cliPluginSync.cleanupAll();
      logger.info('[PremiumSubsystems] CLI plugin cleanup complete');
    }
  } catch (cleanupError: unknown) {
    logger.warn('[PremiumSubsystems] CLI plugin cleanup failed (non-fatal)', {
      error:
        cleanupError instanceof Error
          ? cleanupError.message
          : String(cleanupError),
    });
  }

  // Step 3: Invalidate FeatureGateService cache.
  try {
    if (container.isRegistered(TOKENS.FEATURE_GATE_SERVICE)) {
      const featureGate = container.resolve<FeatureGateService>(
        TOKENS.FEATURE_GATE_SERVICE,
      );
      featureGate.invalidateCache();
      logger.debug('[PremiumSubsystems] FeatureGateService cache invalidated');
    }
  } catch (fgError: unknown) {
    logger.warn(
      '[PremiumSubsystems] FeatureGateService cache invalidation failed (non-fatal)',
      {
        error: fgError instanceof Error ? fgError.message : String(fgError),
      },
    );
  }

  // Step 4: Notify.
  deps.notify?.('expired');
}
