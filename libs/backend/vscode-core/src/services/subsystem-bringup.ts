/**
 * Subsystem bring-up — unconditional activation helper.
 *
 * Starts the Code Execution MCP server once, at activation, for every user.
 * There is no tier or license gate: all local, single-user capabilities are
 * available to everyone.
 *
 * It used to also drive two app-provided CLI fan-out callbacks, one for skills
 * and one for agents. Those are gone: harness propagation is now
 * `HarnessReconciler.reconcile`, which each host already calls from its
 * activation path before this runs (TASK_2026_278 Batch 2).
 *
 * Design:
 * - Idempotent: the MCP server is only started when it is not already running.
 * - Each subsystem is isolated in its own try/catch so a single failure never
 *   blocks the others.
 * - No DI decorators: this is a plain exported async function.
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
}

/**
 * Idempotently start local subsystems at activation.
 *
 * Steps:
 * 1. Start CodeExecutionMCP if registered and not already running.
 * 2. Call ensureRegisteredForSubagents on MCP.
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
        // Structural, and deliberately widened past `Promise<void>`: the call
        // now resolves with a `{ registered, reason }` outcome (TASK_2026_332).
        // This lib cannot import `vscode-lm-tools` for the real type — the
        // dependency runs the other way — so it reads the one field it needs.
        ensureRegisteredForSubagents: () => void | Promise<void | {
          registered?: boolean;
          reason?: string;
        }>;
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
        // Awaited so a rejection lands in this catch rather than as an
        // unhandled rejection — the call became async in TASK_2026_318.
        const registration = await mcpService.ensureRegisteredForSubagents();
        // ...and the non-throwing failure is reported too. Activation-time
        // registration losing a race with a concurrent host used to leave no
        // trace at all here (TASK_2026_332).
        if (registration && registration.registered === false) {
          logger.warn(
            '[SubsystemBringUp] MCP started but .mcp.json entry was not written',
            { reason: registration.reason },
          );
        }
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
}
