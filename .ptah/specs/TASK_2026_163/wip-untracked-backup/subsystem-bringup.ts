/**
 * Subsystem bring-up — unconditional activation helper.
 *
 * Starts the Code Execution MCP server and runs the CLI skill/agent syncs
 * once, at activation, for every user. There is no tier or license gate:
 * all local, single-user capabilities are available to everyone.
 *
 * Design:
 * - Idempotent: the MCP server is only started when it is not already running.
 * - Each subsystem is isolated in its own try/catch so a single failure never
 *   blocks the others.
 * - No DI decorators: this is a plain exported async function.
 * - CLI syncs are delegated to optional app-provided callbacks to avoid
 *   circular dependencies (agent-sdk/agent-generation → vscode-core).
 */

import type { DependencyContainer } from 'tsyringe';
import type { Logger } from '../logging';
import { TOKENS } from '../di/tokens';

export interface SubsystemBringUpDeps {
  container: DependencyContainer;
  logger: Logger;
  /**
   * Called after MCP server starts (with port).
   */
  onMcpPortChange?: (port: number | null) => void;
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

/**
 * Idempotently start local subsystems at activation.
 *
 * Steps:
 * 1. Start CodeExecutionMCP if registered and not already running.
 * 2. Call ensureRegisteredForSubagents on MCP.
 * 3. Run CLI skill sync (fire-and-forget, app-provided callback).
 * 4. Run CLI agent sync (fire-and-forget, app-provided callback).
 */
export async function bringUpSubsystems(
  deps: SubsystemBringUpDeps,
): Promise<void> {
  const { container, logger } = deps;

  try {
    if (container.isRegistered(TOKENS.CODE_EXECUTION_MCP)) {
      const mcpService = container.resolve(TOKENS.CODE_EXECUTION_MCP) as {
        start: () => Promise<number>;
        getPort: () => number | null;
        ensureRegisteredForSubagents: () => void;
      };

      if (mcpService.getPort() !== null) {
        logger.debug(
          '[SubsystemBringUp] MCP server already running — skipping start',
        );
      } else {
        logger.info('[SubsystemBringUp] Starting MCP server...');
        const port = await mcpService.start();
        deps.onMcpPortChange?.(port);
        logger.info(`[SubsystemBringUp] MCP server started on port ${port}`);
      }
      try {
        mcpService.ensureRegisteredForSubagents();
      } catch (regError: unknown) {
        logger.warn(
          '[SubsystemBringUp] MCP ensureRegisteredForSubagents failed (non-fatal)',
          {
            error:
              regError instanceof Error ? regError.message : String(regError),
          },
        );
      }
    } else {
      logger.debug(
        '[SubsystemBringUp] CODE_EXECUTION_MCP not registered — skipping MCP start',
      );
    }
  } catch (mcpError: unknown) {
    logger.warn('[SubsystemBringUp] MCP server start failed (non-fatal)', {
      error: mcpError instanceof Error ? mcpError.message : String(mcpError),
    });
  }

  if (deps.syncCliSkills) {
    try {
      deps.syncCliSkills();
    } catch (skillSyncError: unknown) {
      logger.warn('[SubsystemBringUp] CLI skill sync failed (non-fatal)', {
        error:
          skillSyncError instanceof Error
            ? skillSyncError.message
            : String(skillSyncError),
      });
    }
  }

  if (deps.syncCliAgents) {
    try {
      deps.syncCliAgents();
    } catch (agentSyncError: unknown) {
      logger.warn('[SubsystemBringUp] CLI agent sync failed (non-fatal)', {
        error:
          agentSyncError instanceof Error
            ? agentSyncError.message
            : String(agentSyncError),
      });
    }
  }
}
