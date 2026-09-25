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
 * - No DI decorators: these are plain exported async functions.
 * - Two halves with very different costs (TASK_2026_556). Starting the server
 *   binds a local port in milliseconds. Registering it for subagents plans the
 *   rival-CLI config slots, which probes every installed CLI one after another
 *   — measured at 4-12 s on a warm Windows machine and bounded only by the sum
 *   of the probe timeouts (over 30 s). A host that must not hold its window
 *   behind that probe calls the halves separately.
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

/** The slice of `CodeExecutionMCP` this module drives. */
interface CodeExecutionMcpHandle {
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
}

function resolveMcp(
  container: DependencyContainer,
): CodeExecutionMcpHandle | null {
  return container.isRegistered(TOKENS.CODE_EXECUTION_MCP)
    ? (container.resolve(TOKENS.CODE_EXECUTION_MCP) as CodeExecutionMcpHandle)
    : null;
}

/**
 * Start the Code Execution MCP server if it is registered and not running.
 *
 * Cheap: a port bind. This is the half a boot ordering can depend on —
 * `IMcpServerStatus.getPort()` is live the moment it resolves. Never throws.
 */
export async function startCodeExecutionMcp(
  deps: SubsystemBringUpDeps,
): Promise<void> {
  const { container, logger } = deps;

  try {
    const mcpService = resolveMcp(container);
    if (mcpService === null) {
      logger.debug(
        '[SubsystemBringUp] CODE_EXECUTION_MCP not registered — skipping MCP start',
      );
      return;
    }

    if (mcpService.getPort() !== null) {
      logger.debug(
        '[SubsystemBringUp] MCP server already running — skipping start',
      );
      return;
    }

    logger.info('[SubsystemBringUp] Starting MCP server...');
    const port = await mcpService.start();
    deps.onMcpPortChange?.(port);
    logger.info(`[SubsystemBringUp] MCP server started on port ${port}`);
  } catch (mcpError: unknown) {
    logger.warn('[SubsystemBringUp] MCP server start failed (non-fatal)', {
      error: mcpError instanceof Error ? mcpError.message : String(mcpError),
    });
  }
}

/**
 * Declare the running MCP server in every config file a subagent or rival CLI
 * reads (`{ws}/.mcp.json` and the detected CLIs' slots).
 *
 * Slow: it waits on rival-CLI detection. Never call it from a path a window or
 * a user is waiting on. Never throws; a server that is not running yet
 * resolves as `not-started` inside `CodeExecutionMCP`.
 */
export async function registerCodeExecutionMcpForSubagents(
  deps: Pick<SubsystemBringUpDeps, 'container' | 'logger'>,
): Promise<void> {
  const { container, logger } = deps;

  try {
    const mcpService = resolveMcp(container);
    if (mcpService === null) return;

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
        error: regError instanceof Error ? regError.message : String(regError),
      },
    );
  }
}

/**
 * Idempotently start local subsystems at activation, both halves in order.
 *
 * Steps:
 * 1. Start CodeExecutionMCP if registered and not already running.
 * 2. Call ensureRegisteredForSubagents on MCP.
 */
export async function bringUpSubsystems(
  deps: SubsystemBringUpDeps,
): Promise<void> {
  await startCodeExecutionMcp(deps);
  await registerCodeExecutionMcpForSubagents(deps);
}
